const express = require('express');
const pool    = require('../db/pool');
const { authenticate } = require('../middleware/requireRole');
const { getLeaderboard } = require('./profile');

const router = express.Router();

/* GET /api/dashboard/summary
   The signed-in user's at-a-glance summary notes:
   active clients, technician headcount, tickets assigned to them,
   their leaderboard standing, and unread messages (count + who from). */
router.get('/summary', authenticate, async (req, res) => {
    const uid = req.user.id;
    try {
        const [clientsRes, techRes, assignedRes, unreadRes, board] = await Promise.all([
            pool.query('SELECT COUNT(*)::int AS n FROM clients').catch(() => ({ rows: [{ n: 0 }] })),
            pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'technician'").catch(() => ({ rows: [{ n: 0 }] })),
            pool.query(
                `SELECT COUNT(*)::int AS n FROM service_tickets
                 WHERE $1 = ANY(assignee_ids) AND status NOT IN ('resolved', 'closed')`,
                [uid]
            ).catch(() => ({ rows: [{ n: 0 }] })),
            pool.query(
                `SELECT u.name, COUNT(*)::int AS cnt
                 FROM messages m JOIN users u ON u.id = m.from_id
                 WHERE m.to_id = $1 AND m.read = FALSE
                 GROUP BY u.id, u.name
                 ORDER BY MAX(m.created_at) DESC`,
                [uid]
            ).catch(() => ({ rows: [] })),
            getLeaderboard('month').catch(() => []),
        ]);

        const mine = board.find(e => e.user_id === uid);
        const unreadRows = unreadRes.rows;

        res.json({
            active_clients:   clientsRes.rows[0].n,
            technicians:      techRes.rows[0].n,
            assigned_tickets: assignedRes.rows[0].n,
            leaderboard:      mine ? { rank: mine.rank, total: board.length } : null,
            unread_messages: {
                count:   unreadRows.reduce((s, r) => s + r.cnt, 0),
                senders: unreadRows.map(r => r.name),
            },
        });
    } catch (err) {
        console.error('Dashboard summary error:', err.message);
        res.status(500).json({ error: 'Failed to load dashboard summary.' });
    }
});

module.exports = router;
