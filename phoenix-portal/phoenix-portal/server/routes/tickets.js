const express  = require('express');
const pool     = require('../db/pool');
const { requireRole } = require('../middleware/requireRole');
const { sendMail }    = require('../config/mailer');

const router = express.Router();

/* GET /api/tickets — technician sees own tickets; admin sees all */
router.get('/', requireRole('technician', 'admin'), async (req, res) => {
    try {
        let result;
        if (req.user.role === 'admin') {
            result = await pool.query(
                `SELECT t.*, u.name AS creator_name, a.name AS assignee_name
                 FROM service_tickets t
                 LEFT JOIN users u ON t.created_by = u.id
                 LEFT JOIN users a ON t.assigned_to = a.id
                 ORDER BY t.created_at DESC`
            );
        } else {
            result = await pool.query(
                `SELECT t.*, u.name AS creator_name, a.name AS assignee_name
                 FROM service_tickets t
                 LEFT JOIN users u ON t.created_by = u.id
                 LEFT JOIN users a ON t.assigned_to = a.id
                 WHERE t.created_by = $1 OR t.assigned_to = $1
                 ORDER BY t.created_at DESC`,
                [req.user.id]
            );
        }
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

/* POST /api/tickets — create a new ticket */
router.post('/', requireRole('technician', 'admin'), async (req, res) => {
    const { title, description, assigned_to } = req.body;

    if (!title) {
        return res.status(400).json({ error: 'Title is required.' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO service_tickets (title, description, created_by, assigned_to)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [title, description || null, req.user.id, assigned_to || null]
        );
        const ticket = result.rows[0];

        /* Notify admin */
        const admins = await pool.query("SELECT email FROM users WHERE role = 'admin'");
        for (const admin of admins.rows) {
            await sendMail(
                admin.email,
                `New Ticket: ${title}`,
                `A new service ticket was created.\n\nTitle: ${title}\nDescription: ${description || 'N/A'}\nCreated by: ${req.user.name}`
            ).catch(err => console.error('Ticket notify failed:', err));
        }

        return res.status(201).json(ticket);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

/* PATCH /api/tickets/:id — update status and/or assignee */
router.patch('/:id', requireRole('technician', 'admin'), async (req, res) => {
    const { status, assigned_to } = req.body;
    const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];

    if (status && !validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status.' });
    }

    try {
        await pool.query(
            `UPDATE service_tickets
             SET status = COALESCE($1, status),
                 assigned_to = CASE WHEN $2::text = '__unassign__' THEN NULL
                                    WHEN $2 IS NOT NULL THEN $2::int
                                    ELSE assigned_to END,
                 updated_at = NOW()
             WHERE id = $3`,
            [status || null, assigned_to !== undefined ? String(assigned_to) : null, req.params.id]
        );

        const full = await pool.query(
            `SELECT t.*, u.name AS creator_name, a.name AS assignee_name
             FROM service_tickets t
             LEFT JOIN users u ON t.created_by = u.id
             LEFT JOIN users a ON t.assigned_to = a.id
             WHERE t.id = $1`,
            [req.params.id]
        );

        if (full.rowCount === 0) {
            return res.status(404).json({ error: 'Ticket not found.' });
        }
        return res.json(full.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

/* DELETE /api/tickets/:id — admin only */
router.delete('/:id', requireRole('admin'), async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM service_tickets WHERE id = $1', [req.params.id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Ticket not found.' });
        }
        return res.json({ message: 'Ticket deleted.' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

module.exports = router;
