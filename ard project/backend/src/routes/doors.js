'use strict';
const express = require('express');
const crypto = require('crypto');
const db = require('../db/pool');
const { authRequired } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { ah } = require('../util/async');

const router = express.Router();
router.use(authRequired, requireRole('admin'));

const onlineWindowSec = 90; // last_seen within this = "online"

// GET /api/doors -> list with online status (reader_key hidden)
router.get(
    '/',
    ah(async (req, res) => {
        const { rows } = await db.query(
            `SELECT id, name, location, fail_policy, relay_unlock_ms, last_seen_at, created_at,
                    (last_seen_at IS NOT NULL AND last_seen_at > NOW() - INTERVAL '${onlineWindowSec} seconds') AS online
               FROM doors ORDER BY name`,
        );
        res.json(rows);
    }),
);

// POST /api/doors  { name, location?, relayUnlockMs?, failPolicy? }
// Mints a reader_key, returned ONCE so the reader can be flashed with it.
router.post(
    '/',
    ah(async (req, res) => {
        const { name, location, relayUnlockMs = 5000, failPolicy = 'closed' } = req.body || {};
        if (!name) return res.status(400).json({ error: 'missing_name' });
        const readerKey = crypto.randomBytes(32).toString('hex');
        const { rows } = await db.query(
            `INSERT INTO doors (name, location, reader_key, relay_unlock_ms, fail_policy)
             VALUES ($1,$2,$3,$4,$5)
             RETURNING id, name, location, fail_policy, relay_unlock_ms, created_at`,
            [name, location || null, readerKey, relayUnlockMs, failPolicy],
        );
        res.status(201).json({ ...rows[0], reader_key: readerKey, provisioning_note: 'Flash this reader_key into the door firmware now; it is not shown again.' });
    }),
);

// POST /api/doors/:id/rotate-key -> new reader_key (returned once)
router.post(
    '/:id/rotate-key',
    ah(async (req, res) => {
        const readerKey = crypto.randomBytes(32).toString('hex');
        const { rows } = await db.query(
            'UPDATE doors SET reader_key = $1 WHERE id = $2 RETURNING id, name',
            [readerKey, req.params.id],
        );
        if (!rows[0]) return res.status(404).json({ error: 'not_found' });
        res.json({ ...rows[0], reader_key: readerKey });
    }),
);

// PATCH /api/doors/:id  { name?, location?, relayUnlockMs?, failPolicy? }
router.patch(
    '/:id',
    ah(async (req, res) => {
        const { name, location, relayUnlockMs, failPolicy } = req.body || {};
        const sets = [];
        const vals = [];
        let i = 1;
        if (name !== undefined) { sets.push(`name = $${i++}`); vals.push(name); }
        if (location !== undefined) { sets.push(`location = $${i++}`); vals.push(location); }
        if (relayUnlockMs !== undefined) { sets.push(`relay_unlock_ms = $${i++}`); vals.push(relayUnlockMs); }
        if (failPolicy !== undefined) { sets.push(`fail_policy = $${i++}`); vals.push(failPolicy); }
        if (!sets.length) return res.status(400).json({ error: 'no_changes' });
        vals.push(req.params.id);
        const { rows } = await db.query(
            `UPDATE doors SET ${sets.join(', ')} WHERE id = $${i} RETURNING id, name, location, fail_policy, relay_unlock_ms`,
            vals,
        );
        if (!rows[0]) return res.status(404).json({ error: 'not_found' });
        res.json(rows[0]);
    }),
);

// DELETE /api/doors/:id
router.delete(
    '/:id',
    ah(async (req, res) => {
        const { rowCount } = await db.query('DELETE FROM doors WHERE id = $1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ error: 'not_found' });
        res.status(204).end();
    }),
);

module.exports = router;
