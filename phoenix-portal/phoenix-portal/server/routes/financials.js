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
/* RFQs (snapshot_entries) can link to a client; ensured here too so the
   per-client query below is safe even if snapshot.js hasn't migrated yet. */
pool.query('ALTER TABLE snapshot_entries ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL').catch(() => {});
/* Manually "pin" a client onto the Financials → Clients list even before they
   have any activity (invoices/work orders/RFQs). Automatic inclusion stays. */
pool.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS financials_pinned BOOLEAN DEFAULT FALSE').catch(() => {});
/* Portal-created records get source='portal' so a QuickBooks re-import can't
   duplicate or wipe them; imported rows keep/get the default 'quickbooks'. */
pool.query("ALTER TABLE client_transactions ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'quickbooks'").catch(() => {});
pool.query('ALTER TABLE client_transactions ADD COLUMN IF NOT EXISTS paid_amount NUMERIC').catch(() => {});
pool.query('ALTER TABLE client_transactions ADD COLUMN IF NOT EXISTS balance_due NUMERIC').catch(() => {});
/* A paid work order auto-generates one payment; the link prevents doubles. */
pool.query('ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS payment_tx_id INTEGER').catch(() => {});
/* Work Order document fields (match the Work Order PDF form): header meta, the
   job-site block, and line items (Item·Description·Qty — no pricing) as JSON.
   Lets a work order render + print as the field-service form. */
pool.query(`ALTER TABLE work_orders
    ADD COLUMN IF NOT EXISTS wo_number       TEXT,
    ADD COLUMN IF NOT EXISTS customer_number TEXT,
    ADD COLUMN IF NOT EXISTS wo_date         DATE,
    ADD COLUMN IF NOT EXISTS scheduled       TEXT,
    ADD COLUMN IF NOT EXISTS tech_on_site    TEXT,
    ADD COLUMN IF NOT EXISTS contact_phone   TEXT,
    ADD COLUMN IF NOT EXISTS job_site        TEXT,
    ADD COLUMN IF NOT EXISTS line_items      JSONB DEFAULT '[]'::jsonb`).catch(() => {});
/* Recurring-billing anchor + last annual-invoice timestamp drive the yearly
   auto-invoice. Backfill existing recurring clients to today so they DON'T get
   a backlog — their first auto-invoice lands a year from now, not immediately. */
const annualReady = (async () => {
    await pool.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_anchor DATE').catch(() => {});
    await pool.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS last_annual_invoice_at TIMESTAMP').catch(() => {});
    await pool.query('UPDATE clients SET billing_anchor = CURRENT_DATE WHERE billing_amount > 0 AND billing_anchor IS NULL').catch(() => {});
})();

/* Generate the annual recurring invoice for any client whose billing anniversary
   has come due (idempotent — at most one per client per year, gated by
   last_annual_invoice_at). ARR = per-period amount normalized to a year. Runs
   once on startup and then daily. Marked source='portal'. */
async function generateAnnualInvoices() {
    try {
        await pool.query(`
            WITH due AS (
                SELECT id,
                       ROUND(billing_amount * 12.0 / CASE COALESCE(billing_frequency, 'monthly')
                           WHEN 'quarterly' THEN 3 WHEN 'yearly' THEN 12 ELSE 1 END, 2) AS arr
                FROM clients
                WHERE billing_amount > 0 AND billing_anchor IS NOT NULL
                  AND CURRENT_DATE >= (COALESCE(last_annual_invoice_at::date, billing_anchor) + INTERVAL '1 year')
            ),
            ins AS (
                INSERT INTO client_transactions (client_id, description, amount, paid_amount, balance_due, type, date, source)
                SELECT id, 'Annual recurring billing — ' || TO_CHAR(CURRENT_DATE, 'YYYY'), arr, 0, arr, 'invoice', CURRENT_DATE, 'portal'
                FROM due
                RETURNING client_id
            )
            UPDATE clients SET last_annual_invoice_at = NOW() WHERE id IN (SELECT client_id FROM ins)
        `);
    } catch (err) { console.error('annual invoice generation:', err.message); }
}
annualReady.then(() => { generateAnnualInvoices(); setInterval(generateAnnualInvoices, 24 * 60 * 60 * 1000); });

/* When a work order is (or becomes) closed & paid, auto-create one matching
   payment — tracked via work_orders.payment_tx_id so it never doubles. */
