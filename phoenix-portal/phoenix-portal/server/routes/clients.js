const express = require('express');
const multer  = require('multer');
const XLSX    = require('xlsx');
const pool    = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/requireRole');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/* ── Schema migrations ────────────────────────────────────────────────── */
pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS permit_number   TEXT`).catch(() => {});
pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS permit_expires  DATE`).catch(() => {});
/* Site & contact */
pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS site_address    TEXT`).catch(() => {});
pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_name    TEXT`).catch(() => {});
pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_phone   TEXT`).catch(() => {});
pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_email   TEXT`).catch(() => {});
/* Equipment */
pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS panel_brand     TEXT`).catch(() => {});
pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS panel_model     TEXT`).catch(() => {});
pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS camera_count    INTEGER`).catch(() => {});
pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS zone_count      INTEGER`).catch(() => {});
/* Contract */
pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS contract_type   TEXT`).catch(() => {});
pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS contract_start  DATE`).catch(() => {});
pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS contract_end    DATE`).catch(() => {});
pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS last_inspection DATE`).catch(() => {});
pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS next_inspection DATE`).catch(() => {});
/* Recurring billing frequency: monthly | quarterly | yearly */
pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_frequency TEXT DEFAULT 'monthly'`).catch(() => {});
/* Scheduled maintenance — auto-generates a calendar ticket when due */
pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS maintenance_enabled   BOOLEAN DEFAULT FALSE`).catch(() => {});
pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS maintenance_frequency TEXT`).catch(() => {});
pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS maintenance_next      DATE`).catch(() => {});
pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS maintenance_last      DATE`).catch(() => {});

/* Customers seen in QuickBooks exports that aren't in our client list */
pool.query(`
    CREATE TABLE IF NOT EXISTS unmonitored_clients (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL,
        first_seen TIMESTAMP NOT NULL DEFAULT NOW(),
        last_seen  TIMESTAMP NOT NULL DEFAULT NOW()
    )
`).catch(() => {});
pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_unmon_name ON unmonitored_clients (lower(name))`).catch(() => {});

/* QuickBooks "Customer" cells look like "** REP ** Acme:Job:Service".
   The real top-level customer is the rep-prefix-stripped text before the first colon. */
function topLevelCustomer(raw) {
    let s = String(raw || '').trim();
    if (!s) return null;
    s = s.replace(/^\*\*[^*]*\*\*\s*/, '');   // drop "** REP **" prefix
    s = s.split(':')[0].trim();               // top-level customer only
    return s || null;
}

function isJunkCustomer(name) {
    const n = name.toLowerCase();
    if (n === 'customer') return true;                              // header row
    if (n.startsWith('total')) return true;                        // subtotal rows
    if (/^[a-z]{3,9} - [a-z]{3,9} \d{2,4}$/.test(n)) return true;   // "Jan - Dec 26"
    return false;
}

/* POST /api/clients — admin only */
router.post('/', requireRole('admin'), async (req, res) => {
    const { name, customer_id, vendor, services } = req.body;
    if (!name || !customer_id)
        return res.status(400).json({ error: 'name and customer_id are required.' });
    try {
        const result = await pool.query(
            `INSERT INTO clients (name, customer_id, vendor, services)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [name.trim(), customer_id.trim(), vendor || 'generic', services || []]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505')
            return res.status(409).json({ error: 'A client with that Customer ID already exists.' });
        console.error(err);
        res.status(500).json({ error: 'Failed to create client.' });
    }
});

/* GET /api/clients?service=&vendor=&search= */
router.get('/', authenticate, async (req, res) => {
    const { service, vendor, search } = req.query;
    const conditions = [];
    const params     = [];

    if (service) { params.push(service);        conditions.push(`$${params.length} = ANY(services)`); }
    if (vendor)  { params.push(vendor);          conditions.push(`vendor = $${params.length}`); }
    if (search)  { params.push(`%${search}%`);  conditions.push(`(name ILIKE $${params.length} OR customer_id ILIKE $${params.length})`); }

    const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    try {
        const result = await pool.query(`SELECT * FROM clients${where} ORDER BY name`, params);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch clients.' });
    }
});

