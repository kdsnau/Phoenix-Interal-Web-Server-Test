const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/requireRole');
const { fetchCalls, getChannel, CHANNEL_KEY, DEFAULT_CHANNEL } = require('../services/callsFeed');

const router = express.Router();

async function setSetting(key, value) {
    await pool.query(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMP DEFAULT NOW())`).catch(() => {});
    await pool.query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, value]
    );
}

function slackErr(e) {
    const code = e?.data?.error || e?.slackError;
    if (code === 'no_token')          return 'Slack is not configured on the server (SLACK_TOKEN missing).';
    if (code === 'channel_not_found') return 'Slack channel not found, or the bot is not a member of it (invite the bot to the channel).';
    if (code === 'not_in_channel')    return 'The bot is not a member of that channel — invite it, then retry.';
    if (code === 'missing_scope')     return 'The Slack app is missing a required scope (channels:history / groups:history and users:read).';
    return e?.message || 'Slack request failed.';
}

/* GET /api/calls — recent customer-service calls + who took them. */
router.get('/', authenticate, async (_req, res) => {
    try {
        const { configured, channel, calls } = await fetchCalls();
        if (!configured) return res.json({ configured: false, channel, calls: [], byPerson: [] });

        const tally = {};
        for (const c of calls) { const who = c.receiver || 'Unassigned'; tally[who] = (tally[who] || 0) + 1; }
        const byPerson = Object.entries(tally).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

        res.json({ configured: true, channel, calls, byPerson });
    } catch (e) {
        res.status(e?.slackError === 'no_token' ? 503 : 502).json({ error: slackErr(e), channel: await getChannel().catch(() => '') });
    }
});

/* GET/PUT /api/calls/channel — admin sets the source channel. */
router.get('/channel', requireRole('admin'), async (_req, res) => {
    res.json({ channel: await getChannel(), default: DEFAULT_CHANNEL });
});
router.put('/channel', requireRole('admin'), async (req, res) => {
    const channel = (req.body.channel || '').trim();
    try { await setSetting(CHANNEL_KEY, channel); res.json({ channel }); }
    catch (e) { console.error('set calls channel error:', e); res.status(500).json({ error: 'Failed to save channel.' }); }
});

module.exports = router;