async function ensureWorkOrderPayment(woId) {
    try {
        const wq = await pool.query('SELECT id, label, client_id, amount, status, payment_tx_id FROM work_orders WHERE id = $1', [woId]);
        const w = wq.rows[0];
        if (!w || w.status !== 'closed_paid' || !w.client_id || w.payment_tx_id || !(Number(w.amount) > 0)) return;
        const tx = await pool.query(
            `INSERT INTO client_transactions (client_id, description, amount, type, date, source)
             VALUES ($1, $2, $3, 'payment', CURRENT_DATE, 'portal') RETURNING id`,
            [w.client_id, `Work order #${w.id}: ${w.label}`, w.amount]
        );
        await pool.query('UPDATE work_orders SET payment_tx_id = $1 WHERE id = $2', [tx.rows[0].id, w.id]);
    } catch (err) { console.error('WO payment auto-gen:', err.message); }
}

const WO_SELECT = `
    SELECT w.id, w.label, w.client_id, w.amount, w.status, w.created_at, w.updated_at, w.paid_at,
           w.wo_number, w.customer_number, w.wo_date, w.scheduled, w.tech_on_site, w.contact_phone, w.job_site, w.line_items,
           c.name AS client_name, c.customer_number AS client_customer_number, c.site_address AS client_site_address,
           u.name AS creator_name
    FROM work_orders w
    LEFT JOIN clients c ON w.client_id = c.id
    LEFT JOIN users   u ON w.created_by = u.id`;

/* Normalize the Work Order document fields; line items = [{item,description,qty}]
   (null line_items means "not provided" — PATCH keeps the existing items). */
