const express = require('express');
const pool    = require('../db/pool');
const { authenticate } = require('../middleware/requireRole');

const router = express.Router();

const SEV_RANK = { overdue: 0, soon: 1, info: 2 };

/* GET /api/reminders — actionable items tailored to the signed-in user's role.
   - technicians: their assigned tickets + any past their departure time
   - accounting:  contract / permit / inspection / maintenance renewals + billing gaps
   - admin:       all overdue tickets + all of the above                          */
router.get('/', authenticate, async (req, res) => {
    const { role, id: uid } = req.user;
    const isAdmin = role === 'admin';
    const isTech  = role === 'technician';
    const isAcct  = role === 'accounting';
    const out = [];

    try {
        /* ── Driver: weekly vehicle report due (any user assigned to a vehicle) ── */
        {
            const r = await pool.query(
                `SELECT v.id, v.name,
                        (SELECT MAX(created_at) FROM vehicle_reports
                         WHERE vehicle_id = v.id AND user_id = $1) AS last_report
                 FROM vehicles v WHERE v.driver_id = $1 ORDER BY v.id ASC LIMIT 1`,
                [uid]
            ).catch(() => ({ rows: [] }));
            if (r.rows.length) {
                const v    = r.rows[0];
                const last = v.last_report ? new Date(v.last_report) : null;
                const days = last ? Math.floor((Date.now() - last.getTime()) / 86400000) : null;
                if (days === null || days >= 7) {
                    out.push({
                        severity: (days === null || days >= 10) ? 'overdue' : 'soon',
                        category: 'Vehicle report',
                        title:    v.name,
                        detail:   last ? `Weekly report last filed ${days}d ago` : 'No weekly report filed yet',
                        date:     null, link: '/',
                    });
                }
            }
        }

        /* ── Tickets past their departure time, not completed ── */
        if (isAdmin || isTech) {
            const params = [];
            let where = `event_end IS NOT NULL AND event_end < NOW() AND status NOT IN ('resolved','closed')`;
            if (isTech) { params.push(uid); where += ` AND $1 = ANY(assignee_ids)`; }
            const r = await pool.query(
                `SELECT id, title, event_end FROM service_tickets WHERE ${where} ORDER BY event_end ASC LIMIT 50`,
                params
            ).catch(() => ({ rows: [] }));
            for (const t of r.rows) out.push({
                severity: 'overdue', category: 'Ticket', title: t.title,
                detail: 'Past departure — not marked complete', date: t.event_end, link: '/tickets',
            });
        }

        /* ── Technician: my active assigned tickets (the not-yet-overdue ones) ── */
        if (isTech) {
            const r = await pool.query(
                `SELECT id, title, status, event_start FROM service_tickets
                 WHERE $1 = ANY(assignee_ids) AND status NOT IN ('resolved','closed')
                   AND (event_end IS NULL OR event_end >= NOW())
                 ORDER BY event_start ASC NULLS LAST LIMIT 50`,
                [uid]
            ).catch(() => ({ rows: [] }));
            for (const t of r.rows) out.push({
                severity: 'info', category: 'Assigned ticket', title: t.title,
                detail: String(t.status).replace('_', ' '), date: t.event_start, link: '/tickets',
            });
        }

        /* ── Accounting + admin: client renewals & billing gaps ── */
        if (isAdmin || isAcct) {
            const soon = `CURRENT_DATE + INTERVAL '30 days'`;
            const [contracts, permits, inspections, maint] = await Promise.all([
                pool.query(`SELECT name, (contract_end::date  - CURRENT_DATE)::int AS days, contract_end  AS d FROM clients WHERE contract_end  IS NOT NULL AND contract_end  <= ${soon} ORDER BY contract_end  ASC LIMIT 50`).catch(() => ({ rows: [] })),
                pool.query(`SELECT name, (permit_expires::date - CURRENT_DATE)::int AS days, permit_expires AS d FROM clients WHERE permit_expires IS NOT NULL AND permit_expires <= ${soon} ORDER BY permit_expires ASC LIMIT 50`).catch(() => ({ rows: [] })),
                pool.query(`SELECT name, (next_inspection::date - CURRENT_DATE)::int AS days, next_inspection AS d FROM clients WHERE next_inspection IS NOT NULL AND next_inspection <= ${soon} ORDER BY next_inspection ASC LIMIT 50`).catch(() => ({ rows: [] })),
                pool.query(`SELECT name, (maintenance_next::date - CURRENT_DATE)::int AS days, maintenance_next AS d FROM clients WHERE maintenance_enabled = TRUE AND maintenance_next IS NOT NULL AND maintenance_next <= CURRENT_DATE + INTERVAL '14 days' ORDER BY maintenance_next ASC LIMIT 50`).catch(() => ({ rows: [] })),
            ]);

            const dateRem = (rows, category, verb) => {
                for (const c of rows) {
                    const d = Number(c.days);
                    out.push({
                        severity: d < 0 ? 'overdue' : 'soon',
                        category, title: c.name,
                        detail: d < 0 ? `${verb} ${Math.abs(d)}d ago` : (d === 0 ? `${verb} today` : `${verb} in ${d}d`),
                        date: c.d, link: '/clients',
                    });
                }
            };
            dateRem(contracts.rows,   'Contract',    'Ends');
            dateRem(permits.rows,     'Permit',      'Expires');
            dateRem(inspections.rows, 'Inspection',  'Due');
            dateRem(maint.rows,       'Maintenance', 'Due');
        }

        out.sort((a, b) =>
            (SEV_RANK[a.severity] - SEV_RANK[b.severity]) ||
            (new Date(a.date || '2999-01-01') - new Date(b.date || '2999-01-01'))
        );

        res.json({
            reminders: out,
            counts: {
                overdue: out.filter(r => r.severity === 'overdue').length,
                soon:    out.filter(r => r.severity === 'soon').length,
                info:    out.filter(r => r.severity === 'info').length,
            },
        });
    } catch (err) {
        console.error('reminders error:', err.message);
        res.status(500).json({ error: 'Failed to load reminders.' });
    }
});

module.exports = router;
