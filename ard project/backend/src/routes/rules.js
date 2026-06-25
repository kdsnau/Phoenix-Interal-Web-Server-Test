'use strict';
const express = require('express');
const db = require('../db/pool');
const { authRequired } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { ah } = require('../util/async');

const router = express.Router();
router.use(authRequired, requireRole('admin'));

const RULE_FIELDS =
    'id, name, type, scope, target_id, door_id, days_mask, start_time, end_time, effect, priority, active, created_at';

router.get(
    '/',
    ah(async (req, res) => {
        const { rows } = await db.query(`SELECT ${RULE_FIELDS} FROM rules ORDER BY priority DESC, id`);
        res.json(rows);
    }),
);

// POST /api/rules  { name, type, scope, targetId?, doorId?, daysMask?, startTime?, endTime?, effect?, priority? }
router.post(
    '/',
    ah(async (req, res) => {
        const b = req.body || {};
        if (!b.name || !b.type) return res.status(400).json({ error: 'missing_fields' });
        const { rows } = await db.query(
            `INSERT INTO rules (name, type, scope, target_id, door_id, days_mask, start_time, end_time, effect, priority, active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING ${RULE_FIELDS}`,
            [
                b.name,
                b.type,
                b.scope || 'all',
                b.targetId ?? null,
                b.doorId ?? null,
                b.daysMask ?? 127,
                b.startTime ?? null,
                b.endTime ?? null,
                b.effect || 'allow',
                b.priority ?? 0,
                b.active ?? true,
            ],
        );
        res.status(201).json(rows[0]);
    }),
);

router.patch(
    '/:id',
    ah(async (req, res) => {
        const map = {
            name: 'name', type: 'type', scope: 'scope', targetId: 'target_id', doorId: 'door_id',
            daysMask: 'days_mask', startTime: 'start_time', endTime: 'end_time', effect: 'effect',
            priority: 'priority', active: 'active',
        };
        const sets = [];
        const vals = [];
        let i = 1;
        for (const [k, col] of Object.entries(map)) {
            if (req.body && req.body[k] !== undefined) { sets.push(`${col} = $${i++}`); vals.push(req.body[k]); }
        }
        if (!sets.length) return res.status(400).json({ error: 'no_changes' });
        vals.push(req.params.id);
        const { rows } = await db.query(
            `UPDATE rules SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${RULE_FIELDS}`,
            vals,
        );
        if (!rows[0]) return res.status(404).json({ error: 'not_found' });
        res.json(rows[0]);
    }),
);

router.delete(
    '/:id',
    ah(async (req, res) => {
        const { rowCount } = await db.query('DELETE FROM rules WHERE id = $1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ error: 'not_found' });
        res.status(204).end();
    }),
);

module.exports = router;
