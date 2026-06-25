'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/pool');
const { signToken, authRequired } = require('../middleware/auth');
const { ah } = require('../util/async');

const router = express.Router();

// POST /api/auth/login  { email, password } -> { token, user }
router.post(
    '/login',
    ah(async (req, res) => {
        const { email, password } = req.body || {};
        if (!email || !password) return res.status(400).json({ error: 'missing_credentials' });

        const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = rows[0];
        if (!user || !user.password_hash || !user.active) {
            return res.status(401).json({ error: 'invalid_login' });
        }
        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) return res.status(401).json({ error: 'invalid_login' });

        res.json({
            token: signToken(user),
            user: { id: user.id, name: user.name, email: user.email, role: user.role },
        });
    }),
);

// GET /api/auth/me -> current token's user
router.get(
    '/me',
    authRequired,
    ah(async (req, res) => {
        const { rows } = await db.query(
            'SELECT id, name, email, role, active FROM users WHERE id = $1',
            [req.user.id],
        );
        if (!rows[0]) return res.status(404).json({ error: 'not_found' });
        res.json(rows[0]);
    }),
);

module.exports = router;
