const express    = require('express');
const { WebClient } = require('@slack/web-api');
const { authenticate } = require('../middleware/requireRole');

const router = express.Router();
router.use(authenticate);

const slack      = new WebClient(process.env.SLACK_TOKEN);
const CHANNEL_ID = process.env.SLACK_CHANNEL_ID;

/* -----------------------------------------------------------------------
   Extract readable text from a Slack message.
   Bot/integration messages often have empty .text and use blocks/attachments.
   ----------------------------------------------------------------------- */
function extractText(msg) {
    /* Plain text first */
    if (msg.text && msg.text.trim()) return msg.text;

    /* Block Kit blocks */
    if (Array.isArray(msg.blocks)) {
        const parts = [];
        for (const block of msg.blocks) {
            if (block.type === 'section' && block.text?.text)
                parts.push(block.text.text);
            else if (block.type === 'header' && block.text?.text)
                parts.push(`*${block.text.text}*`);
            else if (block.type === 'context' && Array.isArray(block.elements))
                parts.push(block.elements.map(e => e.text || '').join('  '));
            else if (block.type === 'rich_text' && Array.isArray(block.elements)) {
                for (const section of block.elements) {
                    if (Array.isArray(section.elements))
                        parts.push(section.elements.map(e => e.text || '').join(''));
                }
            }
        }
        const joined = parts.filter(Boolean).join('\n');
        if (joined.trim()) return joined;
    }

    /* Legacy attachments */
    if (Array.isArray(msg.attachments)) {
        const parts = [];
        for (const att of msg.attachments) {
            if (att.pretext) parts.push(att.pretext);
            if (att.text)    parts.push(att.text);
            else if (att.fallback) parts.push(att.fallback);
            if (Array.isArray(att.fields))
                parts.push(att.fields.map(f => `*${f.title}*: ${f.value}`).join('\n'));
        }
        const joined = parts.filter(Boolean).join('\n');
        if (joined.trim()) return joined;
    }

    return '';
}

/* -----------------------------------------------------------------------
   Resolve the display name for a message author.
   Human messages have .user; bot/integration messages have .username or
   .bot_profile.name.
   ----------------------------------------------------------------------- */
function getAuthor(msg, userMap) {
    if (msg.user)                  return userMap[msg.user] || msg.user;
    if (msg.bot_profile?.name)     return msg.bot_profile.name;
    if (msg.username)              return msg.username;
    return 'Bot';
}

/* -----------------------------------------------------------------------
   Convert Slack mrkdwn to simple HTML.
   Handles mentions, links, bold, italic, strikethrough, code blocks.
   ----------------------------------------------------------------------- */
