const express = require('express');
const pool    = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/requireRole');

const router = express.Router();

pool.query(`
    CREATE TABLE IF NOT EXISTS licenses (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL,
        vendor      TEXT,
        license_key TEXT,
        seats_total INTEGER,               -- NULL = no cap (plain running counter)
        seats_used  INTEGER NOT NULL DEFAULT 0,
        category    TEXT,
        expires_at  DATE,
        notes       TEXT,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
    )
`).catch(() => {});

const clampUsed = n => Math.max(0, Math.round(Number(n) || 0));
const parseTotal = v => (v === '' || v == null) ? null : Math.max(0, parseInt(v, 10) || 0);

/* Shape a row for the client. The license_key is only returned to admins. */
function shape(row, isAdmin) {
    const total = row.seats_total == null ? null : Number(row.seats_total);
    const used  = Number(row.seats_used) || 0;
    return {
        id: row.id, name: row.name, vendor: row.vendor,
        seats_total: total, seats_used: used,
        available: total == null ? null : total - used,
        over: total != null && used > total,
        category: row.category, expires_at: row.expires_at, notes: row.notes,
        has_key: !!row.license_key,
        license_key: isAdmin ? (row.license_key || '') : undefined,
        updated_at: row.updated_at,
    };
}

/* GET /api/licenses — anyone signed in (keys hidden from non-admins). */
router.get('/', authenticate, async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM licenses ORDER BY name');
        const isAdmin = req.user.role === 'admin';
        res.json(r.rows.map(x => shape(x, isAdmin)));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to load licenses.' }); }
});

/* POST /api/licenses [admin] */
router.post('/', requireRole('admin'), async (req, res) => {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required.' });
    try {
        const r = await pool.query(
            `INSERT INTO licenses (name, vendor, license_key, seats_total, seats_used, category, expires_at, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [name, req.body.vendor || null, req.body.license_key || null, parseTotal(req.body.seats_total),
             clampUsed(req.body.seats_used), req.body.category || null, req.body.expires_at || null, req.body.notes || null]
        );
        res.status(201).json(shape(r.rows[0], true));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to create license.' }); }
});

/* PATCH /api/licenses/:id [admin] */
router.patch('/:id', requireRole('admin'), async (req, res) => {
    const sets = [], params = [];
    const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    for (const f of ['name', 'vendor', 'license_key', 'category', 'notes']) {
        if (f in req.body) add(f, req.body[f] === '' ? null : req.body[f]);
    }
    if ('seats_total' in req.body) add('seats_total', parseTotal(req.body.seats_total));
    if ('seats_used'  in req.body) add('seats_used', clampUsed(req.body.seats_used));
    if ('expires_at'  in req.body) add('expires_at', req.body.expires_at || null);
    if (!sets.length) return res.json({ message: 'Nothing to update.' });
    add('updated_at', new Date());
    params.push(req.params.id);
    try {
        const r = await pool.query(`UPDATE licenses SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
        if (!r.rowCount) return res.status(404).json({ error: 'License not found.' });
        res.json(shape(r.rows[0], true));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to update license.' }); }
});

/* POST /api/licenses/:id/usage  { delta } | { used } [admin] — bump the counter. */
router.post('/:id/usage', requireRole('admin'), async (req, res) => {
    try {
        let q, p;
        if (req.body.used != null) {
            q = 'UPDATE licenses SET seats_used = $1, updated_at = NOW() WHERE id = $2 RETURNING *';
            p = [clampUsed(req.body.used), req.params.id];
        } else {
            q = 'UPDATE licenses SET seats_used = GREATEST(0, seats_used + $1), updated_at = NOW() WHERE id = $2 RETURNING *';
            p = [Math.round(Number(req.body.delta) || 0), req.params.id];
        }
        const r = await pool.query(q, p);
        if (!r.rowCount) return res.status(404).json({ error: 'License not found.' });
        res.json(shape(r.rows[0], true));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to update usage.' }); }
});

/* DELETE /api/licenses/:id [admin] */
router.delete('/:id', requireRole('admin'), async (req, res) => {
    try {
        const r = await pool.query('DELETE FROM licenses WHERE id = $1 RETURNING id', [req.params.id]);
        if (!r.rowCount) return res.status(404).json({ error: 'License not found.' });
        res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to delete license.' }); }
});

module.exports = router;
