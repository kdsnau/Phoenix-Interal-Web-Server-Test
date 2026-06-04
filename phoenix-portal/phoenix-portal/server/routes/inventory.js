const express = require('express');
const pool    = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/requireRole');

const router = express.Router();

/* ── Schema migration ─────────────────────────────────────────────────── */
pool.query(`
    CREATE TABLE IF NOT EXISTS vehicle_inventory (
        id                SERIAL PRIMARY KEY,
        vehicle_id        INTEGER NOT NULL REFERENCES vehicles(id)        ON DELETE CASCADE,
        inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
        quantity          INTEGER NOT NULL DEFAULT 1,
        notes             TEXT,
        assigned_at       TIMESTAMP DEFAULT NOW(),
        UNIQUE(vehicle_id, inventory_item_id)
    )
`).catch(() => {});

/* ── GET /api/inventory — list items (includes vehicle_count) ─────────── */
router.get('/', authenticate, async (req, res) => {
    const { category, search } = req.query;
    const conditions = [];
    const params     = [];

    if (category) { params.push(category);      conditions.push(`ii.category = $${params.length}`); }
    if (search)   { params.push(`%${search}%`); conditions.push(`(ii.name ILIKE $${params.length} OR ii.sku ILIKE $${params.length})`); }

    const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    try {
        const result = await pool.query(
            `SELECT ii.*,
                    COUNT(vi.id)::int AS vehicle_count
             FROM inventory_items ii
             LEFT JOIN vehicle_inventory vi ON vi.inventory_item_id = ii.id
             ${where}
             GROUP BY ii.id
             ORDER BY ii.category, ii.name`,
            params
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch inventory.' });
    }
});

/* ── GET /api/inventory/vehicles — vehicle list for autocomplete ─────── */
/* Must be BEFORE /:id routes */
router.get('/vehicles', authenticate, async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT id, name, make, model, year FROM vehicles ORDER BY name`
        );
        res.json(r.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch vehicles.' });
    }
});

/* ── PATCH /api/inventory/assignments/:id ─────────────────────────────── */
router.patch('/assignments/:id', authenticate, async (req, res) => {
    const { quantity, notes } = req.body;
    try {
        const r = await pool.query(
            `UPDATE vehicle_inventory
             SET quantity = COALESCE($1, quantity),
                 notes    = COALESCE($2, notes)
             WHERE id = $3
             RETURNING *`,
            [quantity ?? null, notes !== undefined ? notes : null, req.params.id]
        );
        if (r.rowCount === 0) return res.status(404).json({ error: 'Assignment not found.' });
        res.json(r.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update assignment.' });
    }
});

/* ── DELETE /api/inventory/assignments/:id ────────────────────────────── */
router.delete('/assignments/:id', requireRole('admin', 'accounting'), async (req, res) => {
    try {
        const r = await pool.query(
            'DELETE FROM vehicle_inventory WHERE id = $1 RETURNING id',
            [req.params.id]
        );
        if (r.rowCount === 0) return res.status(404).json({ error: 'Assignment not found.' });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete assignment.' });
    }
});

/* ── POST /api/inventory — create item ───────────────────────────────── */
router.post('/', requireRole('admin', 'accounting'), async (req, res) => {
    const { name, sku, category, quantity, min_threshold, unit, location, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required.' });
    try {
        const result = await pool.query(
            `INSERT INTO inventory_items (name, sku, category, quantity, min_threshold, unit, location, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [name, sku || null, category || 'equipment', quantity ?? 0,
             min_threshold ?? 0, unit || 'ea', location || null, notes || null]
        );
        res.status(201).json({ ...result.rows[0], vehicle_count: 0 });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create item.' });
    }
});

/* ── PATCH /api/inventory/:id ────────────────────────────────────────── */
router.patch('/:id', authenticate, async (req, res) => {
    const { id }   = req.params;
    const { role } = req.user;
    try {
        let result;
        if (role === 'technician') {
            const { quantity } = req.body;
            if (quantity === undefined) return res.status(400).json({ error: 'Quantity required.' });
            if (quantity < 0)           return res.status(400).json({ error: 'Quantity cannot be negative.' });
            result = await pool.query(
                'UPDATE inventory_items SET quantity = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
                [quantity, id]
            );
        } else {
            const { name, sku, category, quantity, min_threshold, unit, location, notes } = req.body;
            result = await pool.query(
                `UPDATE inventory_items SET
                    name          = COALESCE($1,  name),
                    sku           = COALESCE($2,  sku),
                    category      = COALESCE($3,  category),
                    quantity      = COALESCE($4,  quantity),
                    min_threshold = COALESCE($5,  min_threshold),
                    unit          = COALESCE($6,  unit),
                    location      = COALESCE($7,  location),
                    notes         = COALESCE($8,  notes),
                    updated_at    = NOW()
                 WHERE id = $9 RETURNING *`,
                [name, sku, category, quantity, min_threshold, unit, location, notes, id]
            );
        }
        if (result.rowCount === 0) return res.status(404).json({ error: 'Item not found.' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update item.' });
    }
});

/* ── DELETE /api/inventory/:id ───────────────────────────────────────── */
router.delete('/:id', requireRole('admin'), async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM inventory_items WHERE id = $1 RETURNING id',
            [req.params.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Item not found.' });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete item.' });
    }
});

/* ── GET /api/inventory/:id/assignments — vehicle assignments for item ── */
router.get('/:id/assignments', authenticate, async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT vi.*, v.name AS vehicle_name, v.make, v.model, v.year
             FROM vehicle_inventory vi
             JOIN vehicles v ON v.id = vi.vehicle_id
             WHERE vi.inventory_item_id = $1
             ORDER BY v.name`,
            [req.params.id]
        );
        res.json(r.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch assignments.' });
    }
});

/* ── POST /api/inventory/:id/assign — assign item to a vehicle ───────── */
router.post('/:id/assign', authenticate, async (req, res) => {
    const { vehicle_id, quantity, notes } = req.body;
    if (!vehicle_id) return res.status(400).json({ error: 'vehicle_id is required.' });
    try {
        const r = await pool.query(
            `INSERT INTO vehicle_inventory (vehicle_id, inventory_item_id, quantity, notes)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (vehicle_id, inventory_item_id)
             DO UPDATE SET quantity = EXCLUDED.quantity,
                           notes    = COALESCE(EXCLUDED.notes, vehicle_inventory.notes)
             RETURNING *`,
            [vehicle_id, req.params.id, quantity ?? 1, notes ?? null]
        );
        /* Return with vehicle name */
        const full = await pool.query(
            `SELECT vi.*, v.name AS vehicle_name, v.make, v.model, v.year
             FROM vehicle_inventory vi
             JOIN vehicles v ON v.id = vi.vehicle_id
             WHERE vi.id = $1`,
            [r.rows[0].id]
        );
        res.status(201).json(full.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to assign item.' });
    }
});

module.exports = router;
