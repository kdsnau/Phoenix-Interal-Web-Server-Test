'use strict';
const express = require('express');
const db = require('../db/pool');
const { authRequired } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { ah } = require('../util/async');

const router = express.Router();
router.use(authRequired, requireRole('admin'));

// GET /api/scans?limit=&doorId=&userId=&decision= -> recent access events (joined to names)
router.get(
    '/',
    ah(async (req, res) => {
        const limit = Math.min(Number(req.query.limit) || 100, 500);
        const where = [];
        const vals = [];
        let i = 1;
        if (req.query.doorId) { where.push(`e.door_id = $${i++}`); vals.push(req.query.doorId); }
        if (req.query.userId) { where.push(`e.user_id = $${i++}`); vals.push(req.query.userId); }
        if (req.query.decision) { where.push(`e.decision = $${i++}`); vals.push(req.query.decision); }
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        vals.push(limit);
        const { rows } = await db.query(
            `SELECT e.id, e.decision, e.reason, e.raw_uid, e.was_offline, e.scanned_at,
                    d.name AS door_name, u.name AS user_name
               FROM access_events e
               LEFT JOIN doors d ON d.id = e.door_id
               LEFT JOIN users u ON u.id = e.user_id
               ${clause}
              ORDER BY e.scanned_at DESC
              LIMIT $${i}`,
            vals,
        );
        res.json(rows);
    }),
);

// GET /api/scans/summary -> counts for the dashboard cards/charts
router.get(
    '/summary',
    ah(async (req, res) => {
        const totals = (
            await db.query(`
                SELECT
                  COUNT(*) FILTER (WHERE decision='granted')                            AS granted,
                  COUNT(*) FILTER (WHERE decision='denied')                             AS denied,
                  COUNT(*) FILTER (WHERE scanned_at > NOW() - INTERVAL '24 hours')      AS last_24h
                FROM access_events`)
        ).rows[0];

        const perDoor = (
            await db.query(`
                SELECT d.id, d.name, COUNT(e.*) AS scans
                  FROM doors d LEFT JOIN access_events e ON e.door_id = d.id
                 GROUP BY d.id, d.name ORDER BY scans DESC`)
        ).rows;

        const daily = (
            await db.query(`
                SELECT date_trunc('day', scanned_at) AS day,
                       COUNT(*) FILTER (WHERE decision='granted') AS granted,
                       COUNT(*) FILTER (WHERE decision='denied')  AS denied
                  FROM access_events
                 WHERE scanned_at > NOW() - INTERVAL '14 days'
                 GROUP BY day ORDER BY day`)
        ).rows;

        res.json({ totals, perDoor, daily });
    }),
);

module.exports = router;
