const express  = require('express');
const pool     = require('../db/pool');
const { requireRole } = require('../middleware/requireRole');
const { sendMail }    = require('../config/mailer');
const { gcalCreate, gcalUpdate, gcalDelete } = require('../config/gcal');

const router = express.Router();

/* ── Schema migrations ────────────────────────────────────────────────── */
pool.query(`ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS event_end TIMESTAMP`).catch(() => {});

/* Inventory items used on a ticket; stock is drawn down when the ticket is completed. */
pool.query(`
    CREATE TABLE IF NOT EXISTS ticket_items (
        id                SERIAL PRIMARY KEY,
        ticket_id         INTEGER NOT NULL REFERENCES service_tickets(id) ON DELETE CASCADE,
        inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
        quantity          INTEGER NOT NULL DEFAULT 1,
        used              BOOLEAN NOT NULL DEFAULT FALSE,
        deducted          BOOLEAN NOT NULL DEFAULT FALSE,
        created_at        TIMESTAMP DEFAULT NOW(),
        UNIQUE(ticket_id, inventory_item_id)
    )
`).catch(() => {});

/* Multiple technicians per ticket. assigned_to stays in sync with assignee_ids[1]
   for backward compatibility (calendar label, legacy reads). */
pool.query(`ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS assignee_ids INTEGER[] NOT NULL DEFAULT '{}'`).catch(() => {});
/* Tracks whether the "~1 hour before" appointment reminder email has gone out. */
pool.query(`ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN NOT NULL DEFAULT FALSE`).catch(() => {});
pool.query(`UPDATE service_tickets SET assignee_ids = ARRAY[assigned_to]
            WHERE assigned_to IS NOT NULL AND (assignee_ids IS NULL OR assignee_ids = '{}')`).catch(() => {});

/* Normalize an assignee payload (array of ids, or a single id) → clean int[]. */
function normalizeAssigneeIds(body) {
    let ids = [];
    if (Array.isArray(body.assignee_ids))      ids = body.assignee_ids;
    else if (body.assigned_to != null && body.assigned_to !== '' && body.assigned_to !== '__unassign__')
        ids = [body.assigned_to];
    return [...new Set(ids.map(Number).filter(n => Number.isInteger(n) && n > 0))];
}

/* Comma-joined assignee names for the Google Calendar event label. */
async function assigneeLabel(ids) {
    if (!ids || ids.length === 0) return null;
    const r = await pool.query('SELECT name FROM users WHERE id = ANY($1) ORDER BY name', [ids]).catch(() => ({ rows: [] }));
    return r.rows.map(x => x.name).join(', ') || null;
}

/* Technicians may only touch tickets assigned to them; admins, any ticket. */
async function assertTicketAccess(req, ticketId) {
    if (req.user.role === 'admin') return;
    const r = await pool.query('SELECT assignee_ids FROM service_tickets WHERE id = $1', [ticketId]);
    if (r.rowCount === 0) throw Object.assign(new Error('Ticket not found.'), { status: 404 });
    if (!(r.rows[0].assignee_ids || []).includes(req.user.id)) {
        throw Object.assign(new Error('You can only manage tickets assigned to you.'), { status: 403 });
    }
}

