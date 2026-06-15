const cron           = require('node-cron');
const pool           = require('../db/pool');
const { sendMail }   = require('../config/mailer');
const { gcalCreate } = require('../config/gcal');

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
            const subject = `Weekly Monitoring Report: ${client.name}`;
            const text    = `Weekly monitoring report for ${client.name} (${client.customer_id}).\n\nServices: ${(client.services || []).join(', ')}\nBilling: $${client.billing_amount || 0}/mo`;
            const badges  = (client.services || [])
                .map(s => `<span style="display:inline-block;padding:3px 10px;border-radius:2px;font-size:11px;font-family:monospace;text-transform:uppercase;background:rgba(45,181,109,.15);color:#2db56d;margin-right:4px">${s}</span>`)
                .join('');

            const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<style>
  body{margin:0;padding:0;background:#0d0f11;font-family:'Helvetica Neue',Arial,sans-serif}
  .w{max-width:600px;margin:40px auto;background:#13171b;border:1px solid #2a3040;border-radius:4px;overflow:hidden}
  .h{background:#1b2028;border-bottom:3px solid #e85d26;padding:24px 32px}
  .hm{display:inline-block;background:#e85d26;color:#fff;font-weight:700;font-size:13px;letter-spacing:.08em;padding:6px 10px;border-radius:3px;margin-bottom:12px}
  .ht{color:#eaf0f8;font-size:20px;font-weight:600;margin:0}
  .b{padding:32px}
  .fl{margin-bottom:16px}
  .lbl{font-size:11px;color:#5c6e82;text-transform:uppercase;letter-spacing:.08em;font-family:monospace;margin-bottom:4px}
  .val{font-size:14px;color:#c9d4e0}
  .val.hi{color:#eaf0f8;font-weight:500}
  .ft{background:#0d0f11;border-top:1px solid #2a3040;padding:16px 32px;font-size:11px;color:#5c6e82;font-family:monospace}
</style></head><body><div class="w">
  <div class="h"><div class="hm">PST</div><h1 class="ht">Weekly Monitoring Report</h1></div>
  <div class="b">
    <div class="fl"><div class="lbl">Client</div><div class="val hi">${client.name}</div></div>
    <div class="fl"><div class="lbl">Account #</div><div class="val">${client.customer_id}</div></div>
    <div class="fl"><div class="lbl">Services</div><div class="val">${badges}</div></div>
    <div class="fl"><div class="lbl">Monthly Billing</div><div class="val hi">$${Number(client.billing_amount || 0).toFixed(2)}</div></div>
  </div>
  <div class="ft">Automated weekly monitoring report — ${new Date().toLocaleDateString('en-US', { dateStyle: 'full' })}</div>
</div></body></html>`;

            await sendMail(to, subject, text, html);

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
    try {
        const due = await pool.query(
            `SELECT id, name, customer_id, site_address, maintenance_frequency, maintenance_next
             FROM clients
             WHERE maintenance_enabled = TRUE
               AND maintenance_next IS NOT NULL
               AND maintenance_next <= CURRENT_DATE`
        );
        if (due.rowCount === 0) return;

        const adminRow = await pool.query("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
        const creator  = adminRow.rows[0]?.id || null;
        const STEP     = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 };

        for (const c of due.rows) {
            const dueDate = c.maintenance_next;
            const tk = await pool.query(
                `INSERT INTO service_tickets
                    (title, description, created_by, client_id, source, event_start, event_location)
                 VALUES ($1, $2, $3, $4, 'calendar', $5, $6)
                 RETURNING *`,
                [
                    `Scheduled Maintenance — ${c.name}`,
                    `Recurring ${c.maintenance_frequency || ''} maintenance for ${c.name} (${c.customer_id}).`,
                    creator,
                    c.id,
                    dueDate,
                    c.site_address || null,
                ]
            );
            const ticket = tk.rows[0];

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
        }
        console.log(`Maintenance scheduler: created ${due.rowCount} ticket(s).`);
    } catch (err) {
        console.error('Maintenance scheduler error:', err);
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
                await sendMail(
                    u.email,
                    `Reminder: "${t.title}" starts soon`,
                    `Hi ${u.name},\n\nYour scheduled ticket starts within the hour.\n\nTitle: ${t.title}\nTime: ${when}\nLocation: ${t.event_location || 'N/A'}\n\nPhoenix Security & Technology`
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
        const addSec = (title, rows, fmt) => { if (rows.length) sections.push(`${title}:\n` + rows.map(fmt).join('\n')); };
        addSec('Contracts ending',                  contracts.rows,   c => `  • ${c.name} — ${fmtDays(c.days)}`);
        addSec('Permits expiring',                  permits.rows,     c => `  • ${c.name} — ${fmtDays(c.days)}`);
        addSec('Inspections due',                   inspections.rows, c => `  • ${c.name} — ${fmtDays(c.days)}`);
        addSec('Maintenance due',                   maint.rows,       c => `  • ${c.name} — ${fmtDays(c.days)}`);
        addSec('Monitored but no billing amount',   noBill.rows,      c => `  • ${c.name}`);
        addSec('Tickets past departure, not closed', overdue.rows,    t => `  • ${t.title}`);

        if (sections.length === 0) return;   /* nothing to nag about today */

        const recips = await pool.query("SELECT email FROM users WHERE role IN ('accounting', 'admin')");
        const to = recips.rows.map(r => r.email);
        if (to.length === 0) return;

        const body = `Daily reminders — ${new Date().toLocaleDateString('en-US', { dateStyle: 'full' })}\n\n`
                   + sections.join('\n\n')
                   + `\n\n— Phoenix Security & Technology portal`;
        await sendMail(to, 'Phoenix SecTech — Daily Reminders', body).catch(err => console.error('Reminder digest email failed:', err));
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

        /* Group issues by vehicle */
        const byVehicle = new Map();
        for (const r of rows.rows) {
            if (!byVehicle.has(r.id)) byVehicle.set(r.id, { vehicle: r.vehicle, driver_email: r.driver_email, issues: [] });
            byVehicle.get(r.id).issues.push(`    • [${r.category}] ${r.content}`);
        }

        const fullLines = [];
        const byDriver  = new Map();   /* email → lines */
        for (const v of byVehicle.values()) {
            const block = `${v.vehicle}:\n${v.issues.join('\n')}`;
            fullLines.push(block);
            if (v.driver_email) {
                if (!byDriver.has(v.driver_email)) byDriver.set(v.driver_email, []);
                byDriver.get(v.driver_email).push(block);
            }
        }

        const footer = '\n\n— Phoenix Security & Technology portal';

        /* Full rundown → accounting + admin */
        const staff = await pool.query("SELECT email FROM users WHERE role IN ('accounting', 'admin')");
        const to = staff.rows.map(r => r.email);
        if (to.length > 0) {
            await sendMail(to, 'Fleet — Weekly Unresolved Issues',
                `Unresolved vehicle issues across the fleet:\n\n${fullLines.join('\n\n')}${footer}`
            ).catch(err => console.error('Fleet digest (staff) failed:', err));
        }

        /* Per-driver → just their vehicle(s) */
        for (const [email, lines] of byDriver) {
            await sendMail(email, 'Fleet — Your Vehicle Has Unresolved Issues',
                `Open issues on the vehicle(s) assigned to you:\n\n${lines.join('\n\n')}${footer}`
            ).catch(err => console.error('Fleet digest (driver) failed:', err));
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

module.exports = { startScheduler };
