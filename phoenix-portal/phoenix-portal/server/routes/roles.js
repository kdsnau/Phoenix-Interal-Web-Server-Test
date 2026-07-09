const express = require('express');
const pool    = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/requireRole');

const router = express.Router();

/* Custom, colored job titles ("Tech 1", "Lead", …) — a labeling layer separate
   from the permission role (admin/accounting/technician), reassignable per user. */
pool.query(`
    CREATE TABLE IF NOT EXISTS job_roles (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE,
        color      TEXT NOT NULL DEFAULT '#6b7280',
        created_at TIMESTAMP DEFAULT NOW()
    )
`).catch(() => {});
pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS job_role_id INTEGER REFERENCES job_roles(id) ON DELETE SET NULL`).catch(() => {});

const normColor = c => {
    const s = String(c || '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : '#6b7280';
};

/* GET /api/roles — list titles (any signed-in user; used for pickers + badges). */
router.get('/', authenticate, async (_req, res) => {
    try {
        const r = await pool.query('SELECT id, name, color FROM job_roles ORDER BY name');
        res.json(r.rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to load roles.' }); }
});

/* GET /api/roles/people — everyone with their assigned title (attendee pickers). */
router.get('/people', authenticate, async (_req, res) => {
    try {
        const r = await pool.query(`
            SELECT u.id, u.name, u.role,
                   u.job_role_id, jr.name AS job_role_name, jr.color AS job_role_color
            FROM users u LEFT JOIN job_roles jr ON jr.id = u.job_role_id
            ORDER BY u.name`);
        res.json(r.rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to load people.' }); }
});

/* POST /api/roles { name, color } — admin creates a title. */
router.post('/', requireRole('admin'), async (req, res) => {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required.' });
    try {
        const r = await pool.query(
            'INSERT INTO job_roles (name, color) VALUES ($1, $2) RETURNING id, name, color',
            [name, normColor(req.body.color)]);
        res.status(201).json(r.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'A title with that name already exists.' });
        console.error(err); res.status(500).json({ error: 'Failed to create role.' });
    }
});

/* PATCH /api/roles/:id { name?, color? } — admin. */
router.patch('/:id', requireRole('admin'), async (req, res) => {
    const sets = [], params = [];
    const add = (c, v) => { params.push(v); sets.push(`${c} = $${params.length}`); };
    if ('name' in req.body) { const n = (req.body.name || '').trim(); if (!n) return res.status(400).json({ error: 'Name cannot be empty.' }); add('name', n); }
    if ('color' in req.body) add('color', normColor(req.body.color));
    if (!sets.length) return res.json({ message: 'Nothing to update.' });
    params.push(req.params.id);
    try {
        const r = await pool.query(`UPDATE job_roles SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id, name, color`, params);
        if (!r.rowCount) return res.status(404).json({ error: 'Role not found.' });
        res.json(r.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'A title with that name already exists.' });
        console.error(err); res.status(500).json({ error: 'Failed to update role.' });
    }
});

/* DELETE /api/roles/:id — admin (assigned users just lose the title via SET NULL). */
router.delete('/:id', requireRole('admin'), async (req, res) => {
    try {
        const r = await pool.query('DELETE FROM job_roles WHERE id = $1 RETURNING id', [req.params.id]);
        if (!r.rowCount) return res.status(404).json({ error: 'Role not found.' });
        res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to delete role.' }); }
});

/* PUT /api/roles/assign { user_id, job_role_id } — admin assigns/reassigns (null clears). */
router.put('/assign', requireRole('admin'), async (req, res) => {
    const userId    = Number(req.body.user_id);
    const jobRoleId = req.body.job_role_id == null || req.body.job_role_id === '' ? null : Number(req.body.job_role_id);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: 'user_id is required.' });
    try {
        const r = await pool.query('UPDATE users SET job_role_id = $1 WHERE id = $2 RETURNING id, job_role_id', [jobRoleId, userId]);
        if (!r.rowCount) return res.status(404).json({ error: 'User not found.' });
        res.json(r.rows[0]);
    } catch (err) {
        if (err.code === '23503') return res.status(400).json({ error: 'That role does not exist.' });
        console.error(err); res.status(500).json({ error: 'Failed to assign role.' });
    }
});

module.exports = router;
