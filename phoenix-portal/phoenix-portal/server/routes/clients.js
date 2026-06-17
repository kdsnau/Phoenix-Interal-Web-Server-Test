const express = require('express');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const XLSX    = require('xlsx');
const { WebClient } = require('@slack/web-api');
const pool    = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/requireRole');
const { runMaintenanceCheck } = require('../services/monitoringScheduler');

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

/* QuickBooks "Customer" cells look like "** REP ** Acme:Job:Service".
   The real top-level customer is the rep-prefix-stripped text before the first colon. */
function topLevelCustomer(raw) {
    let s = String(raw || '').trim();
    if (!s) return null;
    s = s.replace(/^\*\*[^*]*\*\*\s*/, '');   // drop "** REP **" / "** DNS **" prefix
    s = s.replace(/^\[[^\]]*\]\s*/, '');        // drop "[DND]" bracket prefix
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

/* Dead / do-not-service accounts flagged in older QB data — excluded from Unmonitored. */
function isDeadCustomer(raw) {
    const s = String(raw || '').toLowerCase();
    if (/\*\*\s*dns\s*\*\*/.test(s)) return true;     // "** DNS **"
    if (/\[dn[ds]/.test(s)) return true;              // "[DND]" / "[DNS]" (any variant)
    if (/do not s(?:rvc|erv)/.test(s)) return true;   // "DO NOT SRVC" / "DO NOT SERVICE"
    return false;
}

/* The sub-account path after the top-level customer ("Acme:Camelview:Hosting" → "Camelview:Hosting"). */
function subAccount(raw) {
    let s = String(raw || '').trim()
        .replace(/^\*\*[^*]*\*\*\s*/, '')
        .replace(/^\[[^\]]*\]\s*/, '');
    const i = s.indexOf(':');
    return i >= 0 ? s.slice(i + 1).trim() : null;
}

/* A date cell → "YYYY-MM-DD", or null. Handles XLSX's three forms: an Excel
   serial number, a JS Date, or a literal "M/D/YY" / "MM/DD/YYYY" string. */
