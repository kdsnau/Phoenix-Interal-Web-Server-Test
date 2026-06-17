const { WebClient } = require('@slack/web-api');
const pool = require('../db/pool');

/* Shared Slack "calls" feed — used by both the Calls page and profiles. */
const CHANNEL_KEY     = 'cs_calls_slack_channel';
const DEFAULT_CHANNEL = process.env.CS_CALLS_SLACK_CHANNEL || '';
const slack = process.env.SLACK_TOKEN ? new WebClient(process.env.SLACK_TOKEN) : null;

async function getSetting(key) {
    try { const r = await pool.query('SELECT value FROM app_settings WHERE key = $1', [key]); return r.rows[0]?.value ?? null; }
    catch { return null; }
}
const getChannel = async () => (await getSetting(CHANNEL_KEY)) || DEFAULT_CHANNEL;

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

/* Poster identity → call category (bot integration name). */
function posterOf(msg, userMap) {
    if (msg.bot_profile?.name) return msg.bot_profile.name;
    if (msg.username)          return msg.username;
    if (msg.user)              return userMap[msg.user] || msg.user;
    return 'Unknown';
}

const MENTION_RE = /<@(U[A-Z0-9]+)(?:\|[^>]*)?>/g;
const firstMention = text => { const m = String(text || '').match(/<@(U[A-Z0-9]+)/); return m ? m[1] : null; };

function cleanText(text, userMap) {
    return String(text || '')
        .replace(/<!date\^\d+(?:\^[^|>]*)?\|([^>]+)>/g, '$1')
        .replace(MENTION_RE, (_, uid) => `@${userMap[uid] || uid}`)
        .replace(/<#C[A-Z0-9]+\|([^>]+)>/g, '#$1')
        .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2')
        .replace(/<(https?:\/\/[^>]+)>/g, '$1')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/* Short cache (keyed by channel) so the Calls page + profile loads don't each
   hammer the Slack API. */
let _cache = null;
const CACHE_MS = 60 * 1000;

/* Fetch + normalize calls. Returns { configured, channel, calls }.
   Throws on Slack API errors (caller decides how to surface them). */
async function fetchCalls() {
    const channel = await getChannel();
    if (!slack)   { const e = new Error('Slack is not configured (SLACK_TOKEN missing).'); e.slackError = 'no_token'; throw e; }
    if (!channel) return { configured: false, channel: '', calls: [] };

    if (_cache && _cache.channel === channel && Date.now() - _cache.at < CACHE_MS) return _cache.data;

    let messages = [];
    let cursor;
    for (let page = 0; page < 3; page++) {
        const r = await slack.conversations.history({ channel, limit: 200, ...(cursor ? { cursor } : {}) });
        messages.push(...(r.messages || []));
        if (!r.has_more || !r.response_metadata?.next_cursor) break;
        cursor = r.response_metadata.next_cursor;
    }
    messages = messages.filter(m => !m.subtype || m.subtype === 'bot_message');

    const ids = new Set();
    for (const m of messages) { if (m.user) ids.add(m.user); for (const mm of extractText(m).matchAll(MENTION_RE)) ids.add(mm[1]); }
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
            category: posterOf(m, userMap),
            receiver: mid ? (userMap[mid] || mid) : null,
            text:     cleanText(raw, userMap),
        };
    }).filter(c => c.text);

    const data = { configured: true, channel, calls };
    _cache = { channel, at: Date.now(), data };
    return data;
}

module.exports = { fetchCalls, getChannel, CHANNEL_KEY, DEFAULT_CHANNEL };
