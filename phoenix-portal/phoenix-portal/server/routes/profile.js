const express = require('express');
const pool    = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/requireRole');

const router = express.Router();

/* Free-text note the user keeps on their own profile. */
pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_note TEXT`).catch(() => {});

/* Build a work profile for a user: hours worked (from finished, scheduled
   tickets they're assigned to), ticket counts, assigned vehicle(s), and the
   inventory they've consumed on jobs. */
async function buildProfile(userId) {
    const id = Number(userId);
    if (!Number.isInteger(id)) return null;

    const u = await pool.query('SELECT id, name, email, role, created_at, profile_note FROM users WHERE id = $1', [id]);
    if (u.rowCount === 0) return null;

    const [stats, byType, vehicles, inventory, recent] = await Promise.all([
        /* Hours worked = sum of (departure − entry) over finished tickets that
           have both times set. Durations are timezone-agnostic. */
        pool.query(`
            SELECT
                COUNT(*)::int AS total_assigned,
                COUNT(*) FILTER (WHERE status IN ('resolved','closed'))::int AS completed,
                COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed'))::int AS open_count,
                COALESCE(SUM(EXTRACT(EPOCH FROM (event_end - event_start)) / 3600.0)
                         FILTER (WHERE status IN ('resolved','closed')
                                 AND event_start IS NOT NULL AND event_end IS NOT NULL
                                 AND event_end > event_start), 0) AS hours_worked
            FROM service_tickets
            WHERE $1 = ANY(assignee_ids)
        `, [id]).catch(() => ({ rows: [{}] })),

        pool.query(`
            SELECT COALESCE(ticket_type, 'Service') AS type, COUNT(*)::int AS count
            FROM service_tickets
            WHERE $1 = ANY(assignee_ids)
            GROUP BY ticket_type
            ORDER BY count DESC
        `, [id]).catch(() => ({ rows: [] })),

        pool.query(`
            SELECT id, name, vehicle_id, year, make, model, mileage
            FROM vehicles WHERE driver_id = $1 ORDER BY name
        `, [id]).catch(() => ({ rows: [] })),

        pool.query(`
            SELECT ii.name AS item_name, ii.sku, ii.unit,
                   SUM(ti.quantity)::int AS total_qty,
                   COUNT(DISTINCT ti.ticket_id)::int AS ticket_count
            FROM ticket_items ti
            JOIN service_tickets st ON st.id = ti.ticket_id AND $1 = ANY(st.assignee_ids)
            JOIN inventory_items ii ON ii.id = ti.inventory_item_id
            WHERE ti.used = TRUE
            GROUP BY ii.id, ii.name, ii.sku, ii.unit
            ORDER BY total_qty DESC
        `, [id]).catch(() => ({ rows: [] })),

        pool.query(`
            SELECT st.id, st.title, st.ticket_type, st.status, st.event_start, st.event_end,
                   CASE WHEN st.event_start IS NOT NULL AND st.event_end IS NOT NULL AND st.event_end > st.event_start
                        THEN ROUND((EXTRACT(EPOCH FROM (st.event_end - st.event_start)) / 3600.0)::numeric, 2)
                        ELSE NULL END AS hours,
                   c.name AS client_name
            FROM service_tickets st
            LEFT JOIN clients c ON c.id = st.client_id
            WHERE $1 = ANY(st.assignee_ids) AND st.status IN ('resolved','closed')
            ORDER BY COALESCE(st.event_end, st.updated_at, st.created_at) DESC
            LIMIT 10
        `, [id]).catch(() => ({ rows: [] })),
    ]);

    const s = stats.rows[0] || {};

    /* This month's hours-worked placement among technicians. */
    const board = await getLeaderboard('month').catch(() => []);
    const mine  = board.find(e => e.user_id === id);

    return {
        user: u.rows[0],
        stats: {
            total_assigned: s.total_assigned || 0,
            completed:      s.completed      || 0,
            open:           s.open_count     || 0,
            hours_worked:   Number(s.hours_worked || 0),
        },
        placement:     mine ? { rank: mine.rank, total: board.length, hours: mine.hours } : null,
        ticketsByType: byType.rows,
        vehicles:      vehicles.rows,
        inventory:     inventory.rows,
        recentTickets: recent.rows,
    };
}

/* Rank technicians by hours worked. period='month' → tickets whose departure
   falls in the current Phoenix month; 'all' → all time. Techs with no hours
   still appear (at 0) via the LEFT JOIN, so everyone sees their standing. */
async function getLeaderboard(period = 'month') {
    const monthFilter = period === 'month'
        ? `AND date_trunc('month', st.event_end) = date_trunc('month', (now() AT TIME ZONE 'America/Phoenix'))`
        : '';
    const r = await pool.query(`
        SELECT u.id AS user_id, u.name,
               COALESCE(SUM(EXTRACT(EPOCH FROM (st.event_end - st.event_start)) / 3600.0), 0) AS hours,
               COUNT(st.id)::int AS completed_tickets
        FROM users u
        LEFT JOIN service_tickets st
               ON u.id = ANY(st.assignee_ids)
              AND st.status IN ('resolved','closed')
              AND st.event_start IS NOT NULL AND st.event_end IS NOT NULL
              AND st.event_end > st.event_start
              ${monthFilter}
        WHERE u.role = 'technician'
        GROUP BY u.id, u.name
        ORDER BY hours DESC, completed_tickets DESC, u.name ASC
    `);
    return r.rows.map((row, i) => ({
        user_id:           row.user_id,
        name:              row.name,
        hours:             Number(row.hours),
        completed_tickets: row.completed_tickets,
        rank:              i + 1,
    }));
}

/* GET /api/profile — the signed-in user's own profile. */
router.get('/', authenticate, async (req, res) => {
    try {
        const data = await buildProfile(req.user.id);
        if (!data) return res.status(404).json({ error: 'User not found.' });
        res.json(data);
    } catch (err) {
        console.error('Profile error:', err);
        res.status(500).json({ error: 'Failed to load profile.' });
    }
});

/* PUT /api/profile/note { note } — update your OWN profile note. */
router.put('/note', authenticate, async (req, res) => {
    const note = typeof req.body.note === 'string' ? req.body.note : '';
    try {
        await pool.query('UPDATE users SET profile_note = $1 WHERE id = $2', [note, req.user.id]);
        res.json({ note });
    } catch (err) {
        console.error('Profile note error:', err);
        res.status(500).json({ error: 'Failed to save note.' });
    }
});

/* GET /api/profile/leaderboard?period=month|all — hours-worked ranking (techs). */
router.get('/leaderboard', authenticate, async (req, res) => {
    try {
        const period = req.query.period === 'all' ? 'all' : 'month';
        const entries = await getLeaderboard(period);
        res.json({ period, entries });
    } catch (err) {
        console.error('Leaderboard error:', err);
        res.status(500).json({ error: 'Failed to load leaderboard.' });
    }
});

/* GET /api/profile/:id — admins can pull up any user's profile. */
router.get('/:id', requireRole('admin'), async (req, res) => {
    try {
        const data = await buildProfile(req.params.id);
        if (!data) return res.status(404).json({ error: 'User not found.' });
        /* The profile note is private to its owner — never expose it to others. */
        if (Number(req.params.id) !== req.user.id && data.user) data.user.profile_note = null;
        res.json(data);
    } catch (err) {
        console.error('Profile error:', err);
        res.status(500).json({ error: 'Failed to load profile.' });
    }
});

module.exports = router;
