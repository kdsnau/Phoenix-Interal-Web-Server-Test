'use strict';
const express = require('express');
const db = require('../db/pool');
const { authRequired } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { newPublicId, newTokenKey } = require('../services/tokens');
const { ah } = require('../util/async');

const router = express.Router();
router.use(authRequired, requireRole('admin'));

// POST /api/credentials/card  { userId, uid, label? } -> assign a physical UID card
router.post(
    '/card',
    ah(async (req, res) => {
        const { userId, uid, label } = req.body || {};
        if (!userId || !uid) return res.status(400).json({ error: 'missing_fields' });
        const normUid = String(uid).toUpperCase().replace(/[^0-9A-F]/g, '');
        if (!normUid) return res.status(400).json({ error: 'bad_uid' });
        try {
            const { rows } = await db.query(
                `INSERT INTO credentials (user_id, type, uid, label)
                 VALUES ($1,'uid_card',$2,$3)
                 RETURNING id, user_id, type, uid, label, active, issued_at`,
                [userId, normUid, label || null],
            );
            res.status(201).json(rows[0]);
        } catch (err) {
            if (err.code === '23505') return res.status(409).json({ error: 'uid_already_assigned' });
            throw err;
        }
    }),
);

// POST /api/credentials/phone  { userId, label? } -> issue a phone credential
// Returns public_id + token_key ONCE so the app can be provisioned; key is not re-shown.
router.post(
    '/phone',
    ah(async (req, res) => {
        const { userId, label } = req.body || {};
        if (!userId) return res.status(400).json({ error: 'missing_fields' });
        const publicId = newPublicId();
        const tokenKey = newTokenKey();
        const { rows } = await db.query(
            `INSERT INTO credentials (user_id, type, public_id, token_key, label)
             VALUES ($1,'phone',$2,$3,$4)
             RETURNING id, user_id, type, public_id, label, active, issued_at`,
            [userId, publicId, tokenKey, label || null],
        );
        res.status(201).json({ ...rows[0], token_key: tokenKey, provisioning_note: 'Store token_key on the device now; it is not shown again.' });
    }),
);

// POST /api/credentials/:id/revoke
router.post(
    '/:id/revoke',
    ah(async (req, res) => {
        const { rows } = await db.query(
            'UPDATE credentials SET active = FALSE, revoked_at = NOW() WHERE id = $1 RETURNING id, active, revoked_at',
            [req.params.id],
        );
        if (!rows[0]) return res.status(404).json({ error: 'not_found' });
        res.json(rows[0]);
    }),
);

// DELETE /api/credentials/:id
router.delete(
    '/:id',
    ah(async (req, res) => {
        const { rowCount } = await db.query('DELETE FROM credentials WHERE id = $1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ error: 'not_found' });
        res.status(204).end();
    }),
);

module.exports = router;