/* ── GET /api/tickets ─────────────────────────────────────────────────── */
router.get('/', requireRole('technician', 'admin'), async (req, res) => {
    try {
        const q = `SELECT t.*, u.name AS creator_name,
                          COALESCE((SELECT array_agg(x.name ORDER BY x.name)
                                    FROM users x WHERE x.id = ANY(t.assignee_ids)), '{}') AS assignee_names
                   FROM service_tickets t
                   LEFT JOIN users u ON t.created_by = u.id`;
        let result;
        if (req.user.role === 'admin') {
            result = await pool.query(q + ` ORDER BY t.created_at DESC`);
        } else {
            result = await pool.query(
                q + ` WHERE t.created_by = $1 OR $1 = ANY(t.assignee_ids) ORDER BY t.created_at DESC`,
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
    const { title, description, event_start, event_end, event_location, client_id } = req.body;

    if (!title) return res.status(400).json({ error: 'Title is required.' });

    try {
        /* Tickets with a scheduled date are treated as calendar entries */
        const source = event_start ? 'calendar' : 'manual';
        const ids     = normalizeAssigneeIds(req.body);
        const primary = ids[0] || null;

        const result = await pool.query(
            `INSERT INTO service_tickets
             (title, description, created_by, assigned_to, assignee_ids, source, event_start, event_end, event_location, client_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [
                title,
                description || null,
                req.user.id,
                primary,
                ids,
                source,
                event_start  || null,
                event_end    || null,
                event_location || null,
                client_id || null,
            ]
        );
        let ticket = result.rows[0];

        /* Push to Google Calendar when a date is provided */
        if (source === 'calendar') {
            const techName  = await assigneeLabel(ids);
            const gEventId  = await gcalCreate(ticket, techName).catch(() => null);
            if (gEventId) {
                await pool.query(
                    `UPDATE service_tickets SET google_event_id = $1 WHERE id = $2`,
                    [gEventId, ticket.id]
                );
                ticket = { ...ticket, google_event_id: gEventId };
            }
        }

        const sched = event_start ? new Date(event_start).toLocaleString('en-US') : 'Not set';

        /* Notify the assigned technician(s) — they've got work to do. */
        if (ids.length > 0) {
            const techs = await pool.query('SELECT email, name FROM users WHERE id = ANY($1)', [ids]).catch(() => ({ rows: [] }));
            for (const t of techs.rows) {
                await sendMail(
                    t.email,
                    `You've been assigned a ticket: ${title}`,
                    `Hi ${t.name},\n\nYou have been assigned a service ticket.\n\nTitle: ${title}\nDescription: ${description || 'N/A'}\nScheduled: ${sched}\nLocation: ${event_location || 'N/A'}\nAssigned by: ${req.user.name}\n\nPhoenix Security & Technology`
                ).catch(err => console.error('Tech assign email failed:', err));
            }
        }

        /* Notify admins */
        const admins = await pool.query("SELECT email FROM users WHERE role = 'admin'");
        for (const admin of admins.rows) {
            await sendMail(
                admin.email,
                `New Ticket: ${title}`,
                `A new service ticket was created.\n\nTitle: ${title}\nDescription: ${description || 'N/A'}\nScheduled: ${sched}\nLocation: ${event_location || 'N/A'}\nCreated by: ${req.user.name}`
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
    let { status, event_start, event_end, event_location } = req.body;
    const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];

    if (status && !validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status.' });
    }

    /* Assignee change (admins only). null → leave unchanged; [] → unassign all.
       Accepts a new `assignee_ids` array or the legacy single `assigned_to`. */
    let assigneeIds = null;
    if (!isTech) {
        if (Array.isArray(req.body.assignee_ids)) {
            assigneeIds = normalizeAssigneeIds(req.body);
        } else if (req.body.assigned_to !== undefined) {
            assigneeIds = (req.body.assigned_to === '__unassign__' || req.body.assigned_to === '' || req.body.assigned_to == null)
                ? [] : normalizeAssigneeIds(req.body);
        }
    }

    try {
        /* Technicians may only change the STATUS of tickets assigned to them —
           no editing details (assignees, schedule, location). */
        if (isTech) {
            const own = await pool.query('SELECT assignee_ids FROM service_tickets WHERE id = $1', [req.params.id]);
            if (own.rowCount === 0) return res.status(404).json({ error: 'Ticket not found.' });
            if (!(own.rows[0].assignee_ids || []).includes(req.user.id)) {
                return res.status(403).json({ error: 'Technicians can only update tickets assigned to them.' });
            }
            if (!status) return res.status(403).json({ error: 'Technicians can only change ticket status.' });
            event_start = event_end = event_location = undefined;
        }

        await pool.query(
            `UPDATE service_tickets
             SET status         = COALESCE($1, status),
                 assignee_ids   = COALESCE($2::int[], assignee_ids),
                 assigned_to    = CASE WHEN $2::int[] IS NOT NULL THEN ($2::int[])[1] ELSE assigned_to END,
                 reminder_sent  = CASE WHEN $3 IS NOT NULL THEN FALSE ELSE reminder_sent END,
                 event_start    = COALESCE($3::timestamp, event_start),
                 event_end      = COALESCE($4::timestamp, event_end),
                 event_location = COALESCE($5, event_location),
                 source         = CASE WHEN $3 IS NOT NULL THEN 'calendar' ELSE source END,
                 updated_at     = NOW()
             WHERE id = $6`,
            [
                status         || null,
                assigneeIds,
                event_start    || null,
                event_end      || null,
                event_location || null,
                req.params.id,
            ]
        );

        /* When a ticket is completed, draw down stock for any used items not yet
           deducted (the `deducted` flag keeps repeated completes idempotent). */
        if (status === 'resolved' || status === 'closed') {
            await pool.query(
                `WITH to_deduct AS (
                     UPDATE ticket_items SET deducted = TRUE
                     WHERE ticket_id = $1 AND used = TRUE AND deducted = FALSE
                     RETURNING inventory_item_id, quantity
                 )
                 UPDATE inventory_items ii
                 SET quantity = GREATEST(ii.quantity - d.qty, 0), updated_at = NOW()
                 FROM (SELECT inventory_item_id, SUM(quantity) AS qty
                       FROM to_deduct GROUP BY inventory_item_id) d
                 WHERE ii.id = d.inventory_item_id`,
                [req.params.id]
            ).catch(e => console.error('Ticket stock deduction failed:', e.message));
        }

        const full = await pool.query(
            `SELECT t.*, u.name AS creator_name,
                    COALESCE((SELECT array_agg(x.name ORDER BY x.name)
                              FROM users x WHERE x.id = ANY(t.assignee_ids)), '{}') AS assignee_names
             FROM service_tickets t
             LEFT JOIN users u ON t.created_by = u.id
             WHERE t.id = $1`,
            [req.params.id]
        );
        if (full.rowCount === 0) return res.status(404).json({ error: 'Ticket not found.' });

        const ticket = full.rows[0];

        /* Keep Google Calendar event in sync */
        if (ticket.google_event_id) {
            const label = (ticket.assignee_names || []).join(', ') || null;
            gcalUpdate(ticket.google_event_id, ticket, label).catch(() => {});
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

/* ═══ Ticket inventory items ══════════════════════════════════════════════ */
const ITEM_SELECT = `
    SELECT ti.id, ti.quantity, ti.used, ti.deducted, ti.inventory_item_id,
           ii.name AS item_name, ii.sku, ii.unit, ii.quantity AS stock
    FROM ticket_items ti
    JOIN inventory_items ii ON ii.id = ti.inventory_item_id`;

/* GET /api/tickets/:id/items */
router.get('/:id/items', requireRole('technician', 'admin'), async (req, res) => {
    try {
        await assertTicketAccess(req, req.params.id);
        const r = await pool.query(`${ITEM_SELECT} WHERE ti.ticket_id = $1 ORDER BY ii.name`, [req.params.id]);
        return res.json(r.rows);
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        console.error(err); return res.status(500).json({ error: 'Server error.' });
    }
});

/* POST /api/tickets/:id/items  { inventory_item_id, quantity } */
router.post('/:id/items', requireRole('technician', 'admin'), async (req, res) => {
    const { inventory_item_id, quantity, used } = req.body;
    if (!inventory_item_id) return res.status(400).json({ error: 'inventory_item_id is required.' });
    try {
        await assertTicketAccess(req, req.params.id);
        const ins = await pool.query(
            `INSERT INTO ticket_items (ticket_id, inventory_item_id, quantity, used)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (ticket_id, inventory_item_id)
             DO UPDATE SET quantity = EXCLUDED.quantity, used = EXCLUDED.used
             RETURNING id`,
            [req.params.id, inventory_item_id, quantity > 0 ? quantity : 1, !!used]
        );
        const full = await pool.query(`${ITEM_SELECT} WHERE ti.id = $1`, [ins.rows[0].id]);
        return res.status(201).json(full.rows[0]);
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        console.error(err); return res.status(500).json({ error: 'Failed to add item.' });
    }
});

/* PATCH /api/tickets/:id/items/:itemId  { used, quantity } */
router.patch('/:id/items/:itemId', requireRole('technician', 'admin'), async (req, res) => {
    const { used, quantity } = req.body;
    try {
        await assertTicketAccess(req, req.params.id);
        const upd = await pool.query(
            `UPDATE ticket_items
             SET used = COALESCE($1, used), quantity = COALESCE($2, quantity)
             WHERE id = $3 AND ticket_id = $4
             RETURNING id`,
            [used ?? null, quantity ?? null, req.params.itemId, req.params.id]
        );
        if (upd.rowCount === 0) return res.status(404).json({ error: 'Item not found.' });
        const full = await pool.query(`${ITEM_SELECT} WHERE ti.id = $1`, [req.params.itemId]);
        return res.json(full.rows[0]);
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        console.error(err); return res.status(500).json({ error: 'Failed to update item.' });
    }
});

/* DELETE /api/tickets/:id/items/:itemId */
router.delete('/:id/items/:itemId', requireRole('technician', 'admin'), async (req, res) => {
    try {
        await assertTicketAccess(req, req.params.id);
        await pool.query('DELETE FROM ticket_items WHERE id = $1 AND ticket_id = $2', [req.params.itemId, req.params.id]);
        return res.json({ success: true });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        console.error(err); return res.status(500).json({ error: 'Failed to remove item.' });
    }
});

module.exports = router;
