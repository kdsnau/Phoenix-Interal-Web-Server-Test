const express = require('express');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const XLSX    = require('xlsx');
const { WebClient } = require('@slack/web-api');
const pool    = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/requireRole');
const { runMaintenanceCheck } = require('../services/monitoringScheduler');
const {
    topLevelCustomer, isJunkCustomer, isDeadCustomer, subAccount,
    qbDate, qbAmount, invoiceAmounts, fourDigit, numKey, numberCandidates,
} = require('../lib/qbImport');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/* ── Site maps ─────────────────────────────────────────────────────────────
   Two possible sources, admin-switchable (app_settings 'sitemap_source'):
     • 'slack' (default) — files posted in a Slack channel
     • 'drive'           — AutoCAD DWGs in a per-client subfolder on a mounted
                           network share (Saturn is Linux, so it's a CIFS mount,
                           not a UNC path — see deploy notes). */
const SITEMAP_SOURCE_KEY        = 'sitemap_source';
const SITEMAP_ROOT_KEY          = 'sitemap_root';
const SITEMAP_SLACK_CHANNEL_KEY = 'sitemap_slack_channel';
const DEFAULT_SITEMAP_SOURCE        = process.env.SITEMAP_SOURCE || 'slack';
const DEFAULT_SITEMAP_ROOT          = process.env.SITEMAP_ROOT || "/mnt/sitemaps/RFQ's";
const DEFAULT_SITEMAP_SLACK_CHANNEL = process.env.SITEMAP_SLACK_CHANNEL || 'C01N495H7S5';

const slack = process.env.SLACK_TOKEN ? new WebClient(process.env.SLACK_TOKEN) : null;

async function getSetting(key) {
    try {
        const r = await pool.query('SELECT value FROM app_settings WHERE key = $1', [key]);
        return r.rows[0]?.value ?? null;
    } catch { return null; }
}
async function setSetting(key, value) {
    await pool.query(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMP DEFAULT NOW())`).catch(() => {});
    await pool.query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, value]
    );
}
const getSitemapRoot    = async () => (await getSetting(SITEMAP_ROOT_KEY))          || DEFAULT_SITEMAP_ROOT;
const getSitemapSource  = async () => (await getSetting(SITEMAP_SOURCE_KEY))        || DEFAULT_SITEMAP_SOURCE;
const getSitemapChannel = async () => (await getSetting(SITEMAP_SLACK_CHANNEL_KEY)) || DEFAULT_SITEMAP_SLACK_CHANNEL;

const normName = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const isDwg    = name => /dwg/i.test(name);

/* List files posted in a Slack channel (newest first, capped). Returns a list
   shaped like the drive listing so the client can treat both the same. */
async function listSlackFiles(channel) {
    if (!slack) throw Object.assign(new Error('Slack is not configured (SLACK_TOKEN missing).'), { slackError: 'no_token' });
    const out = [];
    for (let page = 1; page <= 3; page++) {
        const r = await slack.files.list({ channel, count: 200, page });
        for (const f of (r.files || [])) {
            out.push({
                key:      f.id,
                name:     f.name || f.title || f.id,
                title:    f.title || '',
                size:     f.size ?? null,
                modified: f.created ? new Date(f.created * 1000).toISOString() : null,
                mimetype: f.mimetype || '',
                dl:       `slack_file=${encodeURIComponent(f.id)}`,
            });
        }
        if (!r.paging || page >= (r.paging.pages || 1)) break;
    }
    out.sort((a, b) => (b.modified || '').localeCompare(a.modified || ''));
    return out;
}

/* Find ALL subfolders under `root` that belong to a client. The share is laid
   out one folder per RFQ/job, so a single client spans many folders (e.g.
   "6656 The Pharm - CCTV", "6418 The Pharm - CCTV", …). Match folders whose
   normalized name contains the client name (min 3 chars, to avoid spurious
   short matches) or the customer id. Throws if the drive can't be read. */
async function resolveClientFolders(root, client) {
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    const cName = normName(client.name);
    const cId   = normName(client.customer_id);
    return entries
        .filter(e => e.isDirectory())
        .filter(d => {
            const dn = normName(d.name);
            return (cName.length >= 3 && dn.includes(cName)) || (cId && dn.includes(cId));
        })
        .map(d => path.join(root, d.name));
}

/* Collect DWG files within a client folder (a few levels deep), each with its
   path relative to that folder so downloads can resolve safely. */
async function walkDwg(dir, base = dir, depth = 0, out = []) {
    if (depth > 4) return out;
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
    catch { return out; }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            await walkDwg(full, base, depth + 1, out);
        } else if (isDwg(e.name)) {
            let stat = null;
            try { stat = await fs.promises.stat(full); } catch { /* ignore */ }
            out.push({ name: e.name, rel: path.relative(base, full), size: stat?.size ?? null, modified: stat?.mtime ?? null });
        }
    }
    return out;
}

/* ── Schema migrations ────────────────────────────────────────────────── */
pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS permit_number   TEXT`).catch(() => {});
pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS permit_expires  DATE`).catch(() => {});
/* Canonical QuickBooks customer number — shared across a customer's billing anchor
   + monitored panel rows. Imports dedupe on this so the anchor/panel duplication
   that forced the 2026-06 cleanup can't silently come back. */
pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS customer_number TEXT`).catch(() => {});
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
/* Tech the auto-generated maintenance ticket is assigned to. */
pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS maintenance_assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL`).catch(() => {});

/* QuickBooks provenance on client_transactions — lets the import dedupe on re-run.
   client_id is nullable + customer_name carries the QB name so transactions for
   customers we don't yet have as clients (Unmonitored) can still be ledgered. */
pool.query(`ALTER TABLE client_transactions ADD COLUMN IF NOT EXISTS source        TEXT`).catch(() => {});
pool.query(`ALTER TABLE client_transactions ADD COLUMN IF NOT EXISTS ref_num       TEXT`).catch(() => {});
pool.query(`ALTER TABLE client_transactions ADD COLUMN IF NOT EXISTS customer_name TEXT`).catch(() => {});
/* Invoice breakdown: amount holds the Total; these split out what's paid vs owed. */
pool.query(`ALTER TABLE client_transactions ADD COLUMN IF NOT EXISTS balance_due   NUMERIC`).catch(() => {});
pool.query(`ALTER TABLE client_transactions ADD COLUMN IF NOT EXISTS paid_amount   NUMERIC`).catch(() => {});
pool.query(`ALTER TABLE client_transactions ALTER COLUMN client_id DROP NOT NULL`).catch(() => {});

/* Customers seen in QuickBooks exports that aren't in our client list */
pool.query(`
    CREATE TABLE IF NOT EXISTS unmonitored_clients (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL,
        first_seen TIMESTAMP NOT NULL DEFAULT NOW(),
        last_seen  TIMESTAMP NOT NULL DEFAULT NOW()
    )
