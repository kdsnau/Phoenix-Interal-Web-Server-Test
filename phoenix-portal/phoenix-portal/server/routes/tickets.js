const express  = require('express');
const pool     = require('../db/pool');
const { requireRole } = require('../middleware/requireRole');
const { sendMail }    = require('../config/mailer');
const { gcalCreate, gcalUpdate, gcalDelete } = require('../config/gcal');

const router = express.Router();

/* ── Schema migrations ────────────────────────────────────────────────── */
pool.query(`ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS event_end TIMESTAMP`).catch(() => {});

/* ── GET /api/tickets ─────────────────────────────────────────────────── */
router.get('/', requireRole('technician', 'admin'), async (req, res) => {
    try {
        const q = `SELECT t.*, u.name AS creator_name, a.name AS assignee_name
                   FROM service_tickets t
                   LEFT JOIN users u ON t.created_by = u.id
                   LEFT JOIN users a ON t.assigned_to = a.id`;
        let result;
        if (req.user.role === 'admin') {
            result = await pool.query(q + ` ORDER BY t.created_at DESC`);
        } else {
            result = await pool.query(
                q + ` WHERE t.created_by = $1 OR t.assigned_to = $1 ORDER BY t.created_at DESC`,
                [req.user.id]
            );
        }
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

/* ── POST /api/tickets ────────────────────────────────────────────────── */
/* Admin only — technicians can work tickets but not create them. */
router.post('/', requireRole('admin'), async (req, res) => {
    const { title, description, assigned_to, event_start, event_end, event_location } = req.body;

    if (!title) return res.status(400).json({ error: 'Title is required.' });

    try {
        /* Tickets with a scheduled date are treated as calendar entries */
        const source = event_start ? 'calendar' : 'manual';

        const result = await pool.query(
            `INSERT INTO service_tickets
             (title, description, created_by, assigned_to, source, event_start, event_end, event_location)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [
                title,
                description || null,
                req.user.id,
                assigned_to || null,
                source,
                event_start  || null,
                event_end    || null,
                event_location || null,
            ]
        );
        let ticket = result.rows[0];

        /* Push to Google Calendar when a date is provided */
        if (source === 'calendar') {
            const techRow = assigned_to
                ? await pool.query('SELECT name FROM users WHERE id = $1', [assigned_to]).catch(() => ({ rows: [] }))
                : { rows: [] };
            const techName  = techRow.rows[0]?.name || null;
            const gEventId  = await gcalCreate(ticket, techName).catch(() => null);
            if (gEventId) {
                await pool.query(
                    `UPDATE service_tickets SET google_event_id = $1 WHERE id = $2`,
                    [gEventId, ticket.id]
                );
                ticket = { ...ticket, google_event_id: gEventId };
            }
        }

        /* Notify admins */
        const admins = await pool.query("SELECT email FROM users WHERE role = 'admin'");
        for (const admin of admins.rows) {
            await sendMail(
                admin.email,
                `New Ticket: ${title}`,
                `A new service ticket was created.\n\nTitle: ${title}\nDescription: ${description || 'N/A'}\nScheduled: ${event_start || 'Not set'}\nLocation: ${event_location || 'N/A'}\nCreated by: ${req.user.name}`
            ).catch(err => console.error('Ticket notify failed:', err));
        }

        return res.status(201).json(ticket);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

/* ── PATCH /api/tickets/:id ───────────────────────────────────────────── */
router.patch('/:id', requireRole('technician', 'admin'), async (req, res) => {
    const isTech = req.user.role === 'technician';
    let { status, assigned_to, event_start, event_end, event_location } = req.body;
    const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];

    if (status && !validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status.' });
    }

    try {
        /* Technicians may only change the STATUS of tickets assigned to them —
           no editing details (assignee, schedule, location). */
        if (isTech) {
            const own = await pool.query('SELECT assigned_to FROM service_tickets WHERE id = $1', [req.params.id]);
            if (own.rowCount === 0) return res.status(404).json({ error: 'Ticket not found.' });
            if (own.rows[0].assigned_to !== req.user.id) {
                return res.status(403).json({ error: 'Technicians can only update tickets assigned to them.' });
            }
            if (!status) return res.status(403).json({ error: 'Technicians can only change ticket status.' });
            assigned_to = event_start = event_end = event_location = undefined;
        }

        await pool.query(
            `UPDATE service_tickets
             SET status         = COALESCE($1, status),
                 assigned_to    = CASE WHEN $2::text = '__unassign__' THEN NULL
                                       WHEN $2 IS NOT NULL           THEN $2::int
                                       ELSE assigned_to END,
                 event_start    = COALESCE($3::timestamp, event_start),
                 event_end      = COALESCE($4::timestamp, event_end),
                 event_location = COALESCE($5, event_location),
                 source         = CASE WHEN $3 IS NOT NULL THEN 'calendar' ELSE source END,
                 updated_at     = NOW()
             WHERE id = $6`,
            [
                status         || null,
                assigned_to !== undefined ? String(assigned_to) : null,
                event_start    || null,
                event_end      || null,
                event_location || null,
                req.params.id,
            ]
        );

        const full = await pool.query(
            `SELECT t.*, u.name AS creator_name, a.name AS assignee_name
             FROM service_tickets t
             LEFT JOIN users u ON t.created_by = u.id
             LEFT JOIN users a ON t.assigned_to = a.id
             WHERE t.id = $1`,
            [req.params.id]
        );
        if (full.rowCount === 0) return res.status(404).json({ error: 'Ticket not found.' });

        const ticket = full.rows[0];

        /* Keep Google Calendar event in sync */
        if (ticket.google_event_id) {
            gcalUpdate(ticket.google_event_id, ticket, ticket.assignee_name || null).catch(() => {});
        }

        return res.json(ticket);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

/* ── DELETE /api/tickets/:id ─────────────────────────────────────────── */
router.delete('/:id', requireRole('admin'), async (req, res) => {
    try {
        const row = await pool.query(
            `SELECT google_event_id FROM service_tickets WHERE id = $1`,
            [req.params.id]
        );
        const gEventId = row.rows[0]?.google_event_id || null;

        const result = await pool.query('DELETE FROM service_tickets WHERE id = $1', [req.params.id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Ticket not found.' });

        if (gEventId) gcalDelete(gEventId).catch(() => {});

        return res.json({ message: 'Ticket deleted.' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

module.exports = router;
