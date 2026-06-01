/**
 * GET /api/app/sync
 *
 * Read-only endpoint for the Android field-report app.
 * Returns client names (from DB) and job names (from Slack project channel)
 * so the app can populate its autocomplete dropdown.
 *
 * Auth: simple Bearer key — set APP_SYNC_KEY in .env and in the app's local.properties.
 * No JWT required; this is intentionally separate from the portal's user auth.
 */

const express      = require('express');
const { WebClient } = require('@slack/web-api');
const pool         = require('../db/pool');

const router     = express.Router();
const slack      = new WebClient(process.env.SLACK_TOKEN);
const CHANNEL_ID = process.env.PROJECT_SLACK_CHANNEL_ID;

/* ── API-key guard ─────────────────────────────────────────────────────────── */
router.use((req, res, next) => {
    const key = process.env.APP_SYNC_KEY;
    if (!key) return res.status(503).json({ error: 'Sync not configured on server.' });

    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${key}`) return res.status(401).json({ error: 'Unauthorized.' });
    next();
});

/* ── Slack helpers (mirrors projects.js) ───────────────────────────────────── */
function parseFields(text) {
    if (!text || !text.includes('\n')) return null;
    const lines  = text.split('\n').map(l => l.trim());
    const isBold = l => /^\*[^*]+\*$/.test(l);
    const destar = l => l.replace(/\*/g, '').trim();
    const skip   = l => l.toLowerCase().includes('submission from') || l.toLowerCase().includes('project report');

    if (lines.some(isBold)) {
        const fields = {}; let key = null, vals = [];
        for (const raw of lines) {
            if (!raw || skip(raw)) continue;
            if (isBold(raw)) {
                if (key !== null) { const v = vals.join('\n').trim(); if (v) fields[key] = v; }
                key = destar(raw); vals = [];
            } else if (key !== null) { vals.push(raw); }
        }
        if (key !== null) { const v = vals.join('\n').trim(); if (v) fields[key] = v; }
        return Object.keys(fields).length ? fields : null;
    }
    return null;
}

function getJobName(fields) {
    if (!fields) return null;
    const keys = ['Job name', 'Job Name', 'Project name', 'Project Name', 'Job'];
    for (const k of keys) if (fields[k]) return fields[k];
    for (const [fk, fv] of Object.entries(fields)) {
        if (['job', 'project'].some(t => fk.toLowerCase().includes(t))) return fv;
    }
    return null;
}

/* ── GET /api/app/sync ─────────────────────────────────────────────────────── */
router.get('/', async (req, res) => {
    try {
        const [clientRows, slackResult] = await Promise.all([
            pool.query('SELECT name FROM clients ORDER BY name ASC'),
            slack.conversations.history({ channel: CHANNEL_ID, limit: 200 }),
        ]);

        const clients = clientRows.rows.map(r => r.name);

        const jobSet = new Set();
        for (const msg of slackResult.messages || []) {
            const name = getJobName(parseFields(msg.text));
            if (name && name.trim().length > 2) jobSet.add(name.trim());
        }

        res.json({ clients, jobs: [...jobSet].sort() });
    } catch (err) {
        console.error('App sync error:', err.message);
        res.status(500).json({ error: 'Sync failed.' });
    }
});

module.exports = router;
