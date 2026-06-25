'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/pool');
const { authRequired } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { ah } = require('../util/async');

const router = express.Router();
router.use(authRequired, requireRole('admin'));

// GET /api/users -> list with credential + group counts
router.get(
    '/',
    ah(async (req, res) => {
        const { rows } = await db.query(`
            SELECT u.id, u.name, u.email, u.role, u.active, u.created_at,
                   COALESCE(c.cnt, 0)  AS credential_count,
                   COALESCE(g.cnt, 0)  AS group_count
              FROM users u
              LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM credentials  WHERE revoked_at IS NULL GROUP BY user_id) c ON c.user_id = u.id
              LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM user_groups GROUP BY user_id) g ON g.user_id = u.id
             ORDER BY u.created_at DESC`);
        res.json(rows);
    }),
);

// GET /api/users/:id -> user + credentials + groups
router.get(
    '/:id',
    ah(async (req, res) => {
        const { rows } = await db.query(
            'SELECT id, name, email, role, active, created_at FROM users WHERE id = $1',
            [req.params.id],
        );
        const user = rows[0];
        if (!user) return res.status(404).json({ error: 'not_found' });
        user.credentials = (
            await db.query(
                'SELECT id, type, uid, public_id, label, active, issued_at, revoked_at FROM credentials WHERE user_id = $1 ORDER BY issued_at DESC',
                [user.id],
            )
        ).rows;
        user.groups = (
            await db.query(
                'SELECT g.id, g.name FROM access_groups g JOIN user_groups ug ON ug.group_id = g.id WHERE ug.user_id = $1',
                [user.id],
            )
        ).rows;
        res.json(user);
    }),
);

// POST /api/users  { name, email, role?, password? }
router.post(
    '/',
    ah(async (req, res) => {
        const { name, email, role = 'user', password } = req.body || {};
        if (!name || !email) return res.status(400).json({ error: 'missing_fields' });
        const hash = password ? await bcrypt.hash(password, 10) : null;
        try {
            const { rows } = await db.query(
                'INSERT INTO users (name, email, role, password_hash) VALUES ($1,$2,$3,$4) RETURNING id, name, email, role, active, created_at',
                [name, email, role, hash],
            );
            res.status(201).json(rows[0]);
        } catch (err) {
            if (err.code === '23505') return res.status(409).json({ error: 'email_taken' });
            throw err;
        }
    }),
);

// PATCH /api/users/:id  { name?, role?, active?, password? }
router.patch(
    '/:id',
    ah(async (req, res) => {
        const { name, role, active, password } = req.body || {};
        const sets = [];
        const vals = [];
        let i = 1;
        if (name !== undefined) { sets.push(`name = $${i++}`); vals.push(name); }
        if (role !== undefined) { sets.push(`role = $${i++}`); vals.push(role); }
        if (active !== undefined) { sets.push(`active = $${i++}`); vals.push(active); }
        if (password) { sets.push(`password_hash = $${i++}`); vals.push(await bcrypt.hash(password, 10)); }
        if (!sets.length) return res.status(400).json({ error: 'no_changes' });
        vals.push(req.params.id);
        const { rows } = await db.query(
            `UPDATE users SET ${sets.join(', ')} WHERE id = $${i} RETURNING id, name, email, role, active`,
            vals,
        );
        if (!rows[0]) return res.status(404).json({ error: 'not_found' });
        res.json(rows[0]);
    }),
);

// DELETE /api/users/:id -> cascades credentials; access_events keep the row (user_id set null) for audit
router.delete(
    '/:id',
    ah(async (req, res) => {
        const { rowCount } = await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ error: 'not_found' });
        res.status(204).end();
    }),
);

// PUT /api/users/:id/groups  { groupIds:[] } -> replace membership
router.put(
    '/:id/groups',
    ah(async (req, res) => {
        const groupIds = Array.isArray(req.body?.groupIds) ? req.body.groupIds : [];
        await db.query('DELETE FROM user_groups WHERE user_id = $1', [req.params.id]);
        for (const gid of groupIds) {
            await db.query(
                'INSERT INTO user_groups (user_id, group_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
                [req.params.id, gid],
            );
        }
        res.json({ ok: true, groupIds });
    }),
);

module.exports = router;
