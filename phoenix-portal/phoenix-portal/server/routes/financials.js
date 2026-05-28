const express  = require('express');
const pool     = require('../db/pool');
const { requireRole } = require('../middleware/requireRole');
const { sendMail }    = require('../config/mailer');

const router = express.Router();

/* GET /api/financials */
router.get('/', requireRole('accounting', 'admin'), async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT f.*, u.name AS creator_name
             FROM financial_records f
             LEFT JOIN users u ON f.created_by = u.id
             ORDER BY f.created_at DESC`
        );
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

/* GET /api/financials/summary — totals for dashboard */
router.get('/summary', requireRole('accounting', 'admin'), async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END), 0) AS total_income,
                COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS total_expenses,
                COALESCE(SUM(CASE WHEN type = 'income'  THEN amount
                                  WHEN type = 'expense' THEN -amount END), 0) AS net
             FROM financial_records`
        );
        return res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

/* POST /api/financials */
router.post('/', requireRole('accounting', 'admin'), async (req, res) => {
    const { description, amount, type } = req.body;

    if (!description || amount == null || !type) {
        return res.status(400).json({ error: 'description, amount, and type are required.' });
    }
    if (!['income', 'expense'].includes(type)) {
        return res.status(400).json({ error: 'type must be income or expense.' });
    }
    if (isNaN(amount) || Number(amount) <= 0) {
        return res.status(400).json({ error: 'amount must be a positive number.' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO financial_records (description, amount, type, created_by)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [description, amount, type, req.user.id]
        );
        const record = result.rows[0];

        /* Notify admin */
        const admins = await pool.query("SELECT email FROM users WHERE role = 'admin'");
        for (const admin of admins.rows) {
            await sendMail(
                admin.email,
                `New Financial Record: ${type}`,
                `A new financial record was added.\n\nDescription: ${description}\nAmount: $${amount}\nType: ${type}\nAdded by: ${req.user.name}`
            ).catch(err => console.error('Finance notify failed:', err));
        }

        return res.status(201).json(record);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

/* DELETE /api/financials/:id — admin only */
router.delete('/:id', requireRole('admin'), async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM financial_records WHERE id = $1', [req.params.id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Record not found.' });
        }
        return res.json({ message: 'Record deleted.' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

module.exports = router;
