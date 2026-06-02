const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { authenticate } = require('../middleware/requireRole');

/* -----------------------------------------------------------------------
   POST /api/ai/query
   Fetches a read-only snapshot of portal data, injects it as context,
   and forwards the user's question to Ollama running locally.
   The LLM never touches the database — we pull data with hardcoded
   SELECT queries and hand it as plain text.
   ----------------------------------------------------------------------- */
router.post('/query', authenticate, async (req, res) => {
    const { question } = req.body;
    if (!question?.trim()) return res.status(400).json({ error: 'question is required' });

    /* ---- 1. Pull a read-only snapshot ---------------------------------- */
    const [clients, vehicles, vehicleNotes, tickets, finance, projects] = await Promise.all([
        pool.query(`
            SELECT name, customer_id, services, billing_amount, notes
            FROM clients
            ORDER BY name
        `).catch(() => ({ rows: [] })),

        pool.query(`
            SELECT v.name, v.vehicle_id, v.status, v.mileage,
                   COUNT(vn.id) FILTER (WHERE vn.resolved = FALSE)::int AS open_issues
            FROM vehicles v
            LEFT JOIN vehicle_notes vn ON vn.vehicle_id = v.id
            GROUP BY v.id, v.name, v.vehicle_id, v.status, v.mileage
            ORDER BY v.name
        `).catch(() => ({ rows: [] })),

        pool.query(`
            SELECT v.name AS vehicle_name, vn.content, vn.created_at
            FROM vehicle_notes vn
            JOIN vehicles v ON v.id = vn.vehicle_id
            WHERE vn.resolved = FALSE
            ORDER BY vn.created_at DESC
        `).catch(() => ({ rows: [] })),

        pool.query(`
            SELECT status, COUNT(*)::int AS count
            FROM service_tickets
            GROUP BY status
        `).catch(() => ({ rows: [] })),

        pool.query(`
            SELECT
                COALESCE(SUM(amount) FILTER (WHERE type = 'income'),  0)::numeric AS total_income,
                COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0)::numeric AS total_expenses
            FROM financials
        `).catch(() => ({ rows: [{ total_income: 0, total_expenses: 0 }] })),

        pool.query(`
            SELECT DISTINCT ON (job_name)
                job_name, completed, rfq, ts
            FROM slack_messages
            ORDER BY job_name, ts DESC
            LIMIT 60
        `).catch(() => ({ rows: [] })),
    ]);

    /* ---- 2. Build context string --------------------------------------- */
    const fin = finance.rows[0] || {};
    const net = Number(fin.total_income || 0) - Number(fin.total_expenses || 0);

    const lines = [
        `You are a knowledgeable assistant for Phoenix SecTech, a fire alarm and access control security company.`,
        `You have been given a real-time read-only snapshot of their internal operations portal.`,
        `Answer the question clearly and professionally. If data is missing or incomplete, say so honestly.`,
        `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`,
        ``,
        `════ CLIENTS (${clients.rows.length} total) ════`,
        ...clients.rows.map(c => {
            const parts = [`${c.name} [${c.customer_id}]`];
            if (c.services?.length) parts.push(`services: ${c.services.join(', ')}`);
            parts.push(c.billing_amount ? `billing: $${Number(c.billing_amount).toFixed(2)}/mo` : `billing: not set`);
            if (c.notes) parts.push(`notes: ${c.notes}`);
            return `  • ${parts.join(' | ')}`;
        }),
        ``,
        `════ FLEET (${vehicles.rows.length} vehicles) ════`,
        ...vehicles.rows.map(v =>
            `  • ${v.name} [${v.vehicle_id}] | status: ${v.status}` +
            (v.mileage ? ` | mileage: ${Number(v.mileage).toLocaleString()}` : '') +
            ` | open issues: ${v.open_issues}`
        ),
    ];

    if (vehicleNotes.rows.length > 0) {
        lines.push(``, `════ OPEN VEHICLE ISSUES ════`);
        lines.push(...vehicleNotes.rows.map(n =>
            `  • [${n.vehicle_name}] ${n.content} (logged ${new Date(n.created_at).toLocaleDateString()})`
        ));
    }

    lines.push(
        ``,
        `════ SERVICE TICKETS ════`,
        ...tickets.rows.map(t => `  • ${t.status}: ${t.count} ticket${t.count !== 1 ? 's' : ''}`),
        ``,
        `════ FINANCIALS ════`,
        `  • Total Income:   $${Number(fin.total_income || 0).toLocaleString()}`,
        `  • Total Expenses: $${Number(fin.total_expenses || 0).toLocaleString()}`,
        `  • Net:            ${net >= 0 ? '+' : ''}$${net.toLocaleString()}`,
    );

    if (projects.rows.length > 0) {
        lines.push(``, `════ RECENT PROJECTS (${projects.rows.length}) ════`);
        lines.push(...projects.rows.map(p =>
            `  • ${p.job_name}${p.rfq ? ` [RFQ: ${p.rfq}]` : ''} — ${p.completed ? 'completed' : 'active'}`
        ));
    }

    const context = lines.join('\n');

    /* ---- 3. Call Ollama ------------------------------------------------ */
    let ollamaRes;
    try {
        ollamaRes = await fetch('http://localhost:11434/api/generate', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model:  process.env.OLLAMA_MODEL || 'llama3.1:8b',
                prompt: `${context}\n\n${'═'.repeat(40)}\nQuestion: ${question}\n\nAnswer:`,
                stream: false,
                options: {
                    temperature: 0.3,   /* lower = more factual */
                    num_predict: 512,
                },
            }),
        });
    } catch (connErr) {
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