/* GET /api/clients/permits — all clients with permit info, sorted by expiry */
router.get('/permits', requireRole('admin', 'accounting'), async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, name, customer_id, permit_number, permit_expires, services,
                   CASE WHEN permit_expires IS NOT NULL
                        THEN (permit_expires::date - CURRENT_DATE)::int
                        ELSE NULL END AS days_until
            FROM clients
            ORDER BY
                CASE WHEN permit_expires IS NULL THEN 1 ELSE 0 END,
                permit_expires ASC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch permits.' });
    }
});

/* ═══ QuickBooks → Unmonitored Clients ═══════════════════════════════════ */

/* GET /api/clients/unmonitored — QB customers not in our client list */
router.get('/unmonitored', authenticate, async (req, res) => {
    try {
        const r = await pool.query('SELECT id, name, first_seen, last_seen FROM unmonitored_clients ORDER BY name');
        return res.json(r.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to load unmonitored clients.' });
    }
});

/* POST /api/clients/import-quickbooks — upload QB CSV(s); accumulate unmonitored */
router.post('/import-quickbooks', requireRole('admin'), upload.array('files', 12), async (req, res) => {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded.' });
    try {
        const customers = new Set();
        let rows = 0;
        for (const file of req.files) {
            const wb = XLSX.read(file.buffer, { type: 'buffer' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            for (const row of XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })) {
                rows++;
                const name = topLevelCustomer(row[0]);
                if (name && !isJunkCustomer(name)) customers.add(name);
            }
        }

        const existing = await pool.query('SELECT name FROM clients');
        const have = new Set(existing.rows.map(r => (r.name || '').trim().toLowerCase()));

        const before = (await pool.query('SELECT COUNT(*)::int AS n FROM unmonitored_clients')).rows[0].n;
        for (const name of customers) {
            if (have.has(name.toLowerCase())) continue;
            await pool.query(
                `INSERT INTO unmonitored_clients (name) VALUES ($1)
                 ON CONFLICT (lower(name)) DO UPDATE SET last_seen = NOW()`,
                [name]
            );
        }
        /* Self-clean: drop any that are now real clients */
        await pool.query(
            `DELETE FROM unmonitored_clients
             WHERE lower(trim(name)) IN (SELECT lower(trim(name)) FROM clients)`
        );
        const after = (await pool.query('SELECT COUNT(*)::int AS n FROM unmonitored_clients')).rows[0].n;

        return res.json({
            files: req.files.length,
            rows,
            qb_customers: customers.size,
            added: Math.max(0, after - before),
            total: after,
        });
    } catch (err) {
        console.error('QuickBooks import error:', err);
        return res.status(500).json({ error: 'Import failed — make sure these are QuickBooks CSV exports.' });
    }
});

/* DELETE /api/clients/unmonitored/:id — dismiss one */
router.delete('/unmonitored/:id', requireRole('admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM unmonitored_clients WHERE id = $1', [req.params.id]);
        return res.json({ success: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to dismiss.' });
    }
});

/* GET /api/clients/:id */
router.get('/:id', authenticate, async (req, res) => {
    try {
        const client = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
        if (client.rowCount === 0) return res.status(404).json({ error: 'Client not found.' });

        const tickets = await pool.query(
            `SELECT st.*, u.name AS assigned_name
             FROM service_tickets st
             LEFT JOIN users u ON st.assigned_to = u.id
             WHERE st.client_id = $1
             ORDER BY st.created_at DESC`,
            [req.params.id]
        );

        const monitoring = await pool.query(
            'SELECT * FROM client_monitoring WHERE client_id = $1',
            [req.params.id]
        );

        res.json({ ...client.rows[0], tickets: tickets.rows, monitoring: monitoring.rows[0] || null });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch client.' });
    }
});

/* PATCH /api/clients/billing/bulk — admin/accounting */
router.patch('/billing/bulk', requireRole('admin', 'accounting'), async (req, res) => {
    const { updates } = req.body;
    if (!Array.isArray(updates))
        return res.status(400).json({ error: 'updates must be an array.' });
    try {
        for (const { id, billing_amount } of updates) {
            const val = billing_amount !== '' && billing_amount != null ? Number(billing_amount) : null;
            await pool.query('UPDATE clients SET billing_amount = $1 WHERE id = $2', [val, id]);
        }
        res.json({ updated: updates.length });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update billing.' });
    }
});

/* PATCH /api/clients/:id */
router.patch('/:id', authenticate, async (req, res) => {
    const FIELDS = [
        'notes', 'billing_amount', 'billing_frequency',
        'permit_number', 'permit_expires',
        'site_address', 'contact_name', 'contact_phone', 'contact_email',
        'panel_brand', 'panel_model', 'camera_count', 'zone_count',
        'contract_type', 'contract_start', 'contract_end',
        'last_inspection', 'next_inspection',
        'maintenance_enabled', 'maintenance_frequency', 'maintenance_next', 'maintenance_last',
    ];
    try {
        const sets = []; const params = [];
        const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

        for (const f of FIELDS) {
            if (f in req.body) add(f, req.body[f] ?? null);
        }

        if (sets.length === 0) return res.json({ message: 'Nothing to update.' });

        params.push(req.params.id);
        const result = await pool.query(
            `UPDATE clients SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
            params
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Client not found.' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update client.' });
    }
});

/* POST /api/clients/:id/monitoring — admin/accounting */
router.post('/:id/monitoring', requireRole('admin', 'accounting'), async (req, res) => {
    try {
        const client = await pool.query('SELECT monitoring_enabled FROM clients WHERE id = $1', [req.params.id]);
        if (client.rowCount === 0) return res.status(404).json({ error: 'Client not found.' });

        const newVal = !client.rows[0].monitoring_enabled;

        await pool.query(
            `UPDATE clients SET
                monitoring_enabled    = $1,
                monitoring_started_at = CASE WHEN $1 THEN NOW() ELSE monitoring_started_at END
             WHERE id = $2`,
            [newVal, req.params.id]
        );

        if (newVal) {
            await pool.query(
                `INSERT INTO client_monitoring (client_id, next_email_at)
                 VALUES ($1, NOW() + INTERVAL '7 days')
                 ON CONFLICT (client_id) DO UPDATE SET next_email_at = NOW() + INTERVAL '7 days'`,
                [req.params.id]
            );
        }

        res.json({ monitoring_enabled: newVal });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to toggle monitoring.' });
    }
});

/* POST /api/clients/:id/tickets */
router.post('/:id/tickets', authenticate, async (req, res) => {
    const { title, description, assigned_to } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required.' });
    try {
        const result = await pool.query(
            `INSERT INTO service_tickets (title, description, status, created_by, assigned_to, client_id)
             VALUES ($1,$2,'open',$3,$4,$5) RETURNING *`,
            [title, description || null, req.user.id, assigned_to || null, req.params.id]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create ticket.' });
    }
});

/* PATCH /api/clients/tickets/:ticketId */
router.patch('/tickets/:ticketId', authenticate, async (req, res) => {
    const { status, assigned_to } = req.body;
    try {
        const result = await pool.query(
            `UPDATE service_tickets SET
                status      = COALESCE($1, status),
                assigned_to = COALESCE($2, assigned_to),
                updated_at  = NOW()
             WHERE id = $3 RETURNING *`,
            [status, assigned_to, req.params.ticketId]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Ticket not found.' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update ticket.' });
    }
});

/* GET /api/clients/:id/transactions — admin/accounting */
router.get('/:id/transactions', requireRole('admin', 'accounting'), async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM client_transactions WHERE client_id = $1 ORDER BY date DESC, created_at DESC',
            [req.params.id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch transactions.' });
    }
});

/* POST /api/clients/:id/transactions — admin/accounting */
router.post('/:id/transactions', requireRole('admin', 'accounting'), async (req, res) => {
    const { description, amount, type, date } = req.body;
    if (!description || !amount || !type)
        return res.status(400).json({ error: 'description, amount, and type are required.' });
    try {
        const result = await pool.query(
            `INSERT INTO client_transactions (client_id, description, amount, type, date, created_by)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [req.params.id, description, amount, type, date || new Date().toISOString().slice(0, 10), req.user.id]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create transaction.' });
    }
});

/* DELETE /api/clients/:id/transactions/:txId — admin/accounting */
router.delete('/:id/transactions/:txId', requireRole('admin', 'accounting'), async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM client_transactions WHERE id = $1 AND client_id = $2 RETURNING id',
            [req.params.txId, req.params.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Transaction not found.' });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete transaction.' });
    }
});

module.exports = router;
