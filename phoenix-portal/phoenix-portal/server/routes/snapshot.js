const express = require('express');
const pool    = require('../db/pool');
const { requireRole } = require('../middleware/requireRole');

const router = express.Router();

const TYPES = ['in_progress', 'complete', 'deadbeat'];

/* Snapshot entries — the "Daily Update" board. In-progress projects track hours
   and a scheduled date (free text so it accepts "TBD"); complete/deadbeat track
   the invoice # and email date (also free text — values like "???" appear). */
pool.query(`
    CREATE TABLE IF NOT EXISTS snapshot_entries (
        id             SERIAL PRIMARY KEY,
        type           TEXT    NOT NULL,
        customer       TEXT    NOT NULL,
        rfq            TEXT,
        hours          NUMERIC,
        scheduled_date TEXT,
        invoice_num    TEXT,
        email_date     TEXT,
        notes          TEXT,
        created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at     TIMESTAMP DEFAULT NOW(),
        updated_at     TIMESTAMP DEFAULT NOW()
    )
`).catch(err => console.error('snapshot_entries init:', err.message));
/* Optional link to a client so an RFQ shows on that client's Financials page. */
pool.query('ALTER TABLE snapshot_entries ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL').catch(() => {});
/* Estimate/RFQ document fields (match the "Estimate" PDF): header meta, the
   billing/project blocks, a title/subtitle, and line items stored as JSON
   ({ item, description, rate, qty }). Lets an RFQ render + print as an estimate. */
pool.query(`ALTER TABLE snapshot_entries
    ADD COLUMN IF NOT EXISTS estimate_date    DATE,
    ADD COLUMN IF NOT EXISTS salesman         TEXT,
    ADD COLUMN IF NOT EXISTS po_number        TEXT,
    ADD COLUMN IF NOT EXISTS billing_address  TEXT,
    ADD COLUMN IF NOT EXISTS project_location TEXT,
    ADD COLUMN IF NOT EXISTS title            TEXT,
    ADD COLUMN IF NOT EXISTS subtitle         TEXT,
    ADD COLUMN IF NOT EXISTS line_items       JSONB DEFAULT '[]'::jsonb`).catch(() => {});

/* Normalize an incoming body into the column set, coercing blanks → null. */
function fields(body) {
    const t = s => { const v = (s == null ? '' : String(s)).trim(); return v === '' ? null : v; };
    const num = v => (v === '' || v == null ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
    const hours = num(body.hours);
    const clientId = num(body.client_id);
    /* Line items → [{ item, description, rate, qty }]; null means "not provided"
       (PATCH keeps the existing items) vs [] which clears them. */
    const line_items = Array.isArray(body.line_items)
        ? body.line_items.map(li => ({
            item:        String(li.item ?? '').slice(0, 160),
            description: String(li.description ?? '').slice(0, 4000),
            rate:        num(li.rate),
            qty:         num(li.qty),
        }))
        : null;
    return {
        customer:         t(body.customer),
        rfq:              t(body.rfq),
        hours,
        scheduled_date:   t(body.scheduled_date),
        invoice_num:      t(body.invoice_num),
        email_date:       t(body.email_date),
        notes:            t(body.notes),
        client_id:        clientId,
        estimate_date:    t(body.estimate_date),
        salesman:         t(body.salesman),
        po_number:        t(body.po_number),
        billing_address:  t(body.billing_address),
        project_location: t(body.project_location),
        title:            t(body.title),
        subtitle:         t(body.subtitle),
        line_items,
    };
}

const SNAP_SELECT = `
    SELECT s.*, c.name AS client_name
    FROM snapshot_entries s
    LEFT JOIN clients c ON c.id = s.client_id`;

/* GET /api/snapshot — all entries, newest first. ?client_id= filters to one. */
router.get('/', requireRole('accounting', 'admin'), async (req, res) => {
    try {
        const { client_id } = req.query;
        const r = client_id
            ? await pool.query(`${SNAP_SELECT} WHERE s.client_id = $1 ORDER BY s.created_at DESC`, [client_id])
            : await pool.query(`${SNAP_SELECT} ORDER BY s.created_at DESC`);
        res.json(r.rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to load snapshot.' }); }
});

/* POST /api/snapshot — create an entry. */
router.post('/', requireRole('accounting', 'admin'), async (req, res) => {
    const type = String(req.body.type || '').trim();
    if (!TYPES.includes(type)) return res.status(400).json({ error: 'Invalid type.' });
    const f = fields(req.body);
    if (!f.customer) return res.status(400).json({ error: 'Customer is required.' });
    try {
        const ins = await pool.query(
            `INSERT INTO snapshot_entries
                (type, customer, rfq, hours, scheduled_date, invoice_num, email_date, notes, client_id,
                 estimate_date, salesman, po_number, billing_address, project_location, title, subtitle, line_items, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,COALESCE($17::jsonb,'[]'::jsonb),$18) RETURNING id`,
            [type, f.customer, f.rfq, f.hours, f.scheduled_date, f.invoice_num, f.email_date, f.notes, f.client_id,
             f.estimate_date, f.salesman, f.po_number, f.billing_address, f.project_location, f.title, f.subtitle,
             f.line_items ? JSON.stringify(f.line_items) : null, req.user.id]
        );
        const r = await pool.query(`${SNAP_SELECT} WHERE s.id = $1`, [ins.rows[0].id]);
        res.status(201).json(r.rows[0]);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to create entry.' }); }
});

/* PATCH /api/snapshot/:id — edit fields and/or move between types. */
router.patch('/:id', requireRole('accounting', 'admin'), async (req, res) => {
    const f = fields(req.body);
    const type = req.body.type != null ? String(req.body.type).trim() : null;
    if (type != null && !TYPES.includes(type)) return res.status(400).json({ error: 'Invalid type.' });
    try {
        const upd = await pool.query(
            `UPDATE snapshot_entries
                SET type = COALESCE($2, type),
                    customer = $3, rfq = $4, hours = $5, scheduled_date = $6,
                    invoice_num = $7, email_date = $8, notes = $9, client_id = $10,
                    estimate_date = $11, salesman = $12, po_number = $13, billing_address = $14,
                    project_location = $15, title = $16, subtitle = $17,
                    line_items = COALESCE($18::jsonb, line_items), updated_at = NOW()
              WHERE id = $1 RETURNING id`,
            [req.params.id, type, f.customer, f.rfq, f.hours, f.scheduled_date, f.invoice_num, f.email_date, f.notes, f.client_id,
             f.estimate_date, f.salesman, f.po_number, f.billing_address, f.project_location, f.title, f.subtitle,
             f.line_items ? JSON.stringify(f.line_items) : null]
        );
        if (upd.rowCount === 0) return res.status(404).json({ error: 'Entry not found.' });
        const r = await pool.query(`${SNAP_SELECT} WHERE s.id = $1`, [req.params.id]);
        res.json(r.rows[0]);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to update entry.' }); }
});

/* DELETE /api/snapshot/:id */
router.delete('/:id', requireRole('accounting', 'admin'), async (req, res) => {
    try {
        const r = await pool.query('DELETE FROM snapshot_entries WHERE id = $1 RETURNING id', [req.params.id]);
        if (r.rowCount === 0) return res.status(404).json({ error: 'Entry not found.' });
        res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to delete entry.' }); }
});

module.exports = router;