function formatSlackText(text, userMap) {
    return text
        /* User mentions: <@U123> → @Name */
        .replace(/<@([A-Z0-9]+)>/g, (_, uid) => `@${userMap[uid] || uid}`)
        /* Links with label: <https://...|text> → <a>text</a> */
        .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g,
            '<a href="$1" target="_blank" rel="noopener noreferrer">$2</a>')
        /* Plain links: <https://...> → <a>url</a> */
        .replace(/<(https?:\/\/[^>]+)>/g,
            '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
        /* Channel mentions: <#C123|name> → #name */
        .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
        /* Special broadcasts */
        .replace(/<!here>/g,     '@here')
        .replace(/<!channel>/g,  '@channel')
        .replace(/<!everyone>/g, '@everyone')
        /* Fenced code blocks (must come before inline code) */
        .replace(/```([\s\S]+?)```/g, '<pre style="background:var(--bg-3);padding:8px;border-radius:4px;font-size:12px;overflow-x:auto;margin:4px 0">$1</pre>')
        /* Inline code */
        .replace(/`([^`]+)`/g, '<code style="background:var(--bg-3);padding:1px 4px;border-radius:3px;font-size:12px">$1</code>')
        /* Bold */
        .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
        /* Italic */
        .replace(/(?<![a-zA-Z0-9])_([^_\n]+)_(?![a-zA-Z0-9])/g, '<em>$1</em>')
        /* Strikethrough */
        .replace(/~([^~\n]+)~/g, '<del>$1</del>')
        /* Newlines → <br> */
        .replace(/\n/g, '<br>');
}

router.get('/vehicle/:vehicleId', async (req, res) => {
    const { vehicleId }                        = req.params;
    const { name, make, model, slackName }     = req.query;

    try {
        let validTerms;

        if (slackName) {
            /*
             * Preferred path: vehicle has an explicit slack_name in the DB
             * (e.g. "NV200 #1", "NV200 #2", "Tesla #2", "Nissan NV-2500").
             * Match exactly on that value; add a hyphen-normalised variant so
             * "NV2500 #1" still matches "NV-2500 #1" regardless of how it was typed.
             */
            const lower      = slackName.toLowerCase();
            const noHyphen   = lower.replace(/-/g, '');
            const withHyphen = lower.replace(/([a-z])(\d)/g, '$1-$2');
            validTerms = [...new Set([lower, noHyphen, withHyphen].filter(t => t.length > 1))];
        } else {
            /*
             * Fallback: derive terms from make/model when slack_name is not set yet.
             * Slack uses "[Model] #[N]" (NV200 #1) or "[Make] [Model]" (Nissan NV-2500).
             */
            const unitNumMatch = name && name.match(/\d+/);
            const unitNum      = unitNumMatch ? String(parseInt(unitNumMatch[0], 10)) : null;

            const terms = [];

            if (model) {
                const lower      = model.toLowerCase();
                const noHyphen   = lower.replace(/-/g, '');
                const withHyphen = lower.replace(/([a-z])(\d)/g, '$1-$2');
                [lower, noHyphen, withHyphen].forEach(v => terms.push(v));
                if (unitNum) {
                    const firstWord = lower.split(/[\s-]+/)[0];
                    terms.push(`${firstWord} #${unitNum}`);
                }
            }

            if (make && model) {
                const makeLow   = make.toLowerCase();
                const modLow    = model.toLowerCase();
                const modNoHyph = modLow.replace(/-/g, '');
                const modHyph   = modLow.replace(/([a-z])(\d)/g, '$1-$2');
                terms.push(`${makeLow} ${modLow}`);
                if (modNoHyph !== modLow)  terms.push(`${makeLow} ${modNoHyph}`);
                if (modHyph   !== modLow)  terms.push(`${makeLow} ${modHyph}`);
            }

            if (make && unitNum) {
                terms.push(`${make.toLowerCase()} #${unitNum}`);
            }

            validTerms = [...new Set(terms.filter(t => t.length > 2))];
        }

        /* Paginate up to 3 pages of 1000 messages (~3000 total) */
        let allRaw = [];
        let cursor  = undefined;
        for (let page = 0; page < 3; page++) {
            const result = await slack.conversations.history({
                channel: CHANNEL_ID,
                limit:   1000,
                ...(cursor ? { cursor } : {}),
            });
            allRaw.push(...result.messages);
            if (!result.has_more || !result.response_metadata?.next_cursor) break;
            cursor = result.response_metadata.next_cursor;
        }

        const filtered = allRaw.filter(m => {
            const text = extractText(m).toLowerCase();
            return validTerms.some(t => text.includes(t));
        });

        const userIds = [...new Set(filtered.map(m => m.user).filter(Boolean))];
        const userMap = {};
        for (const uid of userIds) {
            try {
                const info = await slack.users.info({ user: uid });
                userMap[uid] = info.user?.real_name || info.user?.name || uid;
            } catch {
                userMap[uid] = uid;
            }
        }
        /* Bot display names are on the message itself — no extra API call needed */

        const messages = filtered.map(m => ({
            ts:   m.ts,
            date: new Date(Number(m.ts) * 1000).toISOString(),
            html: formatSlackText(extractText(m), userMap),
            user: getAuthor(m, userMap),
        }));

        return res.json({ count: messages.length, messages });
    } catch (err) {
        console.error('Slack error:', err.message);
        return res.status(500).json({ error: 'Failed to fetch Slack messages.' });
    }
});

module.exports = router;
