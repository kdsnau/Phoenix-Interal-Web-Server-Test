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

/* Normalize an incoming body into the column set, coercing blanks → null. */
function fields(body) {
    const t = s => { const v = (s == null ? '' : String(s)).trim(); return v === '' ? null : v; };
    const hours = body.hours === '' || body.hours == null ? null : Number(body.hours);
    return {
        customer:       t(body.customer),
        rfq:            t(body.rfq),
        hours:          Number.isFinite(hours) ? hours : null,
        scheduled_date: t(body.scheduled_date),
        invoice_num:    t(body.invoice_num),
        email_date:     t(body.email_date),
        notes:          t(body.notes),
    };
}

/* GET /api/snapshot — all entries, newest first within each type. */
router.get('/', requireRole('accounting', 'admin'), async (_req, res) => {
    try {
        const r = await pool.query('SELECT * FROM snapshot_entries ORDER BY created_at DESC');
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
        const r = await pool.query(
            `INSERT INTO snapshot_entries (type, customer, rfq, hours, scheduled_date, invoice_num, email_date, notes, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [type, f.customer, f.rfq, f.hours, f.scheduled_date, f.invoice_num, f.email_date, f.notes, req.user.id]
        );
        res.status(201).json(r.rows[0]);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to create entry.' }); }
});

/* PATCH /api/snapshot/:id — edit fields and/or move between types. */
router.patch('/:id', requireRole('accounting', 'admin'), async (req, res) => {
    const f = fields(req.body);
    const type = req.body.type != null ? String(req.body.type).trim() : null;
    if (type != null && !TYPES.includes(type)) return res.status(400).json({ error: 'Invalid type.' });
    try {
        const r = await pool.query(
            `UPDATE snapshot_entries
                SET type = COALESCE($2, type),
                    customer = $3, rfq = $4, hours = $5, scheduled_date = $6,
                    invoice_num = $7, email_date = $8, notes = $9, updated_at = NOW()
              WHERE id = $1 RETURNING *`,
            [req.params.id, type, f.customer, f.rfq, f.hours, f.scheduled_date, f.invoice_num, f.email_date, f.notes]
        );
        if (r.rowCount === 0) return res.status(404).json({ error: 'Entry not found.' });
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
