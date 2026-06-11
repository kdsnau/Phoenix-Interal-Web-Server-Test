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
            `WITH fr AS (
                SELECT
                    COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END), 0) AS income,
                    COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expenses
                FROM financial_records
             ), pay AS (
                SELECT COALESCE(SUM(amount), 0) AS income
                FROM client_transactions WHERE type = 'payment'
             )
             SELECT
                (fr.income + pay.income)             AS total_income,
                fr.expenses                          AS total_expenses,
                (fr.income + pay.income - fr.expenses) AS net
             FROM fr, pay`
        );
        return res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

/* GET /api/financials/monthly
   Returns last 12 months of income/expenses from financial_records
   plus fleet invoice totals per month, and current MRR from client billing.
   Response: { months: [{month, income, expenses, fleet}], mrr: number } */
router.get('/monthly', requireRole('accounting', 'admin'), async (req, res) => {
    try {
        /* Build the 12-month label array (oldest → newest) */
        const months = [];
        for (let i = 11; i >= 0; i--) {
            const d = new Date();
            d.setDate(1);
            d.setMonth(d.getMonth() - i);
            months.push(d.toISOString().slice(0, 7));   /* 'YYYY-MM' */
        }

        const [finRows, payRows, fleetRows, mrrRow] = await Promise.all([
            pool.query(`
                SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
                       COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END), 0) AS income,
                       COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expenses
                FROM financial_records
                WHERE created_at >= NOW() - INTERVAL '12 months'
                GROUP BY 1
                ORDER BY 1
            `),
            pool.query(`
                SELECT TO_CHAR(DATE_TRUNC('month', date), 'YYYY-MM') AS month,
                       COALESCE(SUM(amount), 0) AS income
                FROM client_transactions
                WHERE type = 'payment' AND date >= (NOW() - INTERVAL '12 months')::date
                GROUP BY 1
                ORDER BY 1
            `).catch(() => ({ rows: [] })),   /* graceful if table missing */
            pool.query(`
                SELECT TO_CHAR(DATE_TRUNC('month', invoice_date::date), 'YYYY-MM') AS month,
                       COALESCE(SUM(amount), 0) AS fleet
                FROM vehicle_invoices
                WHERE invoice_date::date >= NOW() - INTERVAL '12 months'
                GROUP BY 1
                ORDER BY 1
            `).catch(() => ({ rows: [] })),   /* graceful if table missing */
            pool.query(`
                SELECT COALESCE(SUM(
                    billing_amount / CASE COALESCE(billing_frequency, 'monthly')
                        WHEN 'quarterly' THEN 3.0 WHEN 'yearly' THEN 12.0 ELSE 1.0 END
                ), 0) AS mrr
                FROM clients
                WHERE billing_amount IS NOT NULL AND billing_amount > 0
            `).catch(() => ({ rows: [{ mrr: 0 }] })),
        ]);

        const finMap   = Object.fromEntries(finRows.rows.map(r   => [r.month, r]));
        const payMap   = Object.fromEntries(payRows.rows.map(r   => [r.month, r]));
        const fleetMap = Object.fromEntries(fleetRows.rows.map(r => [r.month, r]));

        const data = months.map(m => ({
            month:    m,
            income:   Number(finMap[m]?.income || 0) + Number(payMap[m]?.income || 0),
            expenses: Number(finMap[m]?.expenses || 0),
            fleet:    Number(fleetMap[m]?.fleet  || 0),
        }));

        return res.json({ months: data, mrr: Number(mrrRow.rows[0]?.mrr || 0) });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

/* GET /api/financials/fleet
   All vehicle invoices joined with vehicle name + unit, newest first.
   Used by the Fleet Expenses section on the Financials page. */
router.get('/fleet', requireRole('accounting', 'admin'), async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT vi.id, vi.description, vi.amount, vi.invoice_date, vi.created_at,
                   v.name AS vehicle_name, v.vehicle_id AS unit
            FROM vehicle_invoices vi
            JOIN vehicles v ON vi.vehicle_id = v.id
            ORDER BY vi.invoice_date DESC, vi.created_at DESC
            LIMIT 100
        `).catch(() => ({ rows: [] }));   /* graceful if table/join missing */
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

/* GET /api/financials/client-transactions
   All client_transactions joined with client name, newest first.
   Used by the Client Billing tab on the Financials page. */
router.get('/client-transactions', requireRole('accounting', 'admin'), async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT ct.id, ct.description, ct.amount, ct.type, ct.date, ct.created_at,
                   COALESCE(c.name, ct.customer_name) AS client_name,
                   c.customer_id,
                   (ct.client_id IS NULL) AS unmonitored
            FROM client_transactions ct
            LEFT JOIN clients c ON ct.client_id = c.id
            ORDER BY ct.date DESC, ct.created_at DESC
            LIMIT 2000
        `).catch(() => ({ rows: [] }));
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

/* GET /api/financials/inventory
   Returns stock-on-hand totals at cost and at sale price,
   broken down by category — only active items with qty > 0. */
router.get('/inventory', requireRole('accounting', 'admin'), async (req, res) => {
    try {
        const [summaryRes, catRes] = await Promise.all([
            pool.query(`
                SELECT
                    COUNT(*)::int                                              AS total_items,
                    COALESCE(SUM(quantity), 0)::int                           AS total_units,
                    COALESCE(SUM(quantity * COALESCE(cost,  0)), 0)::numeric  AS cost_value,
                    COALESCE(SUM(quantity * COALESCE(price, 0)), 0)::numeric  AS sale_value
                FROM inventory_items
                WHERE active = TRUE AND quantity > 0
            `).catch(() => ({ rows: [{ total_items: 0, total_units: 0, cost_value: 0, sale_value: 0 }] })),
            pool.query(`
                SELECT
                    category,
                    COUNT(*)::int                                              AS item_count,
                    COALESCE(SUM(quantity), 0)::int                           AS total_units,
                    COALESCE(SUM(quantity * COALESCE(cost,  0)), 0)::numeric  AS cost_value,
                    COALESCE(SUM(quantity * COALESCE(price, 0)), 0)::numeric  AS sale_value
                FROM inventory_items
                WHERE active = TRUE AND quantity > 0
                GROUP BY category
                ORDER BY cost_value DESC
            `).catch(() => ({ rows: [] })),
        ]);
        return res.json({ summary: summaryRes.rows[0], by_category: catRes.rows });
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

        /* Notify admin + accounting */
        const admins = await pool.query(
            "SELECT email FROM users WHERE role IN ('admin', 'accounting')"
        );
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
