const express      = require('express');
const { WebClient } = require('@slack/web-api');
const { authenticate } = require('../middleware/requireRole');

const router     = express.Router();
router.use(authenticate);

const slack      = new WebClient(process.env.SLACK_TOKEN);
const CHANNEL_ID = process.env.PROJECT_SLACK_CHANNEL_ID;

/* -----------------------------------------------------------------------
   Parse a Slack workflow form message into a field map.
   Bold labels (*Label*) mark field names; following lines are the value
   until the next bold label.
   ----------------------------------------------------------------------- */
function parseFields(text) {
    if (!text || !text.includes('\n')) return null;
    const rawLines = text.split('\n').map(l => l.trim());
    const isBold   = l => /^\*[^*]+\*$/.test(l);
    const destar   = l => l.replace(/\*/g, '').trim();
    const skipLine = l =>
        l.toLowerCase().includes('submission from') ||
        l.toLowerCase().includes('project report');

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

/* Exact match first, then partial key match */
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

/* -----------------------------------------------------------------------
   GET /api/projects
   Groups Slack messages by job name into project cards.
   ----------------------------------------------------------------------- */
router.get('/', async (req, res) => {
    try {
        const result = await slack.conversations.history({ channel: CHANNEL_ID, limit: 200 });
        const msgs   = result.messages || [];
        const map    = {};

        for (const m of msgs) {
            const fields = parseFields(m.text);
            if (!fields) continue;

            const jobName  = get(fields, ['Job name', 'Job Name', 'Project name', 'Project Name', 'Job']) || 'Unknown';
            const rfq      = get(fields, ['RFQ', 'RFQ#', 'RFQ #', 'Work order', 'Work Order', 'Work Order #']) || '';
            const work     = get(fields, ['What work was completed', 'Work completed', 'Work', 'Description']) || '';
            const parts    = get(fields, ['What parts and supplies were used', 'Parts', 'Parts used', 'Supplies']) || '';
            const arrival  = get(fields, ['Site arrival and departure times', 'Arrival', 'Times', 'Time']) || '';
            const techs    = get(fields, ['Technician', 'Technicians', 'Tech', 'Name', 'Who']) || '';
            const doneRaw  = get(fields, ['Is a return trip required', 'Return trip', 'Complete', 'Completed']) || '';
            const completed = doneRaw.toLowerCase().includes('no') || doneRaw.toLowerCase().includes('complete');

            const images = (m.files || [])
                .filter(f => f.mimetype && f.mimetype.startsWith('image/'))
                .map(f => ({ fileId: f.id, name: f.name }));

            const visit = { ts: m.ts, date: new Date(Number(m.ts) * 1000).toISOString(), technicians: techs, arrival, work, parts, completed, images };

            if (!map[jobName]) {
                map[jobName] = { name: jobName, rfq, completed: false, lastVisit: m.ts, visits: [] };
            }
            map[jobName].visits.push(visit);
            if (m.ts > map[jobName].lastVisit) map[jobName].lastVisit = m.ts;
            if (completed) map[jobName].completed = true;
        }

        const projects = Object.values(map)
            .map(p => ({ ...p, visits: p.visits.sort((a, b) => b.ts - a.ts) }))
            .sort((a, b) => {
                if (a.completed !== b.completed) return a.completed ? 1 : -1;
                return b.lastVisit - a.lastVisit;
            });

        res.json(projects);
    } catch (err) {
        console.error('Projects Slack error:', err.message);
        res.status(500).json({ error: 'Failed to fetch project reports.' });
    }
});

/* -----------------------------------------------------------------------
   GET /api/projects/image/:fileId
   Proxies a private Slack image so the browser can display it without
   needing to send an Authorization header via <img src>.
   ----------------------------------------------------------------------- */
router.get('/image/:fileId', async (req, res) => {
    try {
        const info = await slack.files.info({ file: req.params.fileId });
        const url  = info.file?.url_private;
        if (!url) return res.status(404).json({ error: 'Image not found.' });

        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${process.env.SLACK_TOKEN}` },
        });
        if (!response.ok) return res.status(response.status).json({ error: 'Failed to fetch image.' });

        res.setHeader('Content-Type',  response.headers.get('content-type') || 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=3600');

        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));
    } catch (err) {
        console.error('Image proxy error:', err.message);
        res.status(500).json({ error: 'Failed to proxy image.' });
    }
});

module.exports = router;