`).then(() =>
    pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_unmon_name ON unmonitored_clients (lower(name))`)
).catch(() => {});

/* Per-client notes board — a running discussion any staff member can post to
   (mirrors the dashboard Notice Board, but scoped to one client). */
pool.query(`
    CREATE TABLE IF NOT EXISTS client_posts (
        id          SERIAL PRIMARY KEY,
        client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        content     TEXT NOT NULL,
        author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        author_name VARCHAR(100),
        created_at  TIMESTAMP DEFAULT NOW()
    )
`).catch(err => console.error('client_posts table init:', err.message));
pool.query(`CREATE INDEX IF NOT EXISTS idx_client_posts_client ON client_posts (client_id, created_at DESC)`).catch(() => {});

/* Client category — NULL for the standard (monitored/service) clients, 'project'
   for install-only clients we don't monitor (imported from the QB active list). */
pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS category TEXT`).catch(() => {});

/* Manual rollups — user-defined groupings that sit alongside the automatic
   customer_number rollup. A client with a rollup_id groups under that named
   rollup; clients without one keep grouping by customer_number as before.
   Run IN ORDER: the clients.rollup_id FK references client_rollups, so the table
   MUST exist first. Firing them concurrently let the ALTER lose the race, its FK
   reference failed, .catch swallowed it, and rollup_id was never added — which
   500'd GET /clients (it LEFT JOINs on rollup_id), so the whole list came back
   empty. Column-before-constraint so a constraint hiccup can't drop the column. */
(async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS client_rollups (
                id         SERIAL PRIMARY KEY,
                name       TEXT NOT NULL UNIQUE,
                created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS rollup_id INTEGER`);
        await pool.query(`
            DO $$ BEGIN
                ALTER TABLE clients ADD CONSTRAINT clients_rollup_id_fkey
                    FOREIGN KEY (rollup_id) REFERENCES client_rollups(id) ON DELETE SET NULL;
            EXCEPTION WHEN duplicate_object THEN NULL; END $$
        `);
    } catch (err) {
        console.error('client_rollups migration failed:', err);
    }
})();

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

/* GET /api/clients?service=&vendor=&search=&category=
   category='project' returns only install-only project clients; otherwise the
   standard views exclude them so they don't flood the monitored/service tabs. */
router.get('/', authenticate, async (req, res) => {
    const { service, vendor, search, category } = req.query;
    const conditions = [];
    const params     = [];

    if (category === 'project') { conditions.push(`c.category = 'project'`); }
    else                        { conditions.push(`c.category IS DISTINCT FROM 'project'`); }

    if (service) { params.push(service);        conditions.push(`$${params.length} = ANY(c.services)`); }
    if (vendor)  { params.push(vendor);          conditions.push(`c.vendor = $${params.length}`); }
    if (search)  { params.push(`%${search}%`);  conditions.push(`(c.name ILIKE $${params.length} OR c.customer_id ILIKE $${params.length})`); }

    const where = ' WHERE ' + conditions.join(' AND ');
    try {
        const result = await pool.query(
            `SELECT c.*, r.name AS rollup_name
             FROM clients c LEFT JOIN client_rollups r ON r.id = c.rollup_id
             ${where} ORDER BY c.name`, params);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch clients.' });
    }
});

/* ═══ Manual rollups ═════════════════════════════════════════════════════ */

