const express      = require('express');
const router       = express.Router();
const pool         = require('../db/pool');
const { WebClient } = require('@slack/web-api');
const { authenticate, requireRole } = require('../middleware/requireRole');

const slack          = new WebClient(process.env.SLACK_TOKEN);
const PROJECT_CH     = process.env.PROJECT_SLACK_CHANNEL_ID;

/* -----------------------------------------------------------------------
   Slack message helpers — mirrors the logic in routes/projects.js
   ----------------------------------------------------------------------- */
function parseFields(text) {
    if (!text || !text.includes('\n')) return null;
    const rawLines = text.split('\n').map(l => l.trim());
    const isBold   = l => /^\*[^*]+\*$/.test(l);
    const destar   = l => l.replace(/\*/g, '').trim();
    const skip     = l => l.toLowerCase().includes('submission from') ||
                          l.toLowerCase().includes('project report');

    if (rawLines.some(isBold)) {
        const fields = {}; let key = null, vals = [];
        for (const raw of rawLines) {
            if (!raw || skip(raw)) continue;
            if (isBold(raw)) {
                if (key !== null) { const v = vals.join(' ').trim(); if (v) fields[key] = v; }
                key = destar(raw); vals = [];
            } else if (key !== null) vals.push(raw);
        }
        if (key !== null) { const v = vals.join(' ').trim(); if (v) fields[key] = v; }
        return Object.keys(fields).length > 0 ? fields : null;
    }
    const fields = {};
    for (let i = 0; i + 1 < rawLines.length; i += 2) {
        const k = destar(rawLines[i]);
        const v = rawLines[i + 1];
        if (k && v) fields[k] = v;
    }
    return Object.keys(fields).length > 0 ? fields : null;
}

function get(fields, keys) {
    if (!fields) return null;
    for (const k of keys) { if (fields[k]) return fields[k]; }
    for (const [fk, fv] of Object.entries(fields))
        for (const k of keys)
            if (fk.toLowerCase().includes(k.toLowerCase())) return fv;
    return null;
}

/* Fetch and parse recent project reports from Slack — read only */
async function fetchSlackProjects(limit = 60) {
    if (!process.env.SLACK_TOKEN || !PROJECT_CH) return [];
    try {
        const result = await slack.conversations.history({ channel: PROJECT_CH, limit });
        const out    = [];
        for (const m of (result.messages || [])) {
            const fields = parseFields(m.text);
            if (!fields) continue;
            const job     = get(fields, ['Job name','Job Name','Project name','Project Name','Job']) || 'Unknown';
            const techs   = get(fields, ['Technician','Technicians','Tech','Name','Who'])           || '';
            const work    = get(fields, ['What work was completed','Work completed','Work','Description']) || '';
            const parts   = get(fields, ['What parts and supplies were used','Parts','Parts used','Supplies']) || '';
            const arrival = get(fields, ['Site arrival and departure times','Arrival','Times','Time']) || '';
            const doneRaw = get(fields, ['Is a return trip required','Return trip','Complete','Completed']) || '';
            const done    = doneRaw.toLowerCase().includes('no') || doneRaw.toLowerCase().includes('complete');
            out.push({
                date:   new Date(Number(m.ts) * 1000).toLocaleDateString(),
                job,
                techs,
                work:   work.slice(0, 120),
                parts:  parts.slice(0, 80),
                arrival,
                done,
            });
        }
        return out;
    } catch (err) {
        console.error('AI Slack fetch error:', err.message);
        return [];
    }
}

/* -----------------------------------------------------------------------
   POST /api/ai/query
   Fetches a read-only snapshot of portal + Slack data, builds a context
   string, and forwards the question to Ollama running locally.
   The LLM never touches the database or Slack — we fetch everything with
   hardcoded read-only calls and pass it as plain text.
   ----------------------------------------------------------------------- */
