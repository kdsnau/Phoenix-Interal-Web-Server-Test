const cron             = require('node-cron');
const pool             = require('../db/pool');
const { sendTemplated } = require('../config/mailer');
const { gcalCreate }   = require('../config/gcal');

async function runMonitoringCheck() {
    try {
        const due = await pool.query(
            `SELECT c.id, c.name, c.customer_id, c.services, c.billing_amount
             FROM clients c
             JOIN client_monitoring cm ON c.id = cm.client_id
             WHERE c.monitoring_enabled = TRUE
               AND cm.next_email_at <= NOW()`
        );
        if (due.rowCount === 0) return;

        const recipients = await pool.query(
            "SELECT email FROM users WHERE role IN ('admin', 'accounting')"
        );
        const to = recipients.rows.map(r => r.email);
        if (to.length === 0) return;

        for (const client of due.rows) {
            const subject  = `Weekly Monitoring Report: ${client.name}`;
            const services = client.services || [];
            const badges   = services
                .map(s => `<span class="badge badge-green" style="margin-right:4px">${s}</span>`)
                .join('') || '—';

            await sendTemplated(to, subject, 'Weekly Monitoring Report', {
                fields: [
                    { label: 'Client',          value: client.name, hi: true },
                    { label: 'Account #',       value: client.customer_id },
                    { label: 'Services',        value: services.join(', ') || '—', rawHtml: badges },
                    { label: 'Monthly Billing', value: `$${Number(client.billing_amount || 0).toFixed(2)}`, hi: true },
                ],
            });

            await pool.query(
                `UPDATE client_monitoring
                 SET last_sent_at = NOW(), next_email_at = NOW() + INTERVAL '7 days'
                 WHERE client_id = $1`,
                [client.id]
            );
        }
    } catch (err) {
        console.error('Monitoring scheduler error:', err);
    }
}

/* Format a Date as YYYY-MM-DD in local time (avoids UTC drift on DATE columns). */
function ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* Auto-create a calendar ticket for each client whose scheduled maintenance is
   due, then advance their next-due date by the chosen interval. */
async function runMaintenanceCheck() {
    const names = [];
    try {
        const due = await pool.query(
            `SELECT id, name, customer_id, site_address, maintenance_frequency, maintenance_next, maintenance_assignee_id
             FROM clients
             WHERE maintenance_enabled = TRUE
               AND maintenance_next IS NOT NULL
               AND maintenance_next <= CURRENT_DATE`
        );
        if (due.rowCount === 0) return { created: 0, names: [] };

        const adminRow = await pool.query("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
        const creator  = adminRow.rows[0]?.id || null;
        const STEP     = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 };

        for (const c of due.rows) {
            const dueDate = c.maintenance_next;
            const ids     = c.maintenance_assignee_id ? [c.maintenance_assignee_id] : [];
            const tk = await pool.query(
                `INSERT INTO service_tickets
                    (title, description, created_by, assigned_to, assignee_ids, client_id, source, event_start, event_location, ticket_type)
                 VALUES ($1, $2, $3, $4, $5, $6, 'calendar', $7, $8, 'Maintenance')
                 RETURNING *`,
                [
                    `Scheduled Maintenance — ${c.name}`,
                    `Recurring ${c.maintenance_frequency || ''} maintenance for ${c.name} (${c.customer_id}).`,
                    creator,
                    ids[0] || null,
                    ids,
                    c.id,
                    dueDate,
                    c.site_address || null,
                ]
            );
            const ticket = tk.rows[0];

            /* Email the assigned tech(s) */
            if (ids.length > 0) {
                const techs = await pool.query('SELECT email, name FROM users WHERE id = ANY($1)', [ids]).catch(() => ({ rows: [] }));
                for (const u of techs.rows) {
                    await sendTemplated(
                        u.email,
                        `Scheduled maintenance assigned: ${c.name}`,
                        'Scheduled Maintenance Assigned',
                        {
                            intro: `Hi ${u.name}, a recurring maintenance ticket has been created and assigned to you.`,
                            fields: [
                                { label: 'Client',   value: `${c.name} (${c.customer_id})`, hi: true },
                                { label: 'Type',     value: 'Maintenance', badge: 'badge-orange' },
                                { label: 'Due',      value: ymd(new Date(dueDate)) },
                                { label: 'Location', value: c.site_address || 'N/A' },
                            ],
                        }
                    ).catch(err => console.error('Maintenance assign email failed:', err));
                }
            }

            const gid = await gcalCreate(ticket, null).catch(() => null);
            if (gid) await pool.query('UPDATE service_tickets SET google_event_id = $1 WHERE id = $2', [gid, ticket.id]);

            /* Advance next-due past today so it isn't recreated tomorrow. */
            const step  = STEP[c.maintenance_frequency] || 3;
            const next  = new Date(dueDate);
            const today = new Date(); today.setHours(0, 0, 0, 0);
            do { next.setMonth(next.getMonth() + step); } while (next <= today);

            await pool.query(
                `UPDATE clients SET maintenance_last = $1, maintenance_next = $2 WHERE id = $3`,
                [ymd(new Date(dueDate)), ymd(next), c.id]
            );
            names.push(c.name);
        }
        console.log(`Maintenance scheduler: created ${names.length} ticket(s).`);
        return { created: names.length, names };
    } catch (err) {
        console.error('Maintenance scheduler error:', err);
        return { created: names.length, names, error: err.message };
    }
}

