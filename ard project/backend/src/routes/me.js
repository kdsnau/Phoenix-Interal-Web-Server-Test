'use strict';
const express = require('express');
const db = require('../db/pool');
const { authRequired } = require('../middleware/auth');
const { issueToken } = require('../services/tokens');
const config = require('../config');
const { ah } = require('../util/async');

// Mobile-app endpoints: the signed-in user's own card + rotating token + history.
const router = express.Router();
router.use(authRequired);

// GET /api/me/credential -> the user's phone credential (public_id + label)
router.get(
    '/credential',
    ah(async (req, res) => {
        const { rows } = await db.query(
            `SELECT id, public_id, label, active, issued_at
               FROM credentials
              WHERE user_id = $1 AND type = 'phone' AND revoked_at IS NULL AND active = TRUE
              ORDER BY issued_at DESC LIMIT 1`,
            [req.user.id],
        );
        if (!rows[0]) return res.status(404).json({ error: 'no_phone_credential' });
        res.json(rows[0]);
    }),
);

// POST /api/me/token -> mint a short-lived rotating token to present over HCE
router.post(
    '/token',
    ah(async (req, res) => {
        const { rows } = await db.query(
            `SELECT public_id, token_key
               FROM credentials
              WHERE user_id = $1 AND type = 'phone' AND revoked_at IS NULL AND active = TRUE
              ORDER BY issued_at DESC LIMIT 1`,
            [req.user.id],
        );
        if (!rows[0]) return res.status(404).json({ error: 'no_phone_credential' });
        const { token, exp } = issueToken(rows[0], config.phoneTokenTtl);
        res.json({ token, exp, ttl: config.phoneTokenTtl });
    }),
);

// GET /api/me/events?limit= -> the user's own scan history
router.get(
    '/events',
    ah(async (req, res) => {
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const { rows } = await db.query(
            `SELECT e.id, e.decision, e.reason, e.was_offline, e.scanned_at, d.name AS door_name
               FROM access_events e LEFT JOIN doors d ON d.id = e.door_id
              WHERE e.user_id = $1
              ORDER BY e.scanned_at DESC LIMIT $2`,
            [req.user.id, limit],
        );
        res.json(rows);
    }),
);

module.exports = router;
