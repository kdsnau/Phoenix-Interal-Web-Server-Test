const express  = require('express');
const pool     = require('../db/pool');
const { requireRole } = require('../middleware/requireRole');

const router = express.Router();

/* GET /api/admin/technicians — list technicians for ticket assignment (technician + admin access) */
router.get('/technicians', requireRole('technician', 'admin'), async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, name FROM users WHERE role = 'technician' ORDER BY name ASC"
        );
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

/* GET /api/admin/users — list all users */
router.get('/users', requireRole('admin'), async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC'
        );
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

/* PATCH /api/admin/users/:id/role — change a user's role */
router.patch('/users/:id/role', requireRole('admin'), async (req, res) => {
    const { role } = req.body;
    const validRoles = ['technician', 'accounting', 'admin'];

    if (!validRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid role.' });
    }

    try {
        const result = await pool.query(
            'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, name, email, role',
            [role, req.params.id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }
        return res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

/* DELETE /api/admin/users/:id — remove a user */
router.delete('/users/:id', requireRole('admin'), async (req, res) => {
    if (Number(req.params.id) === req.user.id) {
        return res.status(400).json({ error: 'Cannot delete your own account.' });
    }
    try {
        const result = await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }
        return res.json({ message: 'User deleted.' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

/* GET /api/admin/stats — dashboard stats for admin */
router.get('/stats', requireRole('admin'), async (req, res) => {
    try {
        const [users, tickets, finance] = await Promise.all([
            pool.query('SELECT role, COUNT(*) AS count FROM users GROUP BY role'),
            pool.query('SELECT status, COUNT(*) AS count FROM service_tickets GROUP BY status'),
            pool.query(
                `SELECT
                    COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END),0) AS total_income,
                    COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS total_expenses
                 FROM financial_records`
            ),
        ]);
        return res.json({
            users:    users.rows,
            tickets:  tickets.rows,
            finance:  finance.rows[0],
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

module.exports = router;