/* GET /api/clients/rollups — list rollups with member counts. */
router.get('/rollups', authenticate, async (_req, res) => {
    try {
        const r = await pool.query(`
            SELECT r.id, r.name, COUNT(c.id)::int AS member_count
            FROM client_rollups r LEFT JOIN clients c ON c.rollup_id = r.id
            GROUP BY r.id, r.name ORDER BY r.name`);
        res.json(r.rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to load rollups.' }); }
});

/* POST /api/clients/rollups { name } — admin creates a named rollup. */
router.post('/rollups', requireRole('admin'), async (req, res) => {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required.' });
    try {
        const r = await pool.query(
            'INSERT INTO client_rollups (name, created_by) VALUES ($1, $2) RETURNING id, name',
            [name, req.user.id]);
        res.status(201).json(r.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'A rollup with that name already exists.' });
        console.error(err); res.status(500).json({ error: 'Failed to create rollup.' });
    }
});

/* PUT /api/clients/:id/rollup { rollup_id } — admin assigns/clears a client's
   manual rollup (null clears it, falling the client back to auto-grouping). */
router.put('/:id/rollup', requireRole('admin'), async (req, res) => {
    const rollupId = req.body.rollup_id == null || req.body.rollup_id === '' ? null : Number(req.body.rollup_id);
    try {
        const r = await pool.query('UPDATE clients SET rollup_id = $1 WHERE id = $2 RETURNING id, rollup_id',
            [rollupId, req.params.id]);
        if (!r.rowCount) return res.status(404).json({ error: 'Client not found.' });
        res.json(r.rows[0]);
    } catch (err) {
        if (err.code === '23503') return res.status(400).json({ error: 'That rollup does not exist.' });
        console.error(err); res.status(500).json({ error: 'Failed to assign rollup.' });
    }
});

/* ═══ Project-client import (QuickBooks active customer list) ═════════════ */

/* First non-empty of the given cells. */
const firstOf = (...vals) => { for (const v of vals) { const s = String(v || '').trim(); if (s) return s; } return ''; };

/* POST /api/clients/import-projects — admin uploads the QB active-customer CSV.
   Collapses to top-level businesses and inserts the install-only ones we DON'T
   already have as clients (deduped by Account No. → customer_number, then name)
   with category='project'. Existing/monitored customers are skipped. */
router.post('/import-projects', requireRole('admin'), upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    try {
        /* QB exports are usually Windows-1252 CSV; decode as latin1 so accented
           names survive. XLSX handles .xlsx too. */
        const fname = (req.file.originalname || '').toLowerCase();
        const wb = (fname.endsWith('.csv') || (req.file.mimetype || '').includes('csv'))
            ? XLSX.read(req.file.buffer.toString('latin1'), { type: 'string' })
            : XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows  = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
        if (!rows.length) return res.status(400).json({ error: 'The file has no rows.' });

        /* Map columns by header name so column order doesn't matter. */
        const header = rows[0].map(h => String(h || '').trim().toLowerCase());
        const ci = {};
        header.forEach((h, i) => { if (h && !(h in ci)) ci[h] = i; });
        const cell = (row, name) => { const i = ci[name.toLowerCase()]; return i == null ? '' : String(row[i] ?? '').trim(); };
        if (ci['customer'] == null) return res.status(400).json({ error: 'No "Customer" column found — is this the QB customer list?' });

        /* Existing clients, to skip anything we already track. */
        const ex = await pool.query('SELECT customer_id, customer_number, name FROM clients');
        const existNums  = new Set(ex.rows.map(r => numKey(r.customer_number)).filter(Boolean));
        const existNames = new Set(ex.rows.map(r => normName(r.name)).filter(Boolean));
        const usedIds    = new Set(ex.rows.map(r => r.customer_id));

        let created = 0, skippedExisting = 0, skippedJunk = 0;
        const createdNames = [];
        const seenNames = new Set();

        for (const row of rows.slice(1)) {
            const rawCustomer = cell(row, 'customer');
            if (!rawCustomer) continue;
            if (subAccount(rawCustomer)) continue;                 // sub-job, not a top-level business
            if (isDeadCustomer(rawCustomer)) { skippedJunk++; continue; }

            const name = firstOf(cell(row, 'company'), topLevelCustomer(rawCustomer));
            if (!name || isJunkCustomer(name)) { skippedJunk++; continue; }

            const nkey = normName(name);
            if (seenNames.has(nkey)) continue;                     // dupe top-level row in the file
            seenNames.add(nkey);

            const acct   = cell(row, 'account no.');
            const custNo = numKey(acct) || null;

            /* Skip anything we already have — those are monitored/existing clients. */
            if ((custNo && existNums.has(custNo)) || existNames.has(nkey)) { skippedExisting++; continue; }

            /* Unique customer_id in a PRJ- namespace so it can't clobber existing ids. */
            let base = 'PRJ-' + (custNo || nkey.slice(0, 40) || 'x');
            base = base.slice(0, 48);
            let cid = base, n = 2;
            while (usedIds.has(cid)) cid = `${base}-${n++}`.slice(0, 50);
            usedIds.add(cid);

            const contactName  = firstOf(cell(row, 'primary contact'),
                                         `${cell(row, 'first name')} ${cell(row, 'last name')}`.trim());
            const contactPhone = cell(row, 'main phone');
            const contactEmail = firstOf(cell(row, 'main email')).split(/[;,]/)[0].trim();
            const address = [cell(row, 'ship to 2'), cell(row, 'ship to 3'), cell(row, 'ship to 4')]
                                .filter(Boolean).join(', ')
                          || [cell(row, 'bill to 2'), cell(row, 'bill to 3'), cell(row, 'bill to 4')]
                                .filter(Boolean).join(', ');

            try {
                await pool.query(
                    `INSERT INTO clients
                        (customer_id, name, category, services, monitoring_enabled, customer_number,
                         site_address, contact_name, contact_phone, contact_email)
                     VALUES ($1,$2,'project','{}',FALSE,$3,$4,$5,$6,$7)`,
                    [cid, name.slice(0, 200), custNo, address || null,
                     contactName || null, contactPhone || null, contactEmail || null]);
                created++;
                /* Don't add custNo to existNums here: a few distinct businesses
                   share a QB Account No., and seenNames already blocks true
                   same-name dupes — so this keeps both of those businesses. */
                if (createdNames.length < 25) createdNames.push(name);
            } catch (e) {
                if (e.code === '23505') { skippedExisting++; }      // raced a unique constraint
                else { console.error('project import row failed:', e.message); }
            }
        }

        res.json({ created, skipped_existing: skippedExisting, skipped_junk: skippedJunk, sample: createdNames });
    } catch (err) {
        console.error('Project import error:', err);
        res.status(500).json({ error: 'Failed to import project clients.' });
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

/* POST /api/clients/import-quickbooks — upload QB CSV(s).
   Invoices/payments → client_transactions for matched clients (idempotent);
   every top-level customer not in our list accumulates under Unmonitored. */
router.post('/import-quickbooks', requireRole('admin'), upload.array('files', 12), async (req, res) => {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded.' });
    try {
        const customers = new Set();   // every QB top-level customer name we saw
        const parsedTx  = [];          // { name, kind, amount, num, date, desc }
        const acctByName = new Map();  // lower(top-level customer) → QB "Account No." (from a customer-list export)
        let rows = 0;

        for (const file of req.files) {
            const wb   = XLSX.read(file.buffer, { type: 'buffer' });
            const ws   = wb.Sheets[wb.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

            /* Locate header row + map columns by name (order-independent across exports). */
            let hi = json.findIndex(r => String(r[0]).trim().toLowerCase() === 'customer');
            if (hi < 0) hi = 0;
            const col = {};
            (json[hi] || []).forEach((h, i) => { col[String(h).trim().toLowerCase()] = i; });
            const cust = col['customer'] ?? 0;

            /* Only invoices & payments carry money we ledger. Estimates / sales orders
               (no "Due Date" / "Pay Meth"; have "Active Estimate?") stay name-only. */
            const kind = ('pay meth' in col) ? 'payment'
                       : ('due date' in col) ? 'invoice'
                       : null;

            for (let i = hi + 1; i < json.length; i++) {
                const row = json[i];
                rows++;
                const raw = row[cust];
                if (isDeadCustomer(raw)) continue;              // skip DNS / DND / do-not-service
                const name = topLevelCustomer(raw);
                if (!name || isJunkCustomer(name)) continue;
                customers.add(name);

                /* Customer-list exports carry an "Account No." — remember each
                   customer's number so invoices (which only list a name) can match
                   clients by number, not just by name. First (top-level) row wins. */
                if (col['account no.'] != null) {
                    const acct = String(row[col['account no.']] ?? '').trim();
                    if (acct && !acctByName.has(name.toLowerCase())) acctByName.set(name.toLowerCase(), acct);
                }

                if (!kind) continue;
                const amount = qbAmount(row[col['amount']]);
                if (amount == null || amount === 0) continue;
                const total = Math.abs(amount);
                const num = String(row[col['num']] ?? '').trim() || null;
                const sub = subAccount(raw);

                /* Invoices split into paid / balance via the "Open Balance" column:
                   total = Amount, balance = Open Balance (blank ⇒ fully paid),
                   paid = total − balance. Payments aren't split. */
                let balance_due = null, paid_amount = null;
                if (kind === 'invoice') {
                    ({ balance_due, paid_amount } = invoiceAmounts(total, qbAmount(row[col['open balance']])));
                }

                let desc;
                if (kind === 'payment') {
                    const meth = String(row[col['pay meth']] ?? '').trim();
                    desc = `Payment ${num || ''}`.trim() + (meth ? ` (${meth})` : '');
                } else {
                    desc = `Invoice ${num || ''}`.trim();
                }
                if (sub) desc += ` — ${sub}`;
                parsedTx.push({
                    name, kind,
                    amount: total,
                    balance_due, paid_amount,
                    num,
                    date: qbDate(row[col['date']]),
                    desc: desc.slice(0, 300),
                });
            }
        }

        /* Prefer the billing/umbrella row (no service labels) so a customer's
           transactions land on its rollup row rather than a random panel. */
        const existing = await pool.query(
            'SELECT id, name, customer_id, customer_number FROM clients ORDER BY (COALESCE(array_length(services,1),0)=0) DESC, id'
        );
        const idByName = new Map(existing.rows.map(r => [(r.name || '').trim().toLowerCase(), r.id]));
        const have     = new Set(idByName.keys());

        /* Number-first matching. A client's customer_id is its QB account number
           (usually 4 digits). Index clients by that number (raw + 4-digit form),
           and resolve each transaction's number from the customer-list Account No.
           or the invoice Num prefix ("1408-348" → "1408"; "FC 2605" has none). */
        const idByNum = new Map();
        for (const r of existing.rows) {
            const cn = numKey(r.customer_number);            // authoritative QB number
            if (cn && !idByNum.has(cn)) idByNum.set(cn, r.id);
            const raw = numKey(r.customer_id);
            if (raw && !idByNum.has(raw)) idByNum.set(raw, r.id);
            const fd = fourDigit(r.customer_id);
            if (fd && !idByNum.has(fd)) idByNum.set(fd, r.id);
        }
        const resolveClientId = (t) => {
            for (const cand of numberCandidates({ name: t.name, num: t.num, acctByName })) {
                if (idByNum.has(cand)) return idByNum.get(cand);
            }
            return idByName.get(t.name.toLowerCase()) || null;   // last resort: by name
        };

        /* ── Ledger ──
           Invoices upsert on their QuickBooks Num (ref_num) so re-importing an
           updated report refreshes amount / paid / balance in place. Payments and
           any numberless rows dedupe on a content key so repeats don't duplicate.
           Unmatched customers are stored by customer_name so they still appear
           (flagged "unmonitored") on the Financials Client Billing tab. ── */
        const existingQb = await pool.query(
            "SELECT id, client_id, customer_name, type, description, date, amount, ref_num FROM client_transactions WHERE source = 'quickbooks'"
        );
        const today = new Date().toISOString().slice(0, 10);
        const ymd   = d => (d instanceof Date ? d.toISOString().slice(0, 10) : d);
        const txKey = (cid, name, kind, date, amount, desc) =>
            `${cid ? `c|${cid}` : `u|${(name || '').toLowerCase()}`}|${kind}|${ymd(date)}|${Number(amount)}|${desc}`;

        const seen     = new Set();
        const invByRef = new Map();   // QB invoice Num → existing row id (for balance refresh)
        for (const r of existingQb.rows) {
            if (r.type === 'invoice' && r.ref_num) invByRef.set(String(r.ref_num), r.id);
            else seen.add(txKey(r.client_id, r.customer_name, r.type, r.date, r.amount, r.description));
        }

        const toInsert = [];
        const toUpdate = [];
        const matched  = new Set();
        for (const t of parsedTx) {
            const cid  = resolveClientId(t);
            const date = t.date || today;
            if (cid) matched.add(cid);

            /* Invoices: refresh in place when the Num already exists, else insert. */
            if (t.kind === 'invoice' && t.num) {
                const existingId = invByRef.get(String(t.num));
                if (existingId && existingId > 0) {
                    toUpdate.push([existingId, cid, cid ? null : t.name, t.desc, t.amount, t.balance_due, t.paid_amount, date]);
                } else if (!existingId) {
                    invByRef.set(String(t.num), -1);   // claim the Num so a dup line in this file doesn't re-insert
                    toInsert.push([cid, cid ? null : t.name, t.desc, t.amount, t.balance_due, t.paid_amount, t.kind, date, req.user.id, 'quickbooks', t.num]);
                }
                continue;
            }

            /* Payments / numberless rows: content-key dedupe. */
            const key = txKey(cid, t.name, t.kind, date, t.amount, t.desc);
            if (seen.has(key)) continue;
            seen.add(key);
            toInsert.push([cid, cid ? null : t.name, t.desc, t.amount, t.balance_due, t.paid_amount, t.kind, date, req.user.id, 'quickbooks', t.num]);
        }
        for (let i = 0; i < toInsert.length; i += 500) {
            const chunk = toInsert.slice(i, i + 500);
            const ph = chunk.map((_, j) => {
                const b = j * 11;
                return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11})`;
            }).join(',');
            await pool.query(
                `INSERT INTO client_transactions
                    (client_id, customer_name, description, amount, balance_due, paid_amount, type, date, created_by, source, ref_num)
                 VALUES ${ph}`,
                chunk.flat()
            );
        }
        for (let i = 0; i < toUpdate.length; i += 500) {
            const chunk = toUpdate.slice(i, i + 500);
            await Promise.all(chunk.map(u => pool.query(
                `UPDATE client_transactions
                    SET client_id = $2, customer_name = $3, description = $4,
                        amount = $5, balance_due = $6, paid_amount = $7, date = $8
                  WHERE id = $1`, u)));
        }
        const txMatched     = toInsert.filter(r => r[0] !== null).length;
        const txUnmonitored = toInsert.length - txMatched;

        /* ── Unmonitored: accumulate every customer not already a client ── */
        const before = (await pool.query('SELECT COUNT(*)::int AS n FROM unmonitored_clients')).rows[0].n;
        const existingUnmon = await pool.query('SELECT lower(name) AS ln FROM unmonitored_clients');
        const haveUnmon = new Set(existingUnmon.rows.map(r => r.ln));
        for (const name of customers) {
            const ln = name.toLowerCase();
            if (have.has(ln) || haveUnmon.has(ln)) continue;   // already a client or already listed
            await pool.query('INSERT INTO unmonitored_clients (name) VALUES ($1)', [name]);
            haveUnmon.add(ln);
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
            tx_added: toInsert.length,
            tx_updated: toUpdate.length,
            tx_matched: txMatched,
            tx_unmonitored: txUnmonitored,
            clients_matched: matched.size,
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

/* POST /api/clients/run-maintenance — run the maintenance check now (admin).
   Creates/assigns tickets for any client whose maintenance is due today. */
router.post('/run-maintenance', requireRole('admin'), async (req, res) => {
    try {
        const result = await runMaintenanceCheck();
        return res.json(result);
    } catch (err) {
        console.error('run-maintenance error:', err);
        return res.status(500).json({ error: 'Maintenance run failed.' });
    }
});

/* ── Site maps (Slack channel or network drive) ──────────────────────────── */

/* GET /api/clients/site-map-config — current source + targets (admin). */
router.get('/site-map-config', requireRole('admin'), async (_req, res) => {
    res.json({
        source:        await getSitemapSource(),
        root:          await getSitemapRoot(),
        slack_channel: await getSitemapChannel(),
        defaults: { source: DEFAULT_SITEMAP_SOURCE, root: DEFAULT_SITEMAP_ROOT, slack_channel: DEFAULT_SITEMAP_SLACK_CHANNEL },
    });
});

/* PUT /api/clients/site-map-config  { source?, root?, slack_channel? } (admin). */
router.put('/site-map-config', requireRole('admin'), async (req, res) => {
    const { source, root, slack_channel } = req.body;
    if (source && !['slack', 'drive'].includes(source)) {
        return res.status(400).json({ error: 'source must be "slack" or "drive".' });
    }
    try {
        if (source)                                       await setSetting(SITEMAP_SOURCE_KEY, source);
        if (typeof root === 'string' && root.trim())      await setSetting(SITEMAP_ROOT_KEY, root.trim());
        if (typeof slack_channel === 'string' && slack_channel.trim())
            await setSetting(SITEMAP_SLACK_CHANNEL_KEY, slack_channel.trim());
        res.json({ ok: true });
    } catch (err) {
        console.error('set site-map-config error:', err);
        res.status(500).json({ error: 'Failed to save site-map settings.' });
    }
});

/* Friendlier message for the common Slack failures. */
function slackErrMsg(e) {
    const code = e?.data?.error || e?.slackError;
    if (code === 'no_token')        return 'Slack is not configured on the server (SLACK_TOKEN missing).';
    if (code === 'missing_scope')   return 'The Slack app is missing the files:read scope — add it and reinstall the app.';
    if (code === 'channel_not_found') return 'Slack channel not found, or the bot is not a member of it (invite the bot to the channel).';
    if (code === 'not_in_channel')  return 'The bot is not a member of that Slack channel — invite it, then retry.';
    return e?.message || 'Slack request failed.';
}

/* GET /api/clients/:id/site-maps — list a client's site maps from the active source. */
router.get('/:id/site-maps', authenticate, async (req, res) => {
    try {
        const c = await pool.query('SELECT id, name, customer_id FROM clients WHERE id = $1', [req.params.id]);
        if (c.rowCount === 0) return res.status(404).json({ error: 'Client not found.' });

        const source = await getSitemapSource();

        if (source === 'slack') {
            const channel = await getSitemapChannel();
            try {
                const files = await listSlackFiles(channel);
                return res.json({ source: 'slack', channel, files });
            } catch (e) {
                return res.status(502).json({ source: 'slack', channel, error: slackErrMsg(e) });
            }
        }

        /* drive */
        const root = await getSitemapRoot();
        let folders;
        try {
            folders = await resolveClientFolders(root, c.rows[0]);
        } catch (e) {
            let who = 'unknown';
            try { who = require('os').userInfo().username; } catch { /* ignore */ }
            return res.status(502).json({
                source: 'drive', root,
                error: `Cannot reach the site-map drive at ${root} (${e.code || e.message}). The portal process is running as "${who}" — that account must be able to open the share.`,
            });
        }
        if (!folders.length) return res.json({ source: 'drive', root, folder: null, files: [] });

        /* Walk every matched folder; keys are relative to the root so they stay
           unique across folders and resolvable on download. Each file is tagged
           with its folder (the RFQ/job) so they're distinguishable. */
        const files = [];
        for (const folder of folders) {
            const label = path.basename(folder);
            for (const f of await walkDwg(folder)) {
                const relFromRoot = path.relative(root, path.join(folder, f.rel));
                files.push({
                    key:      relFromRoot,
                    name:     f.name,
                    folder:   label,
                    size:     f.size,
                    modified: f.modified ? new Date(f.modified).toISOString() : null,
                    dl:       `file=${encodeURIComponent(relFromRoot)}`,
                });
            }
        }
        files.sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));
        res.json({ source: 'drive', root, folders: folders.map(f => path.basename(f)), files });
    } catch (err) {
        console.error('site-maps list error:', err);
        res.status(500).json({ error: 'Failed to list site maps.' });
    }
});

/* GET /api/clients/:id/site-maps/download?slack_file=<id> | ?file=<rel> */
router.get('/:id/site-maps/download', authenticate, async (req, res) => {
    try {
        /* Slack-hosted file — proxy it through with the bot token. */
        if (req.query.slack_file) {
            if (!slack) return res.status(503).json({ error: 'Slack is not configured on the server.' });
            if (typeof fetch !== 'function') return res.status(500).json({ error: 'Server runtime lacks fetch (Node 18+ required).' });
            let info;
            try { info = await slack.files.info({ file: req.query.slack_file }); }
            catch (e) { return res.status(502).json({ error: slackErrMsg(e) }); }
            const f   = info.file || {};
            const url = f.url_private_download || f.url_private;
            if (!url) return res.status(404).json({ error: 'Slack file URL unavailable.' });
            const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.SLACK_TOKEN}` } });
            if (!r.ok) return res.status(502).json({ error: `Slack download failed (${r.status}).` });
            res.setHeader('Content-Type', f.mimetype || 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${String(f.name || 'sitemap').replace(/"/g, '')}"`);
            return res.end(Buffer.from(await r.arrayBuffer()));
        }

        /* Drive-hosted file. */
        const rel = req.query.file;
        if (!rel) return res.status(400).json({ error: 'file is required.' });

        const c = await pool.query('SELECT id, name, customer_id FROM clients WHERE id = $1', [req.params.id]);
        if (c.rowCount === 0) return res.status(404).json({ error: 'Client not found.' });

        const root    = await getSitemapRoot();
        const folders = await resolveClientFolders(root, c.rows[0]).catch(() => []);
        if (!folders.length) return res.status(404).json({ error: 'No site-map folder for this client.' });

        /* Block path traversal — resolved file must stay inside one of this
           client's matched folders. */
        const abs = path.resolve(root, rel);
        const allowed = folders.some(folder => {
            const fr = path.resolve(folder);
            return abs === fr || abs.startsWith(fr + path.sep);
        });
        if (!allowed) return res.status(400).json({ error: 'Invalid file path.' });

        res.download(abs, path.basename(abs), err => {
            if (err && !res.headersSent) res.status(404).json({ error: 'File not found.' });
        });
    } catch (err) {
        console.error('site-map download error:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Download failed.' });
    }
});

/* Most-recently-modified FILE inside a customer folder (its invoices), recursing
   a couple levels. The folder's OWN mtime is ignored — only the files count, so a
   touched/renamed folder full of old invoices still reads as old. Returns 0 (very
   old) when there are no files at all. */
async function newestFileMtimeMs(dir, depth = 0) {
    let newest = 0, entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return 0; }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (depth < 3) { const m = await newestFileMtimeMs(full, depth + 1); if (m > newest) newest = m; }
        } else {
            try { const st = await fs.promises.stat(full); if (st.mtimeMs > newest) newest = st.mtimeMs; } catch { /* ignore */ }
        }
    }
    return newest;
}

/* POST /api/clients/rebuild-from-drive  { commit?, path? } — rebuild the client
   list from the per-client folders on the Customers share. Dry-run by default:
   returns what WOULD be added/removed. commit:true performs it. Monitored clients
   (and their service types) are always preserved. */
router.post('/rebuild-from-drive', requireRole('admin'), async (req, res) => {
    const commit = req.body.commit === true;
    const root   = (req.body.path || process.env.CLIENTS_DRIVE_ROOT || '/mnt/sitemaps/Invoices/Invoices - Customers').trim();

    let folders;
    try {
        const entries = await fs.promises.readdir(root, { withFileTypes: true });
        folders = entries.filter(e => e.isDirectory()).map(e => e.name).filter(n => !n.startsWith('.'));
    } catch (e) {
        return res.status(502).json({ error: `Cannot read the clients folder at ${root} (${e.code || e.message}).`, root });
    }

    /* Customer folders carry a standalone 4-digit account number = the customer_id.
       Folders without one are deprecated and ignored. */
    const fourDigit = s => { const m = String(s || '').match(/(?<!\d)\d{4}(?!\d)/); return m ? m[0] : null; };
    const cleanName = f => f.replace(/(?<!\d)\d{4}(?!\d)/, '').replace(/\s{2,}/g, ' ').replace(/^[\s\-_.]+|[\s\-_.]+$/g, '').trim() || f;

    const existing = (await pool.query('SELECT id, name, customer_id, customer_number, monitoring_enabled, services FROM clients')).rows;
    const existingByNum = new Map();
    for (const c of existing) {
        /* authoritative customer_number first, then the legacy 4-digit heuristic */
        for (const n of [c.customer_number, fourDigit(c.customer_id), fourDigit(c.name)]) {
            if (n && !existingByNum.has(String(n))) existingByNum.set(String(n), c);
        }
    }
    const taken = new Set(existing.map(c => c.customer_id));

    /* Only ADD customers whose newest invoice file was modified within 3 years. */
    const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 3);
    const cutoffMs = cutoff.getTime();

    const toAdd = [], matchedNums = new Set(), folderNums = new Set();
    let skippedNoNumber = 0, skippedInactive = 0;
    for (const f of folders) {
        const num = fourDigit(f);
        if (!num) { skippedNoNumber++; continue; }       /* deprecated — no 4-digit number */
        folderNums.add(num);
        if (existingByNum.has(num)) { matchedNums.add(num); continue; }   /* already a client */
        const newest = await newestFileMtimeMs(path.join(root, f));
        if (newest >= cutoffMs) toAdd.push({ name: cleanName(f), customer_id: num, folder: f });
        else skippedInactive++;                          /* no invoice modified in 3 years */
    }

    /* A client is protected (never removed) if it's monitored OR carries a service
       type (fire/alarm/access) — these are the established accounts, even the
       old name-only ones with no invoice number. Only truly orphaned unmonitored,
       untyped clients with no matching folder are dropped. */
    const isProtected = c => c.monitoring_enabled || (Array.isArray(c.services) && c.services.length > 0);
    const toRemove = existing.filter(c => {
        if (isProtected(c)) return false;
        const num = c.customer_number || fourDigit(c.customer_id) || fourDigit(c.name);
        return !num || !folderNums.has(num);
    });

    const preview = {
        root,
        folder_count:      folders.length,
        skipped_no_number: skippedNoNumber,
        skipped_inactive:  skippedInactive,
        to_add:            toAdd.map(a => `${a.customer_id} — ${a.name}`),
        matched_count:     matchedNums.size,
        to_remove:         toRemove.map(c => ({ id: c.id, name: c.name, customer_id: c.customer_id })),
        kept_count:        existing.filter(isProtected).length,
    };

    if (!commit) return res.json({ committed: false, ...preview });

    const uniqueCid = (cid) => { let out = cid, i = 2; while (taken.has(out)) out = `${cid}-${i++}`; taken.add(out); return out; };

    let added = 0, removed = 0;
    for (const a of toAdd) {
        await pool.query(
            'INSERT INTO clients (name, customer_id, customer_number, vendor, services, monitoring_enabled) VALUES ($1, $2, $3, $4, $5, FALSE)',
            [a.name, uniqueCid(a.customer_id), a.customer_id, 'generic', []]
        ).then(() => { added++; }).catch(e => console.error('rebuild add failed:', a.folder, e.message));
    }
    for (const c of toRemove) {
        await pool.query('DELETE FROM clients WHERE id = $1', [c.id])
            .then(() => { removed++; }).catch(e => console.error('rebuild remove failed:', c.id, e.message));
    }
    res.json({ committed: true, ...preview, added, removed });
});

/* POST /api/clients/rebuild-from-audit  (multipart: file=.xlsx, commit?) — reconcile
   the client list against an authoritative alarm-audit spreadsheet. Match is by the
   "Account #" customer number (3–6 digits, since the names are mangled). Dry-run by
   default. Adds audit customers we don't have (service inferred from BURG/FIRE labels);
   removes clients whose number isn't in the audit — EXCEPT protected ones (monitored
   or already labeled fire/alarm/access). Matched clients are left untouched. */
router.post('/rebuild-from-audit', requireRole('admin'), upload.single('file'), async (req, res) => {
    const commit = req.body.commit === true || req.body.commit === 'true';
    if (!req.file) return res.status(400).json({ error: 'Upload the audit .xlsx (field "file").' });

    const custNum    = s => { const m = String(s == null ? '' : s).match(/\d{3,6}/); return m ? m[0] : null; };
    const cleanName  = n => String(n || '').replace(/\([^)]*\)/g, '').replace(/\s{2,}/g, ' ').trim();
    const auditServices = (name) => {                       /* read only the (…) labels */
        const out = [];
        for (const g of (String(name || '').match(/\(([^)]*)\)/g) || [])) {
            const flat = g.toUpperCase().replace(/[^A-Z]/g, '');
            if (flat.includes('BURG'))                   out.push('alarm');
            if (/F[YWI]RE/.test(flat) || flat.includes('FIRE')) out.push('fire');
        }
        return out;
    };

    let wb;
    try { wb = XLSX.read(req.file.buffer, { type: 'buffer' }); }
    catch { return res.status(400).json({ error: 'Could not read that file — is it a valid .xlsx?' }); }

    /* Authoritative set: every customer number across all sheets except "Deactivated". */
    const auditMap   = new Map();   // num → { name, services:Set }
    const sheetsUsed = [];
    for (const sn of wb.SheetNames) {
        if (sn.trim().toLowerCase() === 'deactivated') continue;
        sheetsUsed.push(sn);
        const json = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
        let hi = json.findIndex(r => r.some(c => String(c).trim().toLowerCase() === 'account #'));
        let acctCol = 4, nameCol = 2;
        if (hi >= 0) {
            acctCol = json[hi].findIndex(c => String(c).trim().toLowerCase() === 'account #');
            const nc = json[hi].findIndex(c => String(c).trim().toLowerCase() === 'customer name');
            if (nc >= 0) nameCol = nc;
        } else hi = 0;
        for (let i = hi + 1; i < json.length; i++) {
            const num = custNum(json[i][acctCol]);
            if (!num) continue;
            const rawName = String(json[i][nameCol] ?? '').trim();
            let e = auditMap.get(num);
            if (!e) { e = { name: '', services: new Set() }; auditMap.set(num, e); }
            if (!e.name && rawName) e.name = rawName;
            for (const s of auditServices(rawName)) e.services.add(s);
        }
    }
    if (auditMap.size === 0) return res.status(400).json({ error: 'No customer numbers found — is this the right file/format?' });

    const existing = (await pool.query('SELECT id, name, customer_id, customer_number, monitoring_enabled, services FROM clients')).rows;
    const existingByNum = new Map();
    for (const c of existing) {
        /* authoritative customer_number first, then the mangled-name number heuristic */
        for (const n of [c.customer_number, custNum(c.customer_id), custNum(c.name)]) {
            if (n && !existingByNum.has(String(n))) existingByNum.set(String(n), c);
        }
    }
    const taken = new Set(existing.map(c => c.customer_id));

    const toAdd = [], matchedNums = new Set();
    for (const [num, e] of auditMap) {
        if (existingByNum.has(num)) { matchedNums.add(num); continue; }
        toAdd.push({ customer_id: num, name: cleanName(e.name) || `Customer ${num}`, services: [...e.services] });
    }

    /* Protected = monitored OR already labeled fire/alarm/access — never removed. */
    const isProtected = c => c.monitoring_enabled || (Array.isArray(c.services) && c.services.length > 0);
    const auditNums = new Set(auditMap.keys());
    const toRemove = existing.filter(c => {
        if (isProtected(c)) return false;
        const num = c.customer_number || custNum(c.customer_id) || custNum(c.name);
        return !num || !auditNums.has(num);
    });

    const preview = {
        sheets_used:     sheetsUsed,
        audit_count:     auditMap.size,
        to_add:          toAdd.map(a => `${a.customer_id} — ${a.name}${a.services.length ? ` [${a.services.join(', ')}]` : ''}`),
        matched_count:   matchedNums.size,
        to_remove:       toRemove.map(c => ({ id: c.id, name: c.name, customer_id: c.customer_id })),
        protected_count: existing.filter(isProtected).length,
    };
    if (!commit) return res.json({ committed: false, ...preview });

    const uniqueCid = (cid) => { let out = cid, i = 2; while (taken.has(out)) out = `${cid}-${i++}`; taken.add(out); return out; };
    let added = 0, removed = 0;
    for (const a of toAdd) {
        await pool.query(
            'INSERT INTO clients (name, customer_id, customer_number, vendor, services, monitoring_enabled) VALUES ($1, $2, $3, $4, $5, FALSE)',
            [a.name, uniqueCid(a.customer_id), a.customer_id, 'generic', a.services]
        ).then(() => { added++; }).catch(e => console.error('audit add failed:', a.customer_id, e.message));
    }
    for (const c of toRemove) {
        await pool.query('DELETE FROM clients WHERE id = $1', [c.id])
            .then(() => { removed++; }).catch(e => console.error('audit remove failed:', c.id, e.message));
    }
    res.json({ committed: true, ...preview, added, removed });
});

/* POST /api/clients/prune-inactive  { commit?, path? } — remove clients whose
   invoice folder hasn't been modified in 3 years. Dry-run by default. Monitored
   and typed (fire/alarm/access) clients are always protected. */
router.post('/prune-inactive', requireRole('admin'), async (req, res) => {
    const commit = req.body.commit === true;
    const root   = (req.body.path || process.env.CLIENTS_DRIVE_ROOT || '/mnt/sitemaps/Invoices/Invoices - Customers').trim();
    const fourDigit = s => { const m = String(s || '').match(/(?<!\d)\d{4}(?!\d)/); return m ? m[0] : null; };

    let folders;
    try {
        const entries = await fs.promises.readdir(root, { withFileTypes: true });
        folders = entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch (e) {
        return res.status(502).json({ error: `Cannot read the clients folder at ${root} (${e.code || e.message}).`, root });
    }
    const folderByNum = new Map();
    for (const f of folders) { const n = fourDigit(f); if (n && !folderByNum.has(n)) folderByNum.set(n, f); }

    const existing = (await pool.query('SELECT id, name, customer_id, customer_number, monitoring_enabled, services FROM clients')).rows;
    const isProtected = c => c.monitoring_enabled || (Array.isArray(c.services) && c.services.length > 0);
    const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 3);
    const cutoffMs = cutoff.getTime();

    const toRemove = [];
    for (const c of existing) {
        if (isProtected(c)) continue;
        const num    = c.customer_number || fourDigit(c.customer_id) || fourDigit(c.name);
        const folder = num ? folderByNum.get(num) : null;
        const active = folder ? (await newestFileMtimeMs(path.join(root, folder))) >= cutoffMs : false;
        if (!active) toRemove.push(c);
    }

    const preview = {
        root,
        examined:        existing.length,
        protected_count: existing.filter(isProtected).length,
        to_remove:       toRemove.map(c => ({ id: c.id, name: c.name, customer_id: c.customer_id })),
    };
    if (!commit) return res.json({ committed: false, ...preview });

    let removed = 0;
    for (const c of toRemove) {
        await pool.query('DELETE FROM clients WHERE id = $1', [c.id])
            .then(() => { removed++; }).catch(e => console.error('prune remove failed:', c.id, e.message));
    }
    res.json({ committed: true, ...preview, removed });
});

/* GET /api/clients/:id */
router.get('/:id', authenticate, async (req, res) => {
    try {
        const client = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
        if (client.rowCount === 0) return res.status(404).json({ error: 'Client not found.' });

        const tickets = await pool.query(
            `SELECT st.*,
                    COALESCE((SELECT array_agg(x.name ORDER BY x.name)
                              FROM users x WHERE x.id = ANY(st.assignee_ids)), '{}') AS assignee_names
             FROM service_tickets st
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
        'maintenance_enabled', 'maintenance_frequency', 'maintenance_next', 'maintenance_last', 'maintenance_assignee_id',
    ];
    try {
        const sets = []; const params = [];
        const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

        for (const f of FIELDS) {
            if (f in req.body) add(f, req.body[f] ?? null);
        }

        /* Service-type reassignment (Fire / Alarm / Access Control / Monitoring)
           is admin-only. Sanitize to the known set; an empty array clears them. */
        if ('services' in req.body && req.user.role === 'admin') {
            const allowed = ['fire', 'alarm', 'access_control', 'monitoring'];
            const clean = [...new Set(
                (Array.isArray(req.body.services) ? req.body.services : [])
                    .map(s => String(s).toLowerCase().trim())
                    .filter(s => allowed.includes(s))
            )];
            add('services', clean);
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

/* Array of ids from either `assignee_ids` (array) or legacy single `assigned_to`. */
function ticketAssigneeIds(body) {
    const raw = Array.isArray(body.assignee_ids)
        ? body.assignee_ids
        : (body.assigned_to != null && body.assigned_to !== '' ? [body.assigned_to] : []);
    return [...new Set(raw.map(Number).filter(n => Number.isInteger(n) && n > 0))];
}

/* POST /api/clients/:id/tickets */
router.post('/:id/tickets', authenticate, async (req, res) => {
    const { title, description } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required.' });
    try {
        const ids     = ticketAssigneeIds(req.body);
        const primary = ids[0] || null;
        const result = await pool.query(
            `INSERT INTO service_tickets (title, description, status, created_by, assigned_to, assignee_ids, client_id)
             VALUES ($1,$2,'open',$3,$4,$5,$6) RETURNING *`,
            [title, description || null, req.user.id, primary, ids, req.params.id]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create ticket.' });
    }
});

/* PATCH /api/clients/tickets/:ticketId */
router.patch('/tickets/:ticketId', authenticate, async (req, res) => {
    const { status } = req.body;
    /* null → leave assignees unchanged */
    const ids = (Array.isArray(req.body.assignee_ids) || req.body.assigned_to !== undefined)
        ? ticketAssigneeIds(req.body) : null;
    try {
        const result = await pool.query(
            `UPDATE service_tickets SET
                status       = COALESCE($1, status),
                assignee_ids = COALESCE($2::int[], assignee_ids),
                assigned_to  = CASE WHEN $2::int[] IS NOT NULL THEN ($2::int[])[1] ELSE assigned_to END,
                updated_at   = NOW()
             WHERE id = $3 RETURNING *`,
            [status, ids, req.params.ticketId]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Ticket not found.' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update ticket.' });
    }
});

/* ═══ Per-client notes board ═════════════════════════════════════════════ */

/* GET /api/clients/:id/posts — anyone signed in can read the board. */
router.get('/:id/posts', authenticate, async (req, res) => {
    try {
        const r = await pool.query(
            'SELECT * FROM client_posts WHERE client_id = $1 ORDER BY created_at DESC LIMIT 200',
            [req.params.id]
        );
        res.json(r.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch posts.' });
    }
});

/* POST /api/clients/:id/posts — any staff member (incl. technicians) can post. */
router.post('/:id/posts', authenticate, async (req, res) => {
    const content = (req.body.content || '').trim();
    if (!content) return res.status(400).json({ error: 'content is required.' });
    try {
        const r = await pool.query(
            `INSERT INTO client_posts (client_id, content, author_id, author_name)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [req.params.id, content, req.user.id, req.user.name]
        );
        res.status(201).json(r.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create post.' });
    }
});

/* DELETE /api/clients/:id/posts/:postId — the author or an admin can remove. */
router.delete('/:id/posts/:postId', authenticate, async (req, res) => {
    try {
        const existing = await pool.query('SELECT author_id FROM client_posts WHERE id = $1 AND client_id = $2',
            [req.params.postId, req.params.id]);
        if (existing.rowCount === 0) return res.status(404).json({ error: 'Post not found.' });
        if (req.user.role !== 'admin' && existing.rows[0].author_id !== req.user.id) {
            return res.status(403).json({ error: 'You can only delete your own posts.' });
        }
        await pool.query('DELETE FROM client_posts WHERE id = $1', [req.params.postId]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete post.' });
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
