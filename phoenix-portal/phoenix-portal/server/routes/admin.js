const express  = require('express');
const pool     = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/requireRole');

const router = express.Router();

/* Lets specific non-technicians (e.g. an admin who also works in the field) be
   assigned to tickets. Technicians are always assignable regardless of the flag. */
pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS assignable BOOLEAN NOT NULL DEFAULT FALSE`).catch(() => {});

/* GET /api/admin/technicians — users who can be assigned to tickets:
   all technicians, plus anyone explicitly flagged assignable (e.g. a field admin). */
router.get('/technicians', requireRole('technician', 'admin'), async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, name FROM users WHERE role = 'technician' OR assignable = TRUE ORDER BY name ASC"
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
            'SELECT id, name, email, role, assignable, created_at FROM users ORDER BY created_at DESC'
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

/* PATCH /api/admin/users/:id/assignable — allow/disallow ticket assignment */
router.patch('/users/:id/assignable', requireRole('admin'), async (req, res) => {
    const assignable = !!req.body.assignable;
    try {
        const result = await pool.query(
            'UPDATE users SET assignable = $1 WHERE id = $2 RETURNING id, assignable',
            [assignable, req.params.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'User not found.' });
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

/* GET /api/admin/alerts — dashboard alerts for all roles */
router.get('/alerts', authenticate, async (req, res) => {
    try {
        /* Technicians only see vehicle alerts for the vehicle they're assigned to
           (vehicles.driver_id). Admin / accounting / everyone else see all. */
        const tech    = req.user.role === 'technician';
        const vFilter = tech ? 'AND v.driver_id = $1'    : '';
        const tFilter = tech ? 'AND driver_id = $1'      : '';
        const vParams = tech ? [req.user.id]             : [];

        const [vehicleIssues, permitsExpiring, tagsExpiring, mrrRow, openTickets] = await Promise.all([
            pool.query(`
                SELECT v.id, v.name, v.vehicle_id, v.make, v.model, COUNT(vn.id)::int AS open_issues
                FROM vehicles v
                JOIN vehicle_notes vn ON vn.vehicle_id = v.id AND vn.resolved = FALSE
                WHERE TRUE ${vFilter}
                GROUP BY v.id, v.name, v.vehicle_id, v.make, v.model
                ORDER BY open_issues DESC
            `, vParams).catch(() => ({ rows: [] })),
            pool.query(`
                SELECT id, name, customer_id, permit_number, permit_expires,
                       (permit_expires::date - CURRENT_DATE)::int AS days_until
                FROM clients
                WHERE permit_expires IS NOT NULL
                  AND permit_expires::date <= CURRENT_DATE + INTERVAL '60 days'
                ORDER BY permit_expires ASC
            `).catch(() => ({ rows: [] })),
            pool.query(`
                SELECT id, name, vehicle_id, tags_renewal,
                       (tags_renewal::date - CURRENT_DATE)::int AS days_until
                FROM vehicles
                WHERE tags_renewal IS NOT NULL
                  AND tags_renewal::date <= CURRENT_DATE + INTERVAL '30 days'
                  ${tFilter}
                ORDER BY tags_renewal ASC
            `, vParams).catch(() => ({ rows: [] })),
            pool.query(`
                SELECT COALESCE(SUM(
                    billing_amount / CASE COALESCE(billing_frequency, 'monthly')
                        WHEN 'quarterly' THEN 3.0 WHEN 'yearly' THEN 12.0 ELSE 1.0 END
                ), 0) AS mrr
                FROM clients WHERE billing_amount IS NOT NULL AND billing_amount > 0
            `).catch(() => ({ rows: [{ mrr: 0 }] })),
            pool.query(`
                SELECT COUNT(*)::int AS count FROM service_tickets
                WHERE status NOT IN ('resolved', 'closed')
            `).catch(() => ({ rows: [{ count: 0 }] })),
        ]);
        res.json({
            vehicleIssues:   vehicleIssues.rows,
            permitsExpiring: permitsExpiring.rows,
            tagsExpiring:    tagsExpiring.rows,
            mrr:             Number(mrrRow.rows[0]?.mrr   || 0),
            openTickets:     Number(openTickets.rows[0]?.count || 0),
        });
    } catch (err) {
        console.error('Alerts error:', err.message);
        res.status(500).json({ error: 'Failed to load alerts.' });
    }
});

/* GET /api/admin/stats — dashboard stats for admin */
router.get('/stats', requireRole('admin'), async (req, res) => {
    try {
        const [users, tickets, records, payRow, fleetRow] = await Promise.all([
            pool.query('SELECT role, COUNT(*) AS count FROM users GROUP BY role'),
            pool.query('SELECT status, COUNT(*) AS count FROM service_tickets GROUP BY status'),
            pool.query(
                `SELECT
                    COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END),0) AS income,
                    COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS expenses
                 FROM financial_records`
            ),
            /* Match /financials/summary: client payments are income, fleet invoices are expenses. */
            pool.query("SELECT COALESCE(SUM(amount),0) AS pay FROM client_transactions WHERE type='payment'")
                .catch(() => ({ rows: [{ pay: 0 }] })),
            pool.query("SELECT COALESCE(SUM(amount),0) AS fleet FROM vehicle_invoices")
                .catch(() => ({ rows: [{ fleet: 0 }] })),
        ]);
        return res.json({
            users:   users.rows,
            tickets: tickets.rows,
            finance: {
                total_income:   Number(records.rows[0].income)   + Number(payRow.rows[0].pay),
                total_expenses: Number(records.rows[0].expenses) + Number(fleetRow.rows[0].fleet),
            },
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

module.exports = router;
