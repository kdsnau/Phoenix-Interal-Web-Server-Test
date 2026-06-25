'use strict';
const express = require('express');
const db = require('../db/pool');
const { authRequired } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { ah } = require('../util/async');

const router = express.Router();
router.use(authRequired, requireRole('admin'));

router.get(
    '/',
    ah(async (req, res) => {
        const { rows } = await db.query(`
            SELECT g.id, g.name, g.created_at, COALESCE(m.cnt,0) AS member_count
              FROM access_groups g
              LEFT JOIN (SELECT group_id, COUNT(*) cnt FROM user_groups GROUP BY group_id) m ON m.group_id = g.id
             ORDER BY g.name`);
        res.json(rows);
    }),
);

router.post(
    '/',
    ah(async (req, res) => {
        const { name } = req.body || {};
        if (!name) return res.status(400).json({ error: 'missing_name' });
        try {
            const { rows } = await db.query(
                'INSERT INTO access_groups (name) VALUES ($1) RETURNING id, name, created_at',
                [name],
            );
            res.status(201).json(rows[0]);
        } catch (err) {
            if (err.code === '23505') return res.status(409).json({ error: 'name_taken' });
            throw err;
        }
    }),
);

router.delete(
    '/:id',
    ah(async (req, res) => {
        const { rowCount } = await db.query('DELETE FROM access_groups WHERE id = $1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ error: 'not_found' });
        res.status(204).end();
    }),
);

module.exports = router;