/* Email the assigned tech(s) ~1 hour before a scheduled ticket starts.
   event_start is naive Phoenix wall-clock, so AT TIME ZONE makes the window
   comparison timezone-correct regardless of the server clock. */
async function runAppointmentReminders() {
    try {
        const due = await pool.query(
            `SELECT id, title, event_start, event_location, assignee_ids
             FROM service_tickets
             WHERE event_start IS NOT NULL
               AND reminder_sent = FALSE
               AND status NOT IN ('resolved', 'closed')
               AND assignee_ids <> '{}'
               AND (event_start AT TIME ZONE 'America/Phoenix') >  NOW()
               AND (event_start AT TIME ZONE 'America/Phoenix') <= NOW() + INTERVAL '60 minutes'`
        );
        if (due.rowCount === 0) return;

        for (const t of due.rows) {
            const techs = await pool.query('SELECT email, name FROM users WHERE id = ANY($1)', [t.assignee_ids]).catch(() => ({ rows: [] }));
            const when  = new Date(t.event_start).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
            for (const u of techs.rows) {
                await sendTemplated(
                    u.email,
                    `Reminder: "${t.title}" starts soon`,
                    'Appointment Reminder',
                    {
                        intro: `Hi ${u.name}, your scheduled ticket starts within the hour.`,
                        fields: [
                            { label: 'Title',    value: t.title, hi: true },
                            { label: 'Time',     value: when },
                            { label: 'Location', value: t.event_location || 'N/A' },
                        ],
                    }
                ).catch(err => console.error('Appointment reminder email failed:', err));
            }
            await pool.query('UPDATE service_tickets SET reminder_sent = TRUE WHERE id = $1', [t.id]);
        }
        console.log(`Appointment reminders: notified for ${due.rowCount} ticket(s).`);
    } catch (err) {
        console.error('Appointment reminder error:', err);
    }
}

/* Daily digest of renewal / billing reminders → accounting + admin. */
async function runReminderDigest() {
    try {
        const soon = `CURRENT_DATE + INTERVAL '30 days'`;
        const q = sql => pool.query(sql).catch(() => ({ rows: [] }));
        const [contracts, permits, inspections, maint, noBill, overdue] = await Promise.all([
            q(`SELECT name, (contract_end::date    - CURRENT_DATE)::int AS days FROM clients WHERE contract_end    IS NOT NULL AND contract_end    <= ${soon} ORDER BY contract_end`),
            q(`SELECT name, (permit_expires::date  - CURRENT_DATE)::int AS days FROM clients WHERE permit_expires  IS NOT NULL AND permit_expires  <= ${soon} ORDER BY permit_expires`),
            q(`SELECT name, (next_inspection::date - CURRENT_DATE)::int AS days FROM clients WHERE next_inspection IS NOT NULL AND next_inspection <= ${soon} ORDER BY next_inspection`),
            q(`SELECT name, (maintenance_next::date - CURRENT_DATE)::int AS days FROM clients WHERE maintenance_enabled = TRUE AND maintenance_next IS NOT NULL AND maintenance_next <= CURRENT_DATE + INTERVAL '14 days' ORDER BY maintenance_next`),
            q(`SELECT name FROM clients WHERE monitoring_enabled = TRUE AND (billing_amount IS NULL OR billing_amount = 0) ORDER BY name`),
            q(`SELECT title FROM service_tickets WHERE event_end IS NOT NULL AND (event_end AT TIME ZONE 'America/Phoenix') < NOW() AND status NOT IN ('resolved','closed') ORDER BY event_end`),
        ]);

        const fmtDays = d => d < 0 ? `${Math.abs(d)}d overdue` : (d === 0 ? 'today' : `in ${d}d`);
        const sections = [];
        const addSec = (heading, rows, fmt) => { if (rows.length) sections.push({ heading, items: rows.map(fmt) }); };
        addSec('Contracts ending',                   contracts.rows,   c => `${c.name} — ${fmtDays(c.days)}`);
        addSec('Permits expiring',                   permits.rows,     c => `${c.name} — ${fmtDays(c.days)}`);
        addSec('Inspections due',                    inspections.rows, c => `${c.name} — ${fmtDays(c.days)}`);
        addSec('Maintenance due',                    maint.rows,       c => `${c.name} — ${fmtDays(c.days)}`);
        addSec('Monitored but no billing amount',    noBill.rows,      c => `${c.name}`);
        addSec('Tickets past departure, not closed', overdue.rows,     t => `${t.title}`);

        if (sections.length === 0) return;   /* nothing to nag about today */

        const recips = await pool.query("SELECT email FROM users WHERE role IN ('accounting', 'admin')");
        const to = recips.rows.map(r => r.email);
        if (to.length === 0) return;

        await sendTemplated(to, 'Phoenix SecTech — Daily Reminders', 'Daily Reminders', {
            intro: `Reminders for ${new Date().toLocaleDateString('en-US', { dateStyle: 'full' })}.`,
            sections,
            note: '— Phoenix Security & Technology portal',
        }).catch(err => console.error('Reminder digest email failed:', err));
        console.log(`Reminder digest sent to ${to.length} recipient(s).`);
    } catch (err) {
        console.error('Reminder digest error:', err);
    }
}

