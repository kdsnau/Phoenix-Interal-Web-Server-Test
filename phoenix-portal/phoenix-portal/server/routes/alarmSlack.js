const express      = require('express');
const { WebClient } = require('@slack/web-api');
const pool         = require('../db/pool');
const { authenticate } = require('../middleware/requireRole');

const router     = express.Router();
router.use(authenticate);

const slack      = new WebClient(process.env.SLACK_TOKEN);
const CHANNEL_ID = process.env.ALARM_SLACK_CHANNEL_ID;

/* -----------------------------------------------------------------------
   Parse a Slack workflow message with *bold* field labels into a map.
   Accumulates multi-line values until the next bold label.
   ----------------------------------------------------------------------- */
function parseFields(text) {
    if (!text || !text.includes('\n')) return null;
    const rawLines = text.split('\n').map(l => l.trim());
    const isBold   = l => /^\*[^*]+\*$/.test(l);
    const destar   = l => l.replace(/\*/g, '').trim();
    const skipLine = l => l.toLowerCase().includes('submission from');

    if (rawLines.some(isBold)) {
        const fields = {}; let key = null, vals = [];
        for (const raw of rawLines) {
            if (!raw || skipLine(raw)) continue;
            if (isBold(raw)) {
                if (key !== null) { const v = vals.join('\n').trim(); if (v) fields[key] = v; }
                key = destar(raw); vals = [];
            } else if (key !== null) { vals.push(raw); }
        }
        if (key !== null) { const v = vals.join('\n').trim(); if (v) fields[key] = v; }
        return Object.keys(fields).length > 0 ? fields : null;
    }

    /* Pairwise fallback */
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
    for (const [fk, fv] of Object.entries(fields)) {
        for (const k of keys) {
            if (fk.toLowerCase().includes(k.toLowerCase())) return fv;
        }
    }
    return null;
}

/* GET /api/alarm-slack/all */
router.get('/all', async (req, res) => {
    try {
        const result   = await slack.conversations.history({ channel: CHANNEL_ID, limit: 200 });
        const messages = (result.messages || []).map(m => ({
            ts:     m.ts,
            date:   new Date(Number(m.ts) * 1000).toISOString(),
            text:   m.text,
            fields: parseFields(m.text),
        }));
        res.json({ count: messages.length, messages });
    } catch (err) {
        console.error('Alarm Slack error:', err.message);
        res.status(500).json({ error: 'Failed to fetch alarm Slack messages.' });
    }
});

/* GET /api/alarm-slack/client/:clientId */
router.get('/client/:clientId', async (req, res) => {
    try {
        const clientRow = await pool.query('SELECT name FROM clients WHERE id = $1', [req.params.clientId]);
        if (clientRow.rowCount === 0) return res.status(404).json({ error: 'Client not found.' });

        const clientName = clientRow.rows[0].name.toLowerCase();

        const result   = await slack.conversations.history({ channel: CHANNEL_ID, limit: 200 });
        const messages = (result.messages || [])
            .filter(m => {
                const fields  = parseFields(m.text);
                const company = get(fields, ['Company name', 'Company', 'Site', 'Customer']);
                if (company) {
                    const co = company.toLowerCase();
                    return co.includes(clientName) || clientName.includes(co);
                }
                return (m.text || '').toLowerCase().includes(clientName);
            })
            .map(m => ({
                ts:     m.ts,
                date:   new Date(Number(m.ts) * 1000).toISOString(),
                text:   m.text,
                fields: parseFields(m.text),
            }));

        res.json({ count: messages.length, messages });
    } catch (err) {
        console.error('Alarm Slack error:', err.message);
        res.status(500).json({ error: 'Failed to fetch alarm Slack messages.' });
    }
});

module.exports = router;
