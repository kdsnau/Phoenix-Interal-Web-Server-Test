const express = require('express');
const pool    = require('../db/pool');
const { authenticate } = require('../middleware/requireRole');
const { sendServiceReminder, sendTagsReminder } = require('../config/mailer');

const router = express.Router();
router.use(authenticate);

/* Add resolution columns to vehicle_notes if not already present */
pool.query(`ALTER TABLE vehicle_notes ADD COLUMN IF NOT EXISTS resolved    BOOLEAN   NOT NULL DEFAULT FALSE`).catch(() => {});
pool.query(`ALTER TABLE vehicle_notes ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP`).catch(() => {});

router.get('/', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT v.*,
                    sn.enabled AS service_notify_enabled,
                    sn.last_sent_at,
                    sn.next_due_at,
                    (SELECT COUNT(*) FROM vehicle_notes
                     WHERE vehicle_id = v.id AND resolved = FALSE) AS open_issues
             FROM vehicles v
             LEFT JOIN vehicle_service_notifications sn ON sn.vehicle_id = v.id
             ORDER BY v.id ASC`
        );
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const [vehicle, notes, invoices] = await Promise.all([
            pool.query(
                `SELECT v.*,
                        sn.enabled AS service_notify_enabled,
                        sn.last_sent_at,
                        sn.next_due_at,
                        sn.id AS sn_id
                 FROM vehicles v
                 LEFT JOIN vehicle_service_notifications sn ON sn.vehicle_id = v.id
                 WHERE v.id = $1`,
                [req.params.id]
            ),
            pool.query(
                'SELECT * FROM vehicle_notes WHERE vehicle_id = $1 ORDER BY created_at DESC',
                [req.params.id]
            ),
            pool.query(
                'SELECT * FROM vehicle_invoices WHERE vehicle_id = $1 ORDER BY invoice_date DESC',
                [req.params.id]
            ),
        ]);
        if (vehicle.rowCount === 0) return res.status(404).json({ error: 'Vehicle not found.' });
        return res.json({ ...vehicle.rows[0], notes: notes.rows, invoices: invoices.rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

router.patch('/:id', async (req, res) => {
    const { mileage, registration, tags_renewal } = req.body;
    try {
        const result = await pool.query(
            `UPDATE vehicles
             SET mileage      = COALESCE($1, mileage),
                 registration  = COALESCE($2, registration),
                 tags_renewal  = COALESCE($3::date, tags_renewal)
             WHERE id = $4
             RETURNING *`,
            [mileage ?? null, registration ?? null, tags_renewal ?? null, req.params.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Vehicle not found.' });
        return res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

router.post('/:id/notes', async (req, res) => {
    const { category, content } = req.body;
    if (!category || !content) return res.status(400).json({ error: 'category and content are required.' });
    if (!['service', 'repair', 'misc'].includes(category)) return res.status(400).json({ error: 'Invalid category.' });
    try {
        const result = await pool.query(
            'INSERT INTO vehicle_notes (vehicle_id, category, content) VALUES ($1, $2, $3) RETURNING *',
            [req.params.id, category, content]
        );
        return res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

router.delete('/:id/notes/:noteId', async (req, res) => {
    try {
        await pool.query('DELETE FROM vehicle_notes WHERE id = $1 AND vehicle_id = $2', [req.params.noteId, req.params.id]);
        return res.json({ message: 'Note deleted.' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

router.patch('/:id/notes/:noteId', async (req, res) => {
    const { resolved } = req.body;
    try {
        const result = await pool.query(
            `UPDATE vehicle_notes
             SET resolved    = $1,
                 resolved_at = CASE WHEN $1 THEN NOW() ELSE NULL END
             WHERE id = $2 AND vehicle_id = $3
             RETURNING *`,
            [!!resolved, req.params.noteId, req.params.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Note not found.' });
        return res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

router.post('/:id/invoices', async (req, res) => {
    const { description, amount, invoice_date } = req.body;
    if (!description || amount == null || !invoice_date) return res.status(400).json({ error: 'description, amount, and invoice_date are required.' });
    try {
        const result = await pool.query(
            'INSERT INTO vehicle_invoices (vehicle_id, description, amount, invoice_date) VALUES ($1, $2, $3, $4) RETURNING *',
            [req.params.id, description, amount, invoice_date]
        );
        return res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

router.delete('/:id/invoices/:invoiceId', async (req, res) => {
    try {
        await pool.query('DELETE FROM vehicle_invoices WHERE id = $1 AND vehicle_id = $2', [req.params.invoiceId, req.params.id]);
        return res.json({ message: 'Invoice deleted.' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

router.post('/:id/send-service-email', async (req, res) => {
    try {
        const vehicle = await pool.query(
            `SELECT v.*, sn.id AS sn_id FROM vehicles v
             LEFT JOIN vehicle_service_notifications sn ON sn.vehicle_id = v.id
             WHERE v.id = $1`,
            [req.params.id]
        );
        if (vehicle.rowCount === 0) return res.status(404).json({ error: 'Vehicle not found.' });
        const v = vehicle.rows[0];
        const admins = await pool.query("SELECT email FROM users WHERE role = ANY(ARRAY['admin','accounting']::user_role[])");
const recipients = new Set(admins.rows.map(a => a.email));
recipients.add(req.user.email);
console.log('Recipients:', [...recipients]);
	for (const email of recipients) {
    try {
        await sendServiceReminder(email, v);
    } catch (e) {
        console.error('Failed to send to', email, e.message);
    }
}
        await pool.query(
            `UPDATE vehicle_service_notifications
             SET last_sent_at = NOW(), next_due_at = NOW() + INTERVAL '3 months'
             WHERE vehicle_id = $1`,
            [req.params.id]
        );
        return res.json({ message: 'Service reminder sent.' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

router.post('/:id/send-tags-email', async (req, res) => {
    try {
        const vehicle = await pool.query('SELECT * FROM vehicles WHERE id = $1', [req.params.id]);
        if (vehicle.rowCount === 0) return res.status(404).json({ error: 'Vehicle not found.' });
        const v = vehicle.rows[0];
        const admins = await pool.query("SELECT email FROM users WHERE role = ANY(ARRAY['admin','accounting']::user_role[])");
const recipients = new Set(admins.rows.map(a => a.email));
recipients.add(req.user.email);
for (const email of recipients) {
    await sendTagsReminder(email, v);
}
        return res.json({ message: 'Tags renewal reminder sent.' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

module.exports = router;