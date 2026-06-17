const express = require('express');
const { WebClient } = require('@slack/web-api');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/requireRole');

const router = express.Router();

/* Customer-service calls are read from a Slack channel (admin-configurable). */
const CHANNEL_KEY     = 'cs_calls_slack_channel';
const DEFAULT_CHANNEL = process.env.CS_CALLS_SLACK_CHANNEL || '';
const slack = process.env.SLACK_TOKEN ? new WebClient(process.env.SLACK_TOKEN) : null;

async function getSetting(key) {
    try { const r = await pool.query('SELECT value FROM app_settings WHERE key = $1', [key]); return r.rows[0]?.value ?? null; }
    catch { return null; }
}
async function setSetting(key, value) {
    await pool.query(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMP DEFAULT NOW())`).catch(() => {});
    await pool.query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, value]
    );
}
const getChannel = async () => (await getSetting(CHANNEL_KEY)) || DEFAULT_CHANNEL;

/* Pull readable text out of a Slack message (plain text, blocks, attachments). */
function extractText(msg) {
    if (msg.text && msg.text.trim()) return msg.text;
    if (Array.isArray(msg.blocks)) {
        const parts = [];
        for (const b of msg.blocks) {
            if (b.type === 'section' && b.text?.text) parts.push(b.text.text);
            else if (b.type === 'header' && b.text?.text) parts.push(b.text.text);
            else if (b.type === 'rich_text' && Array.isArray(b.elements)) {
                for (const sec of b.elements) if (Array.isArray(sec.elements)) parts.push(sec.elements.map(e => e.text || '').join(''));
            }
        }
        if (parts.filter(Boolean).join('\n').trim()) return parts.filter(Boolean).join('\n');
    }
    if (Array.isArray(msg.attachments)) {
        const parts = [];
        for (const a of msg.attachments) { if (a.pretext) parts.push(a.pretext); if (a.text) parts.push(a.text); else if (a.fallback) parts.push(a.fallback); }
        if (parts.filter(Boolean).join('\n').trim()) return parts.filter(Boolean).join('\n');
    }
    return '';
}
/* The poster identity — for these bot-posted call logs this is the integration
   name ("Incoming Phone Call" / "Customer Service Request") = the call category. */
function posterOf(msg, userMap) {
    if (msg.bot_profile?.name) return msg.bot_profile.name;
    if (msg.username)          return msg.username;
    if (msg.user)              return userMap[msg.user] || msg.user;
    return 'Unknown';
}

const MENTION_RE = /<@(U[A-Z0-9]+)(?:\|[^>]*)?>/g;

/* First @user mention in the message → Slack user ID (who took the call). */
function firstMention(text) {
    const m = String(text || '').match(/<@(U[A-Z0-9]+)/);
    return m ? m[1] : null;
}

/* Make Slack markup readable: resolve <@U..> mentions, <!date..> tokens, links. */
function cleanText(text, userMap) {
    return String(text || '')
        .replace(/<!date\^\d+(?:\^[^|>]*)?\|([^>]+)>/g, '$1')         // date token → fallback
        .replace(MENTION_RE, (_, uid) => `@${userMap[uid] || uid}`)   // user mention → @name
        .replace(/<#C[A-Z0-9]+\|([^>]+)>/g, '#$1')                    // channel mention
        .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2')             // link with label
        .replace(/<(https?:\/\/[^>]+)>/g, '$1')                       // bare link
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function slackErr(e) {
    const code = e?.data?.error;
    if (code === 'channel_not_found') return 'Slack channel not found, or the bot is not a member of it (invite the bot to the channel).';
    if (code === 'not_in_channel')    return 'The bot is not a member of that channel — invite it, then retry.';
    if (code === 'missing_scope')     return 'The Slack app is missing a required scope (channels:history / groups:history and users:read).';
    return e?.message || 'Slack request failed.';
}

/* GET /api/calls — recent customer-service calls + who took them. */
router.get('/', authenticate, async (req, res) => {
    const channel = await getChannel();
    if (!slack)    return res.status(503).json({ error: 'Slack is not configured on the server (SLACK_TOKEN missing).', channel });
    if (!channel)  return res.json({ configured: false, channel: '', calls: [], byPerson: [] });

    try {
        let messages = [];
        let cursor;
        for (let page = 0; page < 3; page++) {
            const r = await slack.conversations.history({ channel, limit: 200, ...(cursor ? { cursor } : {}) });
            messages.push(...(r.messages || []));
            if (!r.has_more || !r.response_metadata?.next_cursor) break;
            cursor = r.response_metadata.next_cursor;
        }
        /* Drop channel-join / system noise, keep human + bot posts. */
        messages = messages.filter(m => !m.subtype || m.subtype === 'bot_message');

        /* Resolve display names for posters AND for every @mentioned user. */
        const ids = new Set();
        for (const m of messages) {
            if (m.user) ids.add(m.user);
            for (const mm of extractText(m).matchAll(MENTION_RE)) ids.add(mm[1]);
        }
        const userMap = {};
        for (const uid of ids) {
            try { const info = await slack.users.info({ user: uid }); userMap[uid] = info.user?.real_name || info.user?.name || uid; }
            catch { userMap[uid] = uid; }
        }

        const calls = messages.map(m => {
            const raw = extractText(m);
            const mid = firstMention(raw);
            return {
                ts:       m.ts,
                date:     new Date(Number(m.ts) * 1000).toISOString(),
                category: posterOf(m, userMap),                // bot/poster name → call category
                receiver: mid ? (userMap[mid] || mid) : null,  // @mentioned user → who took the call
                text:     cleanText(raw, userMap),
            };
        }).filter(c => c.text);

        /* "Calls taken" tallies the receiver — the staff member who took the call. */
        const tally = {};
        for (const c of calls) { const who = c.receiver || 'Unassigned'; tally[who] = (tally[who] || 0) + 1; }
        const byPerson = Object.entries(tally).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

        res.json({ configured: true, channel, calls, byPerson });
    } catch (e) {
        res.status(502).json({ error: slackErr(e), channel });
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