function qbDate(raw) {
    if (raw == null || raw === '') return null;
    if (raw instanceof Date) {
        return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, '0')}-${String(raw.getDate()).padStart(2, '0')}`;
    }
    if (typeof raw === 'number') {
        const o = XLSX.SSF.parse_date_code(raw);
        if (!o || !o.y) return null;
        return `${o.y}-${String(o.m).padStart(2, '0')}-${String(o.d).padStart(2, '0')}`;
    }
    const m = String(raw).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m) return null;
    let [, mo, d, y] = m;
    if (y.length === 2) y = '20' + y;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/* Parse a money cell — number, "1,234.56", "$1,234.56", or "(123.45)" → Number or null. */
function qbAmount(raw) {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number') return raw;
    let s = String(raw).trim();
    const neg = /^\(.*\)$/.test(s);
    s = s.replace(/[(),$\s]/g, '');
    if (s === '' || isNaN(Number(s))) return null;
    return neg ? -Number(s) : Number(s);
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

/* POST /api/clients/import-quickbooks — upload QB CSV(s).
   Invoices/payments → client_transactions for matched clients (idempotent);
   every top-level customer not in our list accumulates under Unmonitored. */
router.post('/import-quickbooks', requireRole('admin'), upload.array('files', 12), async (req, res) => {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded.' });
    try {
        const customers = new Set();   // every QB top-level customer name we saw
        const parsedTx  = [];          // { name, kind, amount, num, date, desc }
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

                if (!kind) continue;
                const amount = qbAmount(row[col['amount']]);
                if (amount == null || amount === 0) continue;
                const num = String(row[col['num']] ?? '').trim() || null;
                const sub = subAccount(raw);
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
                    amount: Math.abs(amount),
                    num,
                    date: qbDate(row[col['date']]),
                    desc: desc.slice(0, 300),
                });
            }
        }

        const existing = await pool.query('SELECT id, name FROM clients');
        const idByName = new Map(existing.rows.map(r => [(r.name || '').trim().toLowerCase(), r.id]));
        const have     = new Set(idByName.keys());

        /* ── Ledger: insert invoice/payment rows, deduped on re-run. Matched customers
              attach to a client_id; unmatched ones are stored by customer_name so they
              still appear (flagged "unmonitored") on the Financials Client Billing tab. ── */
        const existingRefs = await pool.query(
            "SELECT client_id, customer_name, type, description, date, amount FROM client_transactions WHERE source = 'quickbooks'"
        );
        const today = new Date().toISOString().slice(0, 10);
        const ymd   = d => (d instanceof Date ? d.toISOString().slice(0, 10) : d);
        /* Dedupe key. The description carries the QB doc number + sub-job + pay method,
           so distinct line items that share one check/invoice number across sub-jobs stay
           separate, while a true re-import of the same row collapses. */
        const txKey = (cid, name, kind, date, amount, desc) =>
            `${cid ? `c|${cid}` : `u|${(name || '').toLowerCase()}`}|${kind}|${ymd(date)}|${Number(amount)}|${desc}`;

        const seen = new Set(existingRefs.rows.map(r =>
            txKey(r.client_id, r.customer_name, r.type, r.date, r.amount, r.description)
        ));
        const toInsert = [];
        const matched  = new Set();
        for (const t of parsedTx) {
            const cid  = idByName.get(t.name.toLowerCase()) || null;
            const date = t.date || today;
            if (cid) matched.add(cid);
            const key = txKey(cid, t.name, t.kind, date, t.amount, t.desc);
            if (seen.has(key)) continue;
            seen.add(key);
            toInsert.push([cid, cid ? null : t.name, t.desc, t.amount, t.kind, date, req.user.id, 'quickbooks', t.num]);
        }
        for (let i = 0; i < toInsert.length; i += 500) {
            const chunk = toInsert.slice(i, i + 500);
            const ph = chunk.map((_, j) => {
                const b = j * 9;
                return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`;
            }).join(',');
            await pool.query(
                `INSERT INTO client_transactions
                    (client_id, customer_name, description, amount, type, date, created_by, source, ref_num)
                 VALUES ${ph}`,
                chunk.flat()
            );
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

    const existing = (await pool.query('SELECT id, name, customer_id, monitoring_enabled, services FROM clients')).rows;
    const existingByNum = new Map();
    for (const c of existing) { const n = fourDigit(c.customer_id) || fourDigit(c.name); if (n && !existingByNum.has(n)) existingByNum.set(n, c); }
    const taken = new Set(existing.map(c => c.customer_id));

    /* Only ADD customers whose folder has an invoice (file) modified within 3 years. */
    const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 3);
    const cutoffMs = cutoff.getTime();
    async function newestMtimeMs(dir, depth = 0) {
        let newest = 0, entries;
        try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return 0; }
        try { newest = (await fs.promises.stat(dir)).mtimeMs; } catch { /* ignore */ }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (depth < 2) { const m = await newestMtimeMs(full, depth + 1); if (m > newest) newest = m; }
            } else {
                try { const st = await fs.promises.stat(full); if (st.mtimeMs > newest) newest = st.mtimeMs; } catch { /* ignore */ }
            }
        }
        return newest;
    }

    const toAdd = [], matchedNums = new Set(), folderNums = new Set();
    let skippedNoNumber = 0, skippedInactive = 0;
    for (const f of folders) {
        const num = fourDigit(f);
        if (!num) { skippedNoNumber++; continue; }       /* deprecated — no 4-digit number */
        folderNums.add(num);
        if (existingByNum.has(num)) { matchedNums.add(num); continue; }   /* already a client */
        const newest = await newestMtimeMs(path.join(root, f));
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
        const num = fourDigit(c.customer_id) || fourDigit(c.name);
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
            'INSERT INTO clients (name, customer_id, vendor, services, monitoring_enabled) VALUES ($1, $2, $3, $4, FALSE)',
            [a.name, uniqueCid(a.customer_id), 'generic', []]
        ).then(() => { added++; }).catch(e => console.error('rebuild add failed:', a.folder, e.message));
    }
    for (const c of toRemove) {
        await pool.query('DELETE FROM clients WHERE id = $1', [c.id])
            .then(() => { removed++; }).catch(e => console.error('rebuild remove failed:', c.id, e.message));
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
    async function newestMtimeMs(dir, depth = 0) {
        let newest = 0, entries;
        try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return 0; }
        try { newest = (await fs.promises.stat(dir)).mtimeMs; } catch { /* ignore */ }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { if (depth < 2) { const m = await newestMtimeMs(full, depth + 1); if (m > newest) newest = m; } }
            else { try { const st = await fs.promises.stat(full); if (st.mtimeMs > newest) newest = st.mtimeMs; } catch { /* ignore */ } }
        }
        return newest;
    }

    let folders;
    try {
        const entries = await fs.promises.readdir(root, { withFileTypes: true });
        folders = entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch (e) {
        return res.status(502).json({ error: `Cannot read the clients folder at ${root} (${e.code || e.message}).`, root });
    }
    const folderByNum = new Map();
    for (const f of folders) { const n = fourDigit(f); if (n && !folderByNum.has(n)) folderByNum.set(n, f); }

    const existing = (await pool.query('SELECT id, name, customer_id, monitoring_enabled, services FROM clients')).rows;
    const isProtected = c => c.monitoring_enabled || (Array.isArray(c.services) && c.services.length > 0);
    const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 3);
    const cutoffMs = cutoff.getTime();

    const toRemove = [];
    for (const c of existing) {
        if (isProtected(c)) continue;
        const num    = fourDigit(c.customer_id) || fourDigit(c.name);
        const folder = num ? folderByNum.get(num) : null;
        const active = folder ? (await newestMtimeMs(path.join(root, folder))) >= cutoffMs : false;
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