/* Weekly digest of unresolved vehicle issues. Drivers get their own vehicle's
   issues; accounting + admin get the full fleet rundown. */
async function runFleetIssuesDigest() {
    try {
        const rows = await pool.query(
            `SELECT v.id, v.name AS vehicle, v.vehicle_id, v.driver_id,
                    du.email AS driver_email, du.name AS driver_name,
                    n.category, n.content, n.created_at
             FROM vehicles v
             JOIN vehicle_notes n ON n.vehicle_id = v.id AND n.resolved = FALSE
             LEFT JOIN users du ON du.id = v.driver_id
             ORDER BY v.name, n.created_at DESC`
        );
        if (rows.rowCount === 0) return;

        /* Group issues by vehicle → one section per vehicle */
        const byVehicle = new Map();
        for (const r of rows.rows) {
            if (!byVehicle.has(r.id)) byVehicle.set(r.id, { vehicle: r.vehicle, driver_email: r.driver_email, issues: [] });
            byVehicle.get(r.id).issues.push(`[${r.category}] ${r.content}`);
        }

        const allSections = [];
        const byDriver     = new Map();   /* email → sections[] */
        for (const v of byVehicle.values()) {
            const section = { heading: v.vehicle, items: v.issues };
            allSections.push(section);
            if (v.driver_email) {
                if (!byDriver.has(v.driver_email)) byDriver.set(v.driver_email, []);
                byDriver.get(v.driver_email).push(section);
            }
        }

        const note = '— Phoenix Security & Technology portal';

        /* Full rundown → accounting + admin */
        const staff = await pool.query("SELECT email FROM users WHERE role IN ('accounting', 'admin')");
        const to = staff.rows.map(r => r.email);
        if (to.length > 0) {
            await sendTemplated(to, 'Fleet — Weekly Unresolved Issues', 'Fleet — Unresolved Issues', {
                intro: 'Unresolved vehicle issues across the fleet:',
                sections: allSections,
                note,
            }).catch(err => console.error('Fleet digest (staff) failed:', err));
        }

        /* Per-driver → just their vehicle(s) */
        for (const [email, sections] of byDriver) {
            await sendTemplated(email, 'Fleet — Your Vehicle Has Unresolved Issues', 'Your Vehicle — Unresolved Issues', {
                intro: 'Open issues on the vehicle(s) assigned to you:',
                sections,
                note,
            }).catch(err => console.error('Fleet digest (driver) failed:', err));
        }
        console.log(`Fleet issues digest sent — ${byVehicle.size} vehicle(s) with open issues.`);
    } catch (err) {
        console.error('Fleet issues digest error:', err);
    }
}

function startScheduler() {
    cron.schedule('0 8 * * *',    runMonitoringCheck);
    cron.schedule('0 8 * * *',    runMaintenanceCheck);
    cron.schedule('0 8 * * *',    runReminderDigest);
    cron.schedule('*/15 * * * *', runAppointmentReminders);
    cron.schedule('0 8 * * 1',    runFleetIssuesDigest);   /* Mondays 8 AM */
    console.log('Schedulers started — daily 8 AM jobs, weekly fleet digest (Mon), appointment reminders every 15 min');
}

module.exports = { startScheduler, runMaintenanceCheck };
