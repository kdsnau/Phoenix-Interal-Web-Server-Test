const express = require('express');
const pool    = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/requireRole');

const router = express.Router();

/* GET /api/inventory — all roles; optional ?category= ?search= */
router.get('/', authenticate, async (req, res) => {
    const { category, search } = req.query;
    const conditions = [];
    const params     = [];

    if (category) { params.push(category);          conditions.push(`category = $${params.length}`); }
    if (search)   { params.push(`%${search}%`);     conditions.push(`(name ILIKE $${params.length} OR sku ILIKE $${params.length})`); }

    const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    try {
        const result = await pool.query(`SELECT * FROM inventory_items${where} ORDER BY category, name`, params);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch inventory.' });
    }
});

/* POST /api/inventory — admin/accounting only */
router.post('/', requireRole('admin', 'accounting'), async (req, res) => {
    const { name, sku, category, quantity, min_threshold, unit, location, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required.' });
    try {
        const result = await pool.query(
            `INSERT INTO inventory_items (name, sku, category, quantity, min_threshold, unit, location, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [name, sku || null, category || 'equipment', quantity ?? 0, min_threshold ?? 0, unit || 'ea', location || null, notes || null]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create item.' });
    }
});

/* PATCH /api/inventory/:id — all roles (technician: qty only; admin/accounting: full) */
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

/* DELETE /api/inventory/:id — admin only */
router.delete('/:id', requireRole('admin'), async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM inventory_items WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Item not found.' });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete item.' });
    }
});

module.exports = router;