router.post('/query', requireRole('admin', 'accounting'), async (req, res) => {
    const { question } = req.body;
    if (typeof question !== 'string' || !question.trim()) return res.status(400).json({ error: 'question is required' });
    if (question.length > 2000) return res.status(400).json({ error: 'question is too long (max 2000 chars).' });

    /* ---- 1. Pull read-only snapshot (DB + Slack in parallel) ----------- */
    const [clients, vehicles, vehicleNotes, tickets, finance, slackProjects] = await Promise.all([
        pool.query(`
            SELECT name, customer_id, services, billing_amount
            FROM clients ORDER BY name
        `).catch(() => ({ rows: [] })),

        pool.query(`
            SELECT v.name, v.vehicle_id, v.status,
                   COUNT(vn.id) FILTER (WHERE vn.resolved = FALSE)::int AS open_issues
            FROM vehicles v
            LEFT JOIN vehicle_notes vn ON vn.vehicle_id = v.id
            GROUP BY v.id, v.name, v.vehicle_id, v.status
            ORDER BY v.name
        `).catch(() => ({ rows: [] })),

        pool.query(`
            SELECT v.name AS vehicle_name, LEFT(vn.content, 80) AS content
            FROM vehicle_notes vn
            JOIN vehicles v ON v.id = vn.vehicle_id
            WHERE vn.resolved = FALSE
            ORDER BY vn.created_at DESC
            LIMIT 10
        `).catch(() => ({ rows: [] })),

        pool.query(`
            SELECT status, COUNT(*)::int AS count
            FROM service_tickets GROUP BY status
        `).catch(() => ({ rows: [] })),

        /* Canonical totals — matches /financials/summary: records + client payments
           as income, records + fleet (vehicle_invoices) as expenses. */
        pool.query(`
            SELECT
                (
                    (SELECT COALESCE(SUM(amount), 0) FROM financial_records WHERE type = 'income')
                  + (SELECT COALESCE(SUM(amount), 0) FROM client_transactions WHERE type = 'payment')
                )::numeric AS total_income,
                (
                    (SELECT COALESCE(SUM(amount), 0) FROM financial_records WHERE type = 'expense')
                  + (SELECT COALESCE(SUM(amount), 0) FROM vehicle_invoices)
                )::numeric AS total_expenses
        `).catch(() => ({ rows: [{ total_income: 0, total_expenses: 0 }] })),

        fetchSlackProjects(60),
    ]);

    /* ---- 2. Build context string --------------------------------------- */
    const fin = finance.rows[0] || {};
    const net = Number(fin.total_income || 0) - Number(fin.total_expenses || 0);

    /* Pre-compute exact figures so the model never has to count */
    const totalClients     = clients.rows.length;
    const totalVehicles    = vehicles.rows.length;
    const vehiclesWithIssues = vehicles.rows.filter(v => v.open_issues > 0).length;
    const totalOpenIssues  = vehicles.rows.reduce((s, v) => s + (v.open_issues || 0), 0);
    const ticketMap        = Object.fromEntries(tickets.rows.map(t => [t.status, t.count]));
    const openTickets      = (ticketMap.open || 0) + (ticketMap.in_progress || 0);
    const totalProjects    = Object.keys(
        slackProjects.reduce((m, p) => { m[p.job] = 1; return m; }, {})
    ).length;
    const activeProjects   = slackProjects.filter(p => !p.done).length > 0
        ? [...new Set(slackProjects.filter(p => !p.done).map(p => p.job))].length : 0;
    const clientsNoBilling = clients.rows.filter(c => !c.billing_amount).length;

    const lines = [
        `You are a knowledgeable assistant for Phoenix SecTech, a fire alarm and access control security company.`,
        `You have been given a real-time read-only snapshot of their operations. Answer clearly and professionally.`,
        `If data is missing or incomplete, say so. Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`,
        ``,
        `════ KEY FACTS (use these exact numbers — do not recount) ════`,
        `  • Clients: ${totalClients} total, ${clientsNoBilling} without billing set`,
        `  • Fleet: ${totalVehicles} vehicles, ${vehiclesWithIssues} with open issues (${totalOpenIssues} open issues total)`,
        `  • Service tickets: ${openTickets} open/in-progress`,
        `  • Projects in Slack: ${totalProjects} unique jobs, ${activeProjects} still active`,
        `  • Financial totals: $${Number(fin.total_income || 0).toLocaleString()} income / $${Number(fin.total_expenses || 0).toLocaleString()} expenses`,
        ``,
        `════ CLIENTS (${clients.rows.length} total) ════`,
        ...clients.rows.map(c => {
            const p = [`${c.name} [${c.customer_id}]`];
            if (c.services?.length) p.push(`services: ${c.services.join(', ')}`);
            p.push(c.billing_amount ? `billing: $${Number(c.billing_amount).toFixed(2)}/mo` : `billing: not set`);
            return `  • ${p.join(' | ')}`;
        }),
        ``,
        `════ FLEET (${vehicles.rows.length} vehicles) ════`,
        ...vehicles.rows.map(v =>
            `  • ${v.name} [${v.vehicle_id}] | status: ${v.status} | open issues: ${v.open_issues}`
        ),
    ];

    if (vehicleNotes.rows.length > 0) {
        lines.push(``, `════ OPEN VEHICLE ISSUES ════`);
        lines.push(...vehicleNotes.rows.map(n => `  • [${n.vehicle_name}] ${n.content}`));
    }

    lines.push(
        ``,
        `════ SERVICE TICKETS ════`,
        ...tickets.rows.map(t => `  • ${t.status}: ${t.count}`),
        ``,
        `════ FINANCIALS ════`,
        `  • Total Income:   $${Number(fin.total_income || 0).toLocaleString()}`,
        `  • Total Expenses: $${Number(fin.total_expenses || 0).toLocaleString()}`,
        `  • Net:            ${net >= 0 ? '+' : ''}$${net.toLocaleString()}`,
    );

    if (slackProjects.length > 0) {
        /* Group by job name for a compact summary */
        const byJob = {};
        for (const p of slackProjects) {
            if (!byJob[p.job]) byJob[p.job] = { visits: 0, techs: new Set(), lastDate: p.date, lastWork: p.work, done: p.done };
            byJob[p.job].visits++;
            if (p.techs) p.techs.split(/[,&\/]+/).forEach(t => byJob[p.job].techs.add(t.trim()));
            byJob[p.job].lastWork = p.work || byJob[p.job].lastWork;
            byJob[p.job].done     = p.done;
        }

        lines.push(``, `════ PROJECT REPORTS FROM SLACK (${slackProjects.length} posts, ${Object.keys(byJob).length} jobs) ════`);
        for (const [job, d] of Object.entries(byJob)) {
            const techList = [...d.techs].filter(Boolean).join(', ') || 'unknown';
            lines.push(`  • ${job} | ${d.done ? 'COMPLETE' : 'ACTIVE'} | ${d.visits} visit${d.visits !== 1 ? 's' : ''} | techs: ${techList} | last: ${d.lastDate}`);
            if (d.lastWork) lines.push(`      Work: ${d.lastWork}`);
        }
    }

    const context = lines.join('\n');

    /* ---- 3. Call Ollama ------------------------------------------------ */
    let ollamaRes;
    try {
        ollamaRes = await fetch('http://localhost:11434/api/generate', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model:  process.env.OLLAMA_MODEL || 'llama3.2:3b',
                prompt: `${context}\n\n${'═'.repeat(40)}\nQuestion: ${question}\n\nAnswer:`,
                stream: false,
                options: {
                    temperature: 0.3,
                    num_predict: 300,
                },
            }),
        });
    } catch {
        return res.status(503).json({ error: 'AI service unavailable — is Ollama running? (sudo systemctl start ollama)' });
    }

    if (!ollamaRes.ok) {
        const txt = await ollamaRes.text().catch(() => '');
        return res.status(502).json({ error: `Ollama error ${ollamaRes.status}: ${txt}` });
    }

    const data = await ollamaRes.json();
    res.json({ answer: data.response?.trim() || '(no response)' });
});

module.exports = router;
