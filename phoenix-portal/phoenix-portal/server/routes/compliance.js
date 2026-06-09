const express = require('express');
const pool    = require('../db/pool');
const { authenticate } = require('../middleware/requireRole');

const router = express.Router();
router.use(authenticate);

/**
 * GET /api/compliance/renewals[?days=N]
 *
 * Unified "coming due" list aggregated from data the portal already
 * collects — no new tables. Sources:
 *   - Fire/security inspections   (clients.next_inspection)
 *   - Alarm permits               (clients.permit_expires)
 *   - Service contracts           (clients.contract_end)
 *   - Vehicle tag renewals        (vehicles.tags_renewal)
 *
 * `days_until` is whole days from today (negative = overdue). Optional
 * ?days=N caps the look-ahead window; overdue items are always included
 * because their days_until is <= N for any non-negative N. Without the
 * param, every item that has a date is returned and the client filters.
 */
router.get('/renewals', async (req, res) => {
    const days = req.query.days != null && req.query.days !== ''
        ? parseInt(req.query.days, 10)
        : null;

    try {
        const r = await pool.query(
            `
            WITH items AS (
                SELECT 'inspection'        AS category,
                       'Inspection'        AS title,
                       c.name              AS entity,
                       NULL::text          AS detail,
                       c.next_inspection   AS due_date,
                       (c.next_inspection - CURRENT_DATE) AS days_until,
                       'client'            AS link_type,
                       c.id                AS link_id
                FROM clients c
                WHERE c.next_inspection IS NOT NULL

                UNION ALL
                SELECT 'permit', 'Alarm Permit', c.name, c.permit_number,
                       c.permit_expires, (c.permit_expires - CURRENT_DATE),
                       'client', c.id
                FROM clients c
                WHERE c.permit_expires IS NOT NULL

                UNION ALL
                SELECT 'contract', 'Service Contract', c.name, c.contract_type,
                       c.contract_end, (c.contract_end - CURRENT_DATE),
                       'client', c.id
                FROM clients c
                WHERE c.contract_end IS NOT NULL

                UNION ALL
                SELECT 'vehicle_tags', 'Vehicle Tags', v.name, v.vehicle_id,
                       v.tags_renewal, (v.tags_renewal - CURRENT_DATE),
                       'vehicle', v.id
                FROM vehicles v
                WHERE v.tags_renewal IS NOT NULL
            )
            SELECT * FROM items
            ${days !== null && !Number.isNaN(days) ? 'WHERE days_until <= $1' : ''}
            ORDER BY due_date ASC
            `,
            days !== null && !Number.isNaN(days) ? [days] : []
        );
        return res.json(r.rows);
    } catch (err) {
        console.error('compliance renewals error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

module.exports = router;
