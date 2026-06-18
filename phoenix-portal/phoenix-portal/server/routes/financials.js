const express  = require('express');
const pool     = require('../db/pool');
const { requireRole } = require('../middleware/requireRole');
const { sendTemplated } = require('../config/mailer');

const router = express.Router();

/* ── Work orders ──────────────────────────────────────────────────────────
   A work order is a revenue job with a status:
     open        → INVOICE        (billed, not yet paid)
     closed_paid → PAYMENT        (collected revenue = gross)
     deadbeat    → CLOSED INVOICE (closed & unpaid — excluded from totals,
                                   surfaced in a weekly notification)
   Totals: Gross = payments; Invoice+Gross = open invoices + payments;
   Expense = financial_records(expense) + fleet. */
const WO_STATUSES = ['open', 'closed_paid', 'deadbeat'];
pool.query(`
    CREATE TABLE IF NOT EXISTS work_orders (
        id         SERIAL PRIMARY KEY,
        label      TEXT NOT NULL,
        client_id  INTEGER REFERENCES clients(id) ON DELETE SET NULL,
        amount     NUMERIC NOT NULL,
        status     TEXT NOT NULL DEFAULT 'open',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        paid_at    TIMESTAMP
    )
`).catch(() => {});

const WO_SELECT = `
    SELECT w.id, w.label, w.client_id, w.amount, w.status, w.created_at, w.updated_at, w.paid_at,
           c.name AS client_name, u.name AS creator_name
    FROM work_orders w
    LEFT JOIN clients c ON w.client_id = c.id
    LEFT JOIN users   u ON w.created_by = u.id`;

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

/* GET /api/financials/summary — work-order + expense totals */
router.get('/summary', requireRole('accounting', 'admin'), async (req, res) => {
    try {
        const [woRes, expRes, fleetRes] = await Promise.all([
            pool.query(`
                SELECT
                    COALESCE(SUM(amount) FILTER (WHERE status = 'closed_paid'), 0) AS gross,
                    COALESCE(SUM(amount) FILTER (WHERE status = 'open'),        0) AS open_invoices,
                    COALESCE(SUM(amount) FILTER (WHERE status = 'deadbeat'),    0) AS unpaid_closed
                FROM work_orders
            `).catch(() => ({ rows: [{ gross: 0, open_invoices: 0, unpaid_closed: 0 }] })),
            pool.query("SELECT COALESCE(SUM(amount), 0) AS exp FROM financial_records WHERE type = 'expense'"),
            pool.query("SELECT COALESCE(SUM(amount), 0) AS fleet FROM vehicle_invoices")
                .catch(() => ({ rows: [{ fleet: 0 }] })),
        ]);

        const gross        = Number(woRes.rows[0].gross);
        const openInv      = Number(woRes.rows[0].open_invoices);
        const unpaidClosed = Number(woRes.rows[0].unpaid_closed);
        const recordExp    = Number(expRes.rows[0].exp);
        const fleetExp     = Number(fleetRes.rows[0].fleet);
        const expenseTotal = recordExp + fleetExp;   /* fleet counts against revenue */

        return res.json({
            gross_total:         gross,                /* payments */
            invoice_gross_total: openInv + gross,      /* open invoices + payments */
            open_invoice_total:  openInv,
            unpaid_closed_total: unpaidClosed,         /* deadbeat — informational only */
            expense_total:       expenseTotal,
            fleet_expenses:      fleetExp,
            net:                 gross - expenseTotal,
        });
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
            SELECT ct.id, ct.description, ct.amount, ct.balance_due, ct.paid_amount, ct.type, ct.date, ct.created_at,
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
            await sendTemplated(
                admin.email,
                `New Financial Record: ${type}`,
                'New Financial Record',
                {
                    intro: 'A new financial record was added.',
                    fields: [
                        { label: 'Description', value: description, hi: true },
                        { label: 'Amount',      value: `${type === 'income' ? '+' : '-'}$${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, hi: true },
                        { label: 'Type',        value: type, badge: type === 'income' ? 'badge-green' : 'badge-orange' },
                        { label: 'Added By',    value: req.user.name },
                    ],
                }
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

/* ── Work orders ─────────────────────────────────────────────────────────── */

/* GET /api/financials/work-orders */
router.get('/work-orders', requireRole('accounting', 'admin'), async (_req, res) => {
    try {
        const r = await pool.query(`${WO_SELECT} ORDER BY w.created_at DESC`);
        res.json(r.rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error.' }); }
});

/* POST /api/financials/work-orders  { label, client_id?, amount, status? } */
router.post('/work-orders', requireRole('accounting', 'admin'), async (req, res) => {
    const { label, client_id, amount } = req.body;
    if (!label || !label.trim()) return res.status(400).json({ error: 'Label is required.' });
    if (amount == null || isNaN(amount) || Number(amount) <= 0) return res.status(400).json({ error: 'Amount must be a positive number.' });
    const status = WO_STATUSES.includes(req.body.status) ? req.body.status : 'open';
    try {
        const ins = await pool.query(
            `INSERT INTO work_orders (label, client_id, amount, status, created_by, paid_at)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [label.trim(), client_id || null, amount, status, req.user.id, status === 'closed_paid' ? new Date() : null]
        );
        const full = await pool.query(`${WO_SELECT} WHERE w.id = $1`, [ins.rows[0].id]);
        res.status(201).json(full.rows[0]);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error.' }); }
});

/* PATCH /api/financials/work-orders/:id  { status?, label?, amount?, client_id? } */
router.patch('/work-orders/:id', requireRole('accounting', 'admin'), async (req, res) => {
    const { status, label, amount, client_id } = req.body;
    if (status != null && !WO_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    if (amount != null && (isNaN(amount) || Number(amount) <= 0)) return res.status(400).json({ error: 'Amount must be a positive number.' });
    try {
        const r = await pool.query(
            `UPDATE work_orders
             SET status    = COALESCE($1, status),
                 label     = COALESCE($2, label),
                 amount    = COALESCE($3::numeric, amount),
                 client_id = CASE WHEN $4::boolean THEN $5::int ELSE client_id END,
                 paid_at   = CASE WHEN $1 = 'closed_paid' AND paid_at IS NULL THEN NOW()
                                  WHEN $1 IN ('open','deadbeat') THEN NULL ELSE paid_at END,
                 updated_at = NOW()
             WHERE id = $6 RETURNING id`,
            [status || null, label || null, amount ?? null, 'client_id' in req.body, client_id || null, req.params.id]
        );
        if (r.rowCount === 0) return res.status(404).json({ error: 'Work order not found.' });
        const full = await pool.query(`${WO_SELECT} WHERE w.id = $1`, [req.params.id]);
        res.json(full.rows[0]);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error.' }); }
});

/* DELETE /api/financials/work-orders/:id — admin only */
router.delete('/work-orders/:id', requireRole('admin'), async (req, res) => {
    try {
        const r = await pool.query('DELETE FROM work_orders WHERE id = $1', [req.params.id]);
        if (r.rowCount === 0) return res.status(404).json({ error: 'Work order not found.' });
        res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error.' }); }
});

/* POST /api/financials/clear-unmonitored — delete ALL unmonitored (no client) entries */
router.post('/clear-unmonitored', requireRole('admin'), async (_req, res) => {
    try {
        const r = await pool.query('DELETE FROM client_transactions WHERE client_id IS NULL');
        res.json({ deleted: r.rowCount });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to clear unmonitored entries.' }); }
});

module.exports = router;
