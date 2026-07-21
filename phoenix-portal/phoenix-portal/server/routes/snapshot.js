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

/* Normalize an incoming body into the column set, coercing blanks → null. */
function fields(body) {
    const t = s => { const v = (s == null ? '' : String(s)).trim(); return v === '' ? null : v; };
    const hours = body.hours === '' || body.hours == null ? null : Number(body.hours);
    const clientId = body.client_id === '' || body.client_id == null ? null : Number(body.client_id);
    return {
        customer:       t(body.customer),
        rfq:            t(body.rfq),
        hours:          Number.isFinite(hours) ? hours : null,
        scheduled_date: t(body.scheduled_date),
        invoice_num:    t(body.invoice_num),
        email_date:     t(body.email_date),
        notes:          t(body.notes),
        client_id:      Number.isFinite(clientId) ? clientId : null,
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
            `INSERT INTO snapshot_entries (type, customer, rfq, hours, scheduled_date, invoice_num, email_date, notes, client_id, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
            [type, f.customer, f.rfq, f.hours, f.scheduled_date, f.invoice_num, f.email_date, f.notes, f.client_id, req.user.id]
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
                    invoice_num = $7, email_date = $8, notes = $9, client_id = $10, updated_at = NOW()
              WHERE id = $1 RETURNING id`,
            [req.params.id, type, f.customer, f.rfq, f.hours, f.scheduled_date, f.invoice_num, f.email_date, f.notes, f.client_id]
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
