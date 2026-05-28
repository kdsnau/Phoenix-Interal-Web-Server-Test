const cron           = require('node-cron');
const pool           = require('../db/pool');
const { sendMail }   = require('../config/mailer');

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

function startScheduler() {
    cron.schedule('0 8 * * *', runMonitoringCheck);
    console.log('Monitoring scheduler started — runs daily at 8:00 AM');
}

module.exports = { startScheduler };