function woFields(body) {
    const t = s => { const v = (s == null ? '' : String(s)).trim(); return v === '' ? null : v; };
    const line_items = Array.isArray(body.line_items)
        ? body.line_items.map(li => ({
            item:        String(li.item ?? '').slice(0, 160),
            description: String(li.description ?? '').slice(0, 4000),
            qty:         (li.qty === '' || li.qty == null) ? null : (Number.isFinite(Number(li.qty)) ? Number(li.qty) : null),
        }))
        : null;
    return {
        wo_number:       t(body.wo_number),
        customer_number: t(body.customer_number),
        wo_date:         t(body.wo_date),
        scheduled:       t(body.scheduled),
        tech_on_site:    t(body.tech_on_site),
        contact_phone:   t(body.contact_phone),
        job_site:        t(body.job_site),
        line_items,
    };
}

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
        const [billRes, expRes, fleetRes] = await Promise.all([
            /* Authoritative billing comes from the QuickBooks-imported ledger:
               invoiced = invoice totals, paid = invoice paid + standalone payments,
               balance = open balance (falls back to the invoice total when unknown). */
            pool.query(`
                SELECT
                    COALESCE(SUM(amount) FILTER (WHERE type = 'invoice'), 0) AS invoiced,
                    COALESCE(SUM(COALESCE(paid_amount, 0)) FILTER (WHERE type = 'invoice'), 0)
                      + COALESCE(SUM(amount) FILTER (WHERE type = 'payment'), 0)            AS paid,
                    COALESCE(SUM(COALESCE(balance_due, amount)) FILTER (WHERE type = 'invoice'), 0) AS balance
                FROM client_transactions
            `).catch(() => ({ rows: [{ invoiced: 0, paid: 0, balance: 0 }] })),
            pool.query("SELECT COALESCE(SUM(amount), 0) AS exp FROM financial_records WHERE type = 'expense'"),
            pool.query("SELECT COALESCE(SUM(amount), 0) AS fleet FROM vehicle_invoices")
                .catch(() => ({ rows: [{ fleet: 0 }] })),
        ]);

        const invoiced     = Number(billRes.rows[0].invoiced);
        const paid         = Number(billRes.rows[0].paid);
        const balance      = Number(billRes.rows[0].balance);
        const recordExp    = Number(expRes.rows[0].exp);
        const fleetExp     = Number(fleetRes.rows[0].fleet);
        const expenseTotal = recordExp + fleetExp;   /* fleet counts against revenue */

        return res.json({
            total_invoiced: invoiced,
            total_paid:     paid,
            balance_due:    balance,
            expense_total:  expenseTotal,
            fleet_expenses: fleetExp,
            net:            paid - expenseTotal,
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

/* DELETE /api/financials/client-transactions/:id
   Remove a single billing entry regardless of source or linked client
   (covers unmonitored rows that have no client_id). */
router.delete('/client-transactions/:id', requireRole('accounting', 'admin'), async (req, res) => {
    try {
        const r = await pool.query('DELETE FROM client_transactions WHERE id = $1 RETURNING id', [req.params.id]);
        if (r.rowCount === 0) return res.status(404).json({ error: 'Entry not found.' });
        res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to delete entry.' }); }
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
    const { client_id } = req.body;
    /* Amount is optional now (set when the job is billed); default to 0. */
    const amt = (req.body.amount == null || req.body.amount === '') ? 0 : Number(req.body.amount);
    if (isNaN(amt) || amt < 0) return res.status(400).json({ error: 'Amount must be a non-negative number.' });
    const status = WO_STATUSES.includes(req.body.status) ? req.body.status : 'open';
    const wf = woFields(req.body);
    /* Label (list title) is optional — fall back to the WO # so the list has a name. */
    const label = (req.body.label && req.body.label.trim()) || (wf.wo_number ? `WO ${wf.wo_number}` : 'Work order');
    try {
        const ins = await pool.query(
            `INSERT INTO work_orders
                (label, client_id, amount, status, created_by, paid_at,
                 wo_number, customer_number, wo_date, scheduled, tech_on_site, contact_phone, job_site, line_items)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14::jsonb,'[]'::jsonb)) RETURNING id`,
            [label, client_id || null, amt, status, req.user.id, status === 'closed_paid' ? new Date() : null,
             wf.wo_number, wf.customer_number, wf.wo_date, wf.scheduled, wf.tech_on_site, wf.contact_phone, wf.job_site,
             wf.line_items ? JSON.stringify(wf.line_items) : null]
        );
        await ensureWorkOrderPayment(ins.rows[0].id);
        const full = await pool.query(`${WO_SELECT} WHERE w.id = $1`, [ins.rows[0].id]);
        res.status(201).json(full.rows[0]);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error.' }); }
});

/* PATCH /api/financials/work-orders/:id  { status?, label?, amount?, client_id? } */
router.patch('/work-orders/:id', requireRole('accounting', 'admin'), async (req, res) => {
    const { status, label, amount, client_id } = req.body;
    if (status != null && !WO_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    if (amount != null && amount !== '' && (isNaN(amount) || Number(amount) < 0)) return res.status(400).json({ error: 'Amount must be a non-negative number.' });
    const wf = woFields(req.body);
    try {
        const r = await pool.query(
            `UPDATE work_orders
             SET status    = COALESCE($1, status),
                 label     = COALESCE($2, label),
                 amount    = COALESCE($3::numeric, amount),
                 client_id = CASE WHEN $4::boolean THEN $5::int ELSE client_id END,
                 paid_at   = CASE WHEN $1 = 'closed_paid' AND paid_at IS NULL THEN NOW()
                                  WHEN $1 IN ('open','deadbeat') THEN NULL ELSE paid_at END,
                 wo_number       = COALESCE($7, wo_number),
                 customer_number = COALESCE($8, customer_number),
                 wo_date         = COALESCE($9::date, wo_date),
                 scheduled       = COALESCE($10, scheduled),
                 tech_on_site    = COALESCE($11, tech_on_site),
                 contact_phone   = COALESCE($12, contact_phone),
                 job_site        = COALESCE($13, job_site),
                 line_items      = COALESCE($14::jsonb, line_items),
                 updated_at = NOW()
             WHERE id = $6 RETURNING id`,
            [status || null, label || null, (amount === '' || amount == null) ? null : Number(amount), 'client_id' in req.body, client_id || null, req.params.id,
             wf.wo_number, wf.customer_number, wf.wo_date, wf.scheduled, wf.tech_on_site, wf.contact_phone, wf.job_site,
             wf.line_items ? JSON.stringify(wf.line_items) : null]
        );
        if (r.rowCount === 0) return res.status(404).json({ error: 'Work order not found.' });
        await ensureWorkOrderPayment(req.params.id);
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

/* POST /api/financials/clear-invoices — one-time blank-slate wipe of every invoice
   row (any source) ahead of re-importing from QuickBooks. Payments are preserved.
   GET-style preview when commit !== true; deletes when commit === true. */
router.post('/clear-invoices', requireRole('admin'), async (req, res) => {
    try {
        if (req.body.commit !== true) {
            const r = await pool.query("SELECT COUNT(*)::int AS n FROM client_transactions WHERE type = 'invoice'");
            return res.json({ committed: false, count: r.rows[0].n });
        }
        const r = await pool.query("DELETE FROM client_transactions WHERE type = 'invoice'");
        res.json({ committed: true, deleted: r.rowCount });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to clear invoices.' }); }
});

/* GET /api/financials/mrr — monthly recurring revenue breakdown.
   Every client with a recurring bill, normalized to a monthly figure and ranked
   high → low. The client splits each client's MRR across its service types
   (fire / alarm / access_control) for the source pie. */
router.get('/mrr', requireRole('accounting', 'admin'), async (_req, res) => {
    try {
        const r = await pool.query(`
            SELECT id, name, customer_id, customer_number, services, billing_frequency,
                   billing_amount / CASE COALESCE(billing_frequency, 'monthly')
                       WHEN 'quarterly' THEN 3.0 WHEN 'yearly' THEN 12.0 ELSE 1.0 END AS mrr
            FROM clients
            WHERE billing_amount IS NOT NULL AND billing_amount > 0
        `);
        /* Roll up per customer (rows sharing a customer_number), so a
           multi-location customer reports ONE combined MRR line instead of one
           per panel. Falls back to customer_id for rows with no number yet. */
        const groups = new Map();
        for (const c of r.rows) {
            const key = (c.customer_number && String(c.customer_number).trim()) || c.customer_id || `id:${c.id}`;
            let g = groups.get(key);
            if (!g) { g = { customer_id: key, name: '', services: new Set(), mrr: 0, panels: 0 }; groups.set(key, g); }
            g.mrr    += Number(c.mrr) || 0;
            g.panels += 1;
            (c.services || []).forEach(s => g.services.add(s));
            /* Prefer the billing/umbrella row's name (no service labels); strip a
               trailing " : Billing" so it reads as the plain customer. */
            const clean = String(c.name || '').replace(/\s*:\s*Billing\s*$/i, '').trim();
            if (!g.name || !(c.services && c.services.length)) g.name = clean || g.name;
        }
        const clients = [...groups.values()]
            .map(g => ({ ...g, services: [...g.services] }))
            .sort((a, b) => b.mrr - a.mrr || a.name.localeCompare(b.name));
        const total_mrr = clients.reduce((s, c) => s + c.mrr, 0);
        res.json({ total_mrr, count: clients.length, clients });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to load MRR.' }); }
});

/* ── Customer-centric views ──────────────────────────────────────────────── */

/* GET /api/financials/clients — every client with any financial activity
   (invoices/payments, work orders, RFQs, or recurring billing) plus rolled-up
   balances and counts. Powers the clickable Clients list. */
router.get('/clients', requireRole('accounting', 'admin'), async (_req, res) => {
    try {
        const r = await pool.query(`
            SELECT c.id, c.name, c.customer_id, c.customer_number, c.financials_pinned,
                   COALESCE(ct.invoiced, 0)  AS invoiced,
                   COALESCE(ct.paid, 0)      AS paid,
                   COALESCE(ct.balance, 0)   AS balance,
                   COALESCE(ct.tx_count, 0)  AS tx_count,
                   COALESCE(wo.wo_count, 0)  AS wo_count,
                   COALESCE(wo.wo_open, 0)   AS wo_open,
                   COALESCE(rq.rfq_count, 0) AS rfq_count,
                   COALESCE(c.billing_amount / CASE COALESCE(c.billing_frequency, 'monthly')
                       WHEN 'quarterly' THEN 3.0 WHEN 'yearly' THEN 12.0 ELSE 1.0 END, 0) AS mrr
            FROM clients c
            LEFT JOIN (
                SELECT client_id,
                       SUM(amount) FILTER (WHERE type = 'invoice')                        AS invoiced,
                       SUM(COALESCE(paid_amount, 0)) FILTER (WHERE type = 'invoice')
                         + SUM(amount) FILTER (WHERE type = 'payment')                    AS paid,
                       SUM(COALESCE(balance_due, amount)) FILTER (WHERE type = 'invoice') AS balance,
                       COUNT(*)                                                           AS tx_count
                FROM client_transactions WHERE client_id IS NOT NULL GROUP BY client_id
            ) ct ON ct.client_id = c.id
            LEFT JOIN (
                SELECT client_id, COUNT(*) AS wo_count, COUNT(*) FILTER (WHERE status = 'open') AS wo_open
                FROM work_orders WHERE client_id IS NOT NULL GROUP BY client_id
            ) wo ON wo.client_id = c.id
            LEFT JOIN (
                SELECT client_id, COUNT(*) AS rfq_count
                FROM snapshot_entries WHERE client_id IS NOT NULL GROUP BY client_id
            ) rq ON rq.client_id = c.id
            WHERE ct.client_id IS NOT NULL OR wo.client_id IS NOT NULL OR rq.client_id IS NOT NULL
               OR (c.billing_amount IS NOT NULL AND c.billing_amount > 0)
               OR c.financials_pinned = TRUE
            ORDER BY balance DESC NULLS LAST, c.name
        `);
        res.json(r.rows);
    } catch (err) { console.error('financials clients:', err); res.status(500).json({ error: 'Failed to load clients.' }); }
});

/* GET /api/financials/clients/:id — one client's full financial detail:
   summary totals plus their invoices, payments, work orders and RFQs. */
router.get('/clients/:id', requireRole('accounting', 'admin'), async (req, res) => {
    const id = req.params.id;
    try {
        const cRes = await pool.query(
            `SELECT id, name, customer_id, customer_number, services, billing_amount, billing_frequency, financials_pinned,
                    COALESCE(billing_amount / CASE COALESCE(billing_frequency, 'monthly')
                        WHEN 'quarterly' THEN 3.0 WHEN 'yearly' THEN 12.0 ELSE 1.0 END, 0) AS mrr
             FROM clients WHERE id = $1`, [id]);
        if (cRes.rowCount === 0) return res.status(404).json({ error: 'Client not found.' });

        const [txRes, woRes, rqRes] = await Promise.all([
            pool.query(`SELECT id, description, amount, paid_amount, balance_due, type, date, created_at
                        FROM client_transactions WHERE client_id = $1
                        ORDER BY date DESC NULLS LAST, created_at DESC`, [id]),
            pool.query(`${WO_SELECT} WHERE w.client_id = $1 ORDER BY w.created_at DESC`, [id]),
            pool.query(`SELECT * FROM snapshot_entries WHERE client_id = $1 ORDER BY created_at DESC`, [id]),
        ]);

        const invoices = txRes.rows.filter(t => t.type === 'invoice');
        const payments = txRes.rows.filter(t => t.type === 'payment');
        const num = n => Number(n) || 0;
        const invoiced = invoices.reduce((s, t) => s + num(t.amount), 0);
        const paid     = invoices.reduce((s, t) => s + num(t.paid_amount), 0) + payments.reduce((s, t) => s + num(t.amount), 0);
        const balance  = invoices.reduce((s, t) => s + (t.balance_due != null ? num(t.balance_due) : num(t.amount)), 0);

        res.json({
            client:  cRes.rows[0],
            summary: {
                invoiced, paid, balance,
                invoice_count: invoices.length, payment_count: payments.length,
                work_order_count: woRes.rows.length, rfq_count: rqRes.rows.length,
            },
            invoices, payments,
            work_orders: woRes.rows,
            rfqs: rqRes.rows,
        });
    } catch (err) { console.error('financials client detail:', err); res.status(500).json({ error: 'Failed to load client.' }); }
});

/* POST /api/financials/clients/:id/pin — manually add a client to the Financials
   list. DELETE removes the pin (only affects clients with no other activity). */
router.post('/clients/:id/pin', requireRole('accounting', 'admin'), async (req, res) => {
    try {
        const r = await pool.query('UPDATE clients SET financials_pinned = TRUE WHERE id = $1 RETURNING id', [req.params.id]);
        if (r.rowCount === 0) return res.status(404).json({ error: 'Client not found.' });
        res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to add client.' }); }
});
router.delete('/clients/:id/pin', requireRole('accounting', 'admin'), async (req, res) => {
    try {
        const r = await pool.query('UPDATE clients SET financials_pinned = FALSE WHERE id = $1 RETURNING id', [req.params.id]);
        if (r.rowCount === 0) return res.status(404).json({ error: 'Client not found.' });
        res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to remove client.' }); }
});

/* POST /api/financials/payments { client_id, amount, description, date? }
   Record a payment directly against a client. Marked source='portal'. */
router.post('/payments', requireRole('accounting', 'admin'), async (req, res) => {
    const { client_id, amount, description, date } = req.body;
    if (!client_id) return res.status(400).json({ error: 'A client is required.' });
    if (amount == null || isNaN(amount) || Number(amount) <= 0) return res.status(400).json({ error: 'Amount must be a positive number.' });
    try {
        const r = await pool.query(
            `INSERT INTO client_transactions (client_id, description, amount, type, date, source, created_by)
             VALUES ($1, $2, $3, 'payment', COALESCE($4::date, CURRENT_DATE), 'portal', $5)
             RETURNING id, description, amount, type, date, created_at`,
            [client_id, (description || 'Payment').trim(), amount, date || null, req.user.id]
        );
        res.status(201).json(r.rows[0]);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to add payment.' }); }
});

module.exports = router;
