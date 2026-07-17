const express      = require('express');
const { WebClient } = require('@slack/web-api');
const pool         = require('../db/pool');
const { authenticate } = require('../middleware/requireRole');

const router     = express.Router();
router.use(authenticate);

const slack      = new WebClient(process.env.SLACK_TOKEN);
const CHANNEL_ID = process.env.ALARM_SLACK_CHANNEL_ID;
const PROJECT_CHANNEL_ID = process.env.PROJECT_SLACK_CHANNEL_ID;

/* Channels a client's Slack activity can live in, with the field labels that
   carry the client/site name in each. The alarm channel tags jobs by company;
   the project-reports channel tags them by "Job name" (e.g. "Terros Health -
   Mitchell Dr"), so a project client's posts only show up if we search it too. */
const CLIENT_CHANNELS = [
    { id: CHANNEL_ID,         label: 'Alarm',   keys: ['Company name', 'Company', 'Site', 'Customer'], limit: 200 },
    { id: PROJECT_CHANNEL_ID, label: 'Project', keys: ['Job name', 'Job Name', 'Project name', 'Project Name', 'Job', 'Company name', 'Site'], limit: 400 },
].filter(c => c.id);

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

/* Normalize a name for matching: lowercase, punctuation → spaces, collapse. */
function norm(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/* A deliberately loose client↔message match. In order of looseness:
   - either string contains the other (handles "Sunday Goods Surprise" vs
     "Sunday Goods Surprise (BURG)");
   - else all of the client's significant (3+ char) name words appear in the
     haystack in any order (handles punctuation, word order, "- City" suffixes).
   Requiring every significant word keeps it from matching on a lone common
   word, so it's looser without becoming a free-for-all. */
function looseMatch(clientName, haystack) {
    const c = norm(clientName), h = norm(haystack);
    if (!c || !h) return false;
    if (h.includes(c) || c.includes(h)) return true;
    const toks = c.split(' ').filter(t => t.length >= 3);
    if (toks.length === 0) return false;
    const hset = new Set(h.split(' '));
    return toks.every(t => hset.has(t));
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

/* GET /api/alarm-slack/client/:clientId
   Pulls the client's Slack activity from BOTH the alarm-signal channel and the
   project-reports channel and merges them — a project client (e.g. Terros
   Health) has its posts in the project channel, keyed by "Job name", not in the
   alarm channel. Matched loosely per-channel on that channel's name fields, and
   always against the message body as a fallback. */
router.get('/client/:clientId', async (req, res) => {
    try {
        const clientRow = await pool.query('SELECT name FROM clients WHERE id = $1', [req.params.clientId]);
        if (clientRow.rowCount === 0) return res.status(404).json({ error: 'Client not found.' });

        const clientName = clientRow.rows[0].name.toLowerCase();

        const perChannel = await Promise.all(CLIENT_CHANNELS.map(async (ch) => {
            const result = await slack.conversations
                .history({ channel: ch.id, limit: ch.limit })
                .catch(() => ({ messages: [] }));
            return (result.messages || [])
                .filter(m => {
                    const fields = parseFields(m.text);
                    const named  = get(fields, ch.keys);
                    return looseMatch(clientName, named) || looseMatch(clientName, m.text);
                })
                .map(m => ({
                    ts:     m.ts,
                    date:   new Date(Number(m.ts) * 1000).toISOString(),
                    text:   m.text,
                    fields: parseFields(m.text),
                    source: ch.label,
                }));
        }));

        /* Newest first across both channels. */
        const messages = perChannel.flat().sort((a, b) => Number(b.ts) - Number(a.ts));
        res.json({ count: messages.length, messages });
    } catch (err) {
        console.error('Alarm Slack error:', err.message);
        res.status(500).json({ error: 'Failed to fetch Slack messages.' });
    }
});

module.exports = router;
