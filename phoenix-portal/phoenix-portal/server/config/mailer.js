const nodemailer = require('nodemailer');

/* -----------------------------------------------------------------------
   SMTP transport — configure via server/.env:
     SMTP_HOST=smtp.gmail.com
     SMTP_PORT=587
     SMTP_USER=your-gmail@gmail.com
     SMTP_PASS=xxxx xxxx xxxx xxxx   ← 16-char Gmail App Password
     SMTP_FROM=Phoenix SecTech Portal <your-gmail@gmail.com>

   Gmail App Password setup:
     myaccount.google.com → Security → 2-Step Verification → App Passwords
     (2FA must be enabled on the account first)
   ----------------------------------------------------------------------- */
const transport = nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.gmail.com',
    port:   Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

const FROM = process.env.SMTP_FROM || `Phoenix SecTech Portal <${process.env.SMTP_USER}>`;

function htmlWrap(title, bodyHtml) {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<style>
  body { margin: 0; padding: 0; background: #0d0f11; font-family: 'Helvetica Neue', Arial, sans-serif; }
  .wrapper { max-width: 600px; margin: 40px auto; background: #13171b; border: 1px solid #2a3040; border-radius: 4px; overflow: hidden; }
  .header { background: #1b2028; border-bottom: 3px solid #e85d26; padding: 24px 32px; }
  .header-mark { display: inline-block; background: #e85d26; color: #fff; font-weight: 700; font-size: 13px; letter-spacing: 0.08em; padding: 6px 10px; border-radius: 3px; margin-bottom: 12px; }
  .header-title { color: #eaf0f8; font-size: 20px; font-weight: 600; margin: 0; }
  .header-sub { color: #5c6e82; font-size: 12px; margin: 4px 0 0; }
  .body { padding: 32px; }
  .field { margin-bottom: 16px; }
  .field-label { font-size: 11px; color: #5c6e82; text-transform: uppercase; letter-spacing: 0.08em; font-family: monospace; margin-bottom: 4px; }
  .field-value { font-size: 14px; color: #c9d4e0; }
  .field-value.hi { color: #eaf0f8; font-weight: 500; }
  .divider { border: none; border-top: 1px solid #2a3040; margin: 24px 0; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 2px; font-size: 11px; font-family: monospace; text-transform: uppercase; letter-spacing: 0.05em; }
  .badge-orange { background: rgba(232,93,38,0.15); color: #e85d26; }
  .badge-green  { background: rgba(45,181,109,0.15); color: #2db56d; }
  .badge-yellow { background: rgba(217,168,50,0.15); color: #d9a832; }
  .footer { background: #0d0f11; border-top: 1px solid #2a3040; padding: 16px 32px; font-size: 11px; color: #5c6e82; font-family: monospace; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <div class="header-mark">PST</div>
    <h1 class="header-title">${title}</h1>
    <p class="header-sub">Phoenix Security &amp; Technology — Internal Portal</p>
  </div>
  <div class="body">
    ${bodyHtml}
  </div>
  <div class="footer">
    This is an automated message from the Phoenix SecTech Internal Portal.<br/>
    ${new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}
  </div>
</div>
</body>
</html>`;
}

/*
 * sendMail(to, subject, text, html)
 *
 * `to` can be a single address string, a comma-separated string, or an array.
 */
async function sendMail(to, subject, text, html) {
    await transport.sendMail({
        from:    FROM,
        to,
        subject,
        text,
        html: html || `<pre style="color:#c9d4e0;font-family:monospace">${text}</pre>`,
    });
}

function esc(s) {
    return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/* Render a structured email spec into the shared branded template (the same
   look fleet/feedback mail uses) plus a plaintext mirror so every message has a
   clean text fallback. spec = {
     intro,                                          // greeting / lead line
     fields:   [{ label, value, hi, badge, rawHtml }], // key/value rows
     sections: [{ heading, items: [string] }],         // bulleted groups (digests)
     note,                                             // closing line
   } */
function renderEmail(title, spec = {}) {
    const { intro, fields = [], sections = [], note } = spec;
    let html = '';
    let text = '';

    if (intro) {
        html += `<p style="font-size:14px;color:#c9d4e0;margin:0 0 20px;line-height:1.6">${esc(intro)}</p>`;
        text += `${intro}\n\n`;
    }

    for (const f of fields) {
        const valHtml = f.rawHtml != null
            ? f.rawHtml
            : (f.badge ? `<span class="badge ${f.badge}">${esc(f.value)}</span>` : esc(f.value));
        const cls = f.hi ? 'field-value hi' : 'field-value';
        html += `<div class="field"><div class="field-label">${esc(f.label)}</div><div class="${cls}">${valHtml}</div></div>`;
        text += `${f.label}: ${f.value}\n`;
    }

    sections.forEach((s, i) => {
        if (i === 0 && fields.length) html += `<hr class="divider"/>`;
        if (s.heading) {
            html += `<div class="field-label" style="margin:0 0 8px">${esc(s.heading)}</div>`;
            text += `\n${s.heading}:\n`;
        }
        html += `<ul style="margin:0 0 18px;padding-left:18px;color:#c9d4e0;font-size:14px;line-height:1.7">`;
        for (const it of (s.items || [])) {
            html += `<li>${esc(it)}</li>`;
            text += `  • ${it}\n`;
        }
        html += `</ul>`;
    });

    if (note) {
        html += `<hr class="divider"/><p style="font-size:12px;color:#5c6e82;margin:0">${esc(note)}</p>`;
        text += `\n${note}\n`;
    }

    return { html: htmlWrap(title, html), text: text.trimEnd() };
}

/* Convenience: build + send a branded email from a structured spec. */
async function sendTemplated(to, subject, title, spec) {
    const { html, text } = renderEmail(title, spec);
    await sendMail(to, subject, text, html);
}

async function sendServiceReminder(to, vehicle) {
    const subject = `Service Reminder: ${vehicle.name} (${vehicle.year} ${vehicle.make} ${vehicle.model})`;
    const text = `Service reminder for ${vehicle.name}.\n\nVehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}\nID: ${vehicle.vehicle_id}\nMileage: ${vehicle.mileage} mi\n\nPlease schedule a service appointment.`;
    const html = htmlWrap('Service Reminder', `
        <div class="field"><div class="field-label">Vehicle</div><div class="field-value hi">${vehicle.name} — ${vehicle.year} ${vehicle.make} ${vehicle.model}</div></div>
        <div class="field"><div class="field-label">Vehicle ID</div><div class="field-value">${vehicle.vehicle_id}</div></div>
        <div class="field"><div class="field-label">Current Mileage</div><div class="field-value">${Number(vehicle.mileage).toLocaleString()} mi</div></div>
        <hr class="divider"/>
        <div class="field"><div class="field-label">Action Required</div><div class="field-value"><span class="badge badge-orange">Schedule Service Appointment</span></div></div>
        <div class="field"><div class="field-label">Next Reminder</div><div class="field-value">In 3 months</div></div>
    `);
    await sendMail(to, subject, text, html);
}

async function sendTagsReminder(to, vehicle) {
    const subject = `Tags Renewal Reminder: ${vehicle.name} (${vehicle.year} ${vehicle.make} ${vehicle.model})`;
    const text = `Tags renewal reminder for ${vehicle.name}.\n\nDue: ${vehicle.tags_renewal}\nRegistration: ${vehicle.registration}`;
    const daysUntil = vehicle.tags_renewal
        ? Math.ceil((new Date(vehicle.tags_renewal) - new Date()) / 86400000)
        : null;
    const urgency = daysUntil !== null && daysUntil < 30 ? 'badge-yellow' : 'badge-green';
    const html = htmlWrap('Tags Renewal Reminder', `
        <div class="field"><div class="field-label">Vehicle</div><div class="field-value hi">${vehicle.name} — ${vehicle.year} ${vehicle.make} ${vehicle.model}</div></div>
        <div class="field"><div class="field-label">Vehicle ID</div><div class="field-value">${vehicle.vehicle_id}</div></div>
        <div class="field"><div class="field-label">Registration</div><div class="field-value">${vehicle.registration || 'N/A'}</div></div>
        <hr class="divider"/>
        <div class="field"><div class="field-label">Tags Renewal Due</div><div class="field-value hi">${vehicle.tags_renewal ? new Date(vehicle.tags_renewal).toLocaleDateString('en-US', { dateStyle: 'long' }) : 'Not set'}</div></div>
        ${daysUntil !== null ? `<div class="field"><div class="field-label">Days Until Renewal</div><div class="field-value"><span class="badge ${urgency}">${daysUntil < 0 ? 'EXPIRED' : `${daysUntil} days`}</span></div></div>` : ''}
    `);
    await sendMail(to, subject, text, html);
}

async function sendNewTicket(to, ticket, createdBy) {
    const subject = `New Ticket: ${ticket.title}`;
    const text = `New service ticket created.\n\nTitle: ${ticket.title}\nDescription: ${ticket.description || 'N/A'}\nCreated by: ${createdBy}`;
    const html = htmlWrap('New Service Ticket', `
        <div class="field"><div class="field-label">Title</div><div class="field-value hi">${ticket.title}</div></div>
        <div class="field"><div class="field-label">Description</div><div class="field-value">${ticket.description || '—'}</div></div>
        <div class="field"><div class="field-label">Created By</div><div class="field-value">${createdBy}</div></div>
        <div class="field"><div class="field-label">Status</div><div class="field-value"><span class="badge badge-yellow">Open</span></div></div>
    `);
    await sendMail(to, subject, text, html);
}

async function sendNewFinancialRecord(to, record, createdBy) {
    const subject = `New Financial Record: ${record.type}`;
    const text = `New financial record added.\n\nDescription: ${record.description}\nAmount: $${record.amount}\nType: ${record.type}\nAdded by: ${createdBy}`;
    const badgeClass = record.type === 'income' ? 'badge-green' : 'badge-orange';
    const html = htmlWrap('New Financial Record', `
        <div class="field"><div class="field-label">Description</div><div class="field-value hi">${record.description}</div></div>
        <div class="field"><div class="field-label">Amount</div><div class="field-value hi">${record.type === 'income' ? '+' : '-'}$${Number(record.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></div>
        <div class="field"><div class="field-label">Type</div><div class="field-value"><span class="badge ${badgeClass}">${record.type}</span></div></div>
        <div class="field"><div class="field-label">Added By</div><div class="field-value">${createdBy}</div></div>
    `);
    await sendMail(to, subject, text, html);
}

async function sendNewUser(to, user) {
    const subject = 'Welcome to Phoenix SecTech Portal';
    const text = `Hi ${user.name},\n\nYour account has been created.\n\nEmail: ${user.email}\nRole: ${user.role}`;
    const html = htmlWrap('Welcome to the Portal', `
        <div class="field"><div class="field-label">Name</div><div class="field-value hi">${user.name}</div></div>
        <div class="field"><div class="field-label">Email</div><div class="field-value">${user.email}</div></div>
        <div class="field"><div class="field-label">Role</div><div class="field-value"><span class="badge badge-orange">${user.role}</span></div></div>
        <hr class="divider"/>
        <div class="field"><div class="field-label">Next Steps</div><div class="field-value">Log in at your portal URL and change your password.</div></div>
    `);
    await sendMail(to, subject, text, html);
}

const CATEGORY_BADGE = {
    bug:         'badge-orange',
    feature:     'badge-green',
    improvement: 'badge-yellow',
    general:     'badge-yellow',
};

async function sendFeedback(to, { category, subject, message, fromName, fromEmail, fromRole }) {
    const emailSubject = `[Portal Feedback] ${subject}`;
    const text = `Feedback submitted via the Phoenix SecTech portal.\n\nFrom: ${fromName} (${fromEmail}) — ${fromRole}\nCategory: ${category}\nSubject: ${subject}\n\n${message}`;
    const badge = CATEGORY_BADGE[category] || 'badge-yellow';
    const html = htmlWrap('Portal Feedback', `
        <div class="field"><div class="field-label">From</div><div class="field-value hi">${fromName} <span style="color:#5c6e82">&lt;${fromEmail}&gt;</span></div></div>
        <div class="field"><div class="field-label">Role</div><div class="field-value"><span class="badge badge-orange">${fromRole}</span></div></div>
        <div class="field"><div class="field-label">Category</div><div class="field-value"><span class="badge ${badge}">${category}</span></div></div>
        <hr class="divider"/>
        <div class="field"><div class="field-label">Subject</div><div class="field-value hi">${subject}</div></div>
        <div class="field"><div class="field-label">Message</div><div class="field-value" style="white-space:pre-wrap;line-height:1.6">${message}</div></div>
    `);
    await sendMail(to, emailSubject, text, html);
}

module.exports = { sendMail, sendTemplated, renderEmail, htmlWrap, sendServiceReminder, sendTagsReminder, sendNewTicket, sendNewFinancialRecord, sendNewUser, sendFeedback };
