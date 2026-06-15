const express  = require('express');
const router   = express.Router();
const pool     = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/requireRole');
const { getToken, getTokenError, clearTokenCache } = require('../config/gcal');

const GCAL = 'https://www.googleapis.com/calendar/v3/calendars';

/* Read a calendar's events. Prefers the OAuth token (can read the account's own
   private calendars, e.g. the Official one), and falls back to the public API key
   for calendars shared publicly. Returns { ok, items } or { ok:false, status, error }. */
async function fetchEvents(calId, timeMin, timeMax) {
    const base   = `${GCAL}/${encodeURIComponent(calId)}/events`;
    const params = `?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`
                 + `&orderBy=startTime&singleEvents=true&maxResults=250`;
    const key    = process.env.GOOGLE_API_KEY;

    const attempts = [];
    const token = await getToken().catch(() => null);
    if (token) attempts.push({ url: base + params, opts: { headers: { Authorization: `Bearer ${token}` } } });
    if (key)   attempts.push({ url: base + params + `&key=${key}`, opts: {} });
    if (attempts.length === 0) return { ok: false, status: 503, error: 'Google Calendar not configured.' };

    let last = { ok: false, status: 500, error: 'Google API error' };
    for (const a of attempts) {
        try {
            const r    = await fetch(a.url, a.opts);
            const body = await r.json().catch(() => ({}));
            if (r.ok) return { ok: true, items: body.items || [] };
            last = { ok: false, status: r.status, error: body?.error?.message || `Google API error ${r.status}` };
        } catch {
            last = { ok: false, status: 502, error: 'Failed to reach Google Calendar API.' };
        }
    }
    return last;
}

/* ── Schema migrations ────────────────────────────────────────────────── */
pool.query(`ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS source          TEXT      DEFAULT 'manual'`).catch(() => {});
pool.query(`ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS google_event_id TEXT`).catch(() => {});
pool.query(`ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS event_start      TIMESTAMP`).catch(() => {});
pool.query(`ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS event_end        TIMESTAMP`).catch(() => {});
pool.query(`ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS event_location   TEXT`).catch(() => {});
/* Unique index on google_event_id (ignoring NULLs so manual tickets don't conflict) */
pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uix_tickets_google_event_id
            ON service_tickets(google_event_id)
            WHERE google_event_id IS NOT NULL`).catch(() => {});

/* Simple key/value store — holds the Official calendar's secret iCal URL. */
pool.query(`CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TIMESTAMP DEFAULT NOW()
)`).catch(() => {});

async function getSetting(key) {
    const r = await pool.query('SELECT value FROM app_settings WHERE key = $1', [key]).catch(() => ({ rows: [] }));
    return r.rows[0]?.value || null;
}
async function setSetting(key, value) {
    /* Self-heal: ensure the table exists even if the startup migration was missed. */
    await pool.query(`CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMP DEFAULT NOW()
    )`).catch(() => {});
    await pool.query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, value]
    );
}

/* ── Helpers ──────────────────────────────────────────────────────────── */
function parseEventStart(e) {
    const raw = e.start?.dateTime || e.start?.date;
    return raw ? new Date(raw) : null;
}

function parseEventEnd(e) {
    const raw = e.end?.dateTime || e.end?.date;
    return raw ? new Date(raw) : null;
}

/* ── iCal (.ics) feed support — for private calendars via their secret URL ── */
const PHX_OFFSET_MIN = -420;   /* America/Phoenix is UTC-7 year-round (no DST) */

function unescapeIcs(s) {
    return String(s).replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

/* Offset (minutes from UTC) to assume for a floating / TZID-tagged time. We only
   special-case UTC; everything else defaults to Phoenix since that's the company TZ. */
function tzOffsetMin(tzid) {
    if (!tzid) return PHX_OFFSET_MIN;
    if (/UTC|GMT/i.test(tzid)) return 0;
    return PHX_OFFSET_MIN;
}

/* "20260615T140000Z" | "20260615T140000" (+TZID) | "20260615" → absolute Date. */
function icsToDate(raw, tzid, isDate) {
    const m = String(raw).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
    if (!m) return null;
    const [, y, mo, d, h, mi, s, z] = m;
    const Y = +y, Mo = +mo - 1, D = +d, H = +(h || 0), Mi = +(mi || 0), S = +(s || 0);
    if (isDate || !h) return new Date(Date.UTC(Y, Mo, D, 0, 0, 0) - PHX_OFFSET_MIN * 60000); /* all-day → Phoenix midnight */
    if (z === 'Z')    return new Date(Date.UTC(Y, Mo, D, H, Mi, S));
    return new Date(Date.UTC(Y, Mo, D, H, Mi, S) - tzOffsetMin(tzid) * 60000);
}

/* Parse an iCal document → normalized event records within an upcoming window. */
function parseIcs(text) {
    const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');  /* line unfolding */
    const lines = unfolded.split(/\r\n|\n|\r/);
    const out = [];
    const now = Date.now();
    const from = now - 86400000;            /* include yesterday */
    const to   = now + 86400000 * 120;      /* ~4 months out */
    let cur = null;

    for (const line of lines) {
        if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
        if (line === 'END:VEVENT') {
            if (cur && cur.SUMMARY && cur.startRaw) {
                const start = icsToDate(cur.startRaw, cur.startTzid, cur.startIsDate);
                const end   = cur.endRaw ? icsToDate(cur.endRaw, cur.endTzid, cur.endIsDate) : null;
                if (start && start.getTime() >= from && start.getTime() <= to) {
                    const loc = cur.LOCATION ? unescapeIcs(cur.LOCATION) : null;
                    const descParts = [];
                    if (cur.DESCRIPTION) descParts.push(unescapeIcs(cur.DESCRIPTION));
                    if (loc) descParts.push(`📍 ${loc}`);
                    out.push({
                        uid:      cur.UID || `${cur.SUMMARY}-${cur.startRaw}`,
                        title:    unescapeIcs(cur.SUMMARY),
                        desc:     descParts.join('\n') || null,
                        start, end, location: loc,
                    });
                }
            }
            cur = null; continue;
        }
        if (!cur) continue;
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        const left = line.slice(0, idx);
        const val  = line.slice(idx + 1);
        const semi = left.indexOf(';');
        const name = semi === -1 ? left : left.slice(0, semi);
        const params = semi === -1 ? '' : left.slice(semi + 1);
        const tzid = (params.match(/TZID=([^;]+)/) || [])[1] || null;
        const isDate = /VALUE=DATE/.test(params);
        if      (name === 'UID')         cur.UID = val;
        else if (name === 'SUMMARY')     cur.SUMMARY = val;
        else if (name === 'DESCRIPTION') cur.DESCRIPTION = val;
        else if (name === 'LOCATION')    cur.LOCATION = val;
        else if (name === 'DTSTART')     { cur.startRaw = val; cur.startTzid = tzid; cur.startIsDate = isDate; }
        else if (name === 'DTEND')       { cur.endRaw = val;   cur.endTzid = tzid;   cur.endIsDate = isDate; }
    }
    return out;
}

async function fetchIcsEvents(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`iCal feed returned ${r.status} — check that the secret address is correct.`);
    const text = await r.text();
    if (!/BEGIN:VCALENDAR/.test(text)) throw new Error('That URL did not return an iCal feed.');
    return parseIcs(text);
}

function buildDescription(e) {
    const parts = [];
    const start = parseEventStart(e);
    if (start) {
        const isAllDay = !!e.start?.date;
        parts.push(`📅 ${isAllDay
            ? start.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
            : start.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        }`);
    }
    if (e.location)    parts.push(`📍 ${e.location}`);
    if (e.description) parts.push(`\n${e.description}`);
    return parts.join('\n') || null;
}

/* ── GET /api/calendar/events  (raw Google events for embed fallback) ─── */
router.get('/events', authenticate, async (req, res) => {
    const calId = process.env.GOOGLE_CALENDAR_ID;
    const key   = process.env.GOOGLE_API_KEY;
    if (!calId || !key) return res.status(503).json({ error: 'Google Calendar not configured.', unconfigured: true });

    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth();

    const timeMin = new Date(year, month,     1).toISOString();
    const timeMax = new Date(year, month + 1, 1).toISOString();

    const url = `${GCAL}/${encodeURIComponent(calId)}/events?key=${key}&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&orderBy=startTime&singleEvents=true&maxResults=250`;

    try {
        const gRes = await fetch(url);
        const body = await gRes.json();
        if (!gRes.ok) return res.status(gRes.status).json({ error: body?.error?.message || `Google API error ${gRes.status}` });
        res.json(body.items || []);
    } catch (err) {
        console.error('Calendar fetch error:', err.message);
        res.status(500).json({ error: 'Failed to reach Google Calendar API.' });
    }
});

/* ── GET /api/calendar/list — calendars the portal's Google account can read.
   Diagnostic: shows exactly what the OAuth token can see + the access level,
   so we can tell whether the Official calendar is shared correctly.          */
router.get('/list', requireRole('admin'), async (req, res) => {
    const token = await getToken().catch(() => null);
    if (!token) {
        return res.status(503).json({
            error: 'No Google OAuth token is configured — the portal can only read public calendars via the API key. Run /api/calendar/oauth/start to connect an account.',
        });
    }
    try {
        const r = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250&showHidden=true', {
            headers: { Authorization: `Bearer ${token}` },
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) return res.status(r.status).json({ error: body?.error?.message || `Google API error ${r.status}` });
        const cals = (body.items || []).map(c => ({
            id: c.id, summary: c.summary, accessRole: c.accessRole, primary: !!c.primary,
        }));
        return res.json(cals);
    } catch {
        return res.status(502).json({ error: 'Failed to reach Google Calendar API.' });
    }
});

/* ── POST /api/calendar/sync  — pull events → upsert as tickets ──────────
   Body { source }: 'official' pulls the company Official Calendar; anything
   else (default) pulls the Ticket Calendar that we push tickets to.          */
router.post('/sync', requireRole('admin', 'technician'), async (req, res) => {
    const source = req.body?.source === 'official' ? 'official' : 'ticket';

    /* Build a normalized [{ uid, title, desc, start, end, location }] list from
       either the Official calendar's iCal feed or the Google Ticket calendar. */
    let events;
    if (source === 'official') {
        const icsUrl = await getSetting('official_ics_url');
        if (!icsUrl) {
            return res.status(400).json({ error: 'No iCal URL set. Paste the Official calendar’s secret iCal (.ics) address in the field above, then try again.' });
        }
        try {
            events = await fetchIcsEvents(icsUrl);
        } catch (err) {
            return res.status(502).json({ error: err.message || 'Could not read the iCal feed.' });
        }
    } else {
        const calId = process.env.GOOGLE_CALENDAR_ID;
        if (!calId) return res.status(503).json({ error: 'Google Calendar not configured.', unconfigured: true });
        const now    = new Date();
        const future = new Date(now.getFullYear(), now.getMonth() + 3, now.getDate());
        const result = await fetchEvents(calId, now.toISOString(), future.toISOString());
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        events = result.items
            .filter(e => e.id && e.summary)
            .map(e => ({
                uid: e.id, title: e.summary, desc: buildDescription(e),
                start: parseEventStart(e), end: parseEventEnd(e), location: e.location || null,
            }));
    }

    let created = 0, updated = 0;
    for (const ev of events) {
        if (!ev.uid || !ev.title) continue;
        const existing = await pool.query(
            `SELECT id FROM service_tickets WHERE google_event_id = $1`, [ev.uid]
        ).catch(() => ({ rows: [] }));

        if (existing.rows.length > 0) {
            /* Update title / description / timing — never touch status */
            await pool.query(
                `UPDATE service_tickets
                 SET title = $1, description = $2, event_start = $3, event_end = $4, event_location = $5
                 WHERE google_event_id = $6`,
                [ev.title, ev.desc, ev.start, ev.end, ev.location, ev.uid]
            );
            updated++;
        } else {
            await pool.query(
                `INSERT INTO service_tickets
                 (title, description, created_by, source, google_event_id, event_start, event_end, event_location, status)
                 VALUES ($1, $2, $3, 'calendar', $4, $5, $6, $7, 'open')`,
                [ev.title, ev.desc, req.user.id, ev.uid, ev.start, ev.end, ev.location]
            );
            created++;
        }
    }

    res.json({ created, updated, total: events.length, source });
});

/* ── GET /api/calendar/auth-status — is the Google write/token connection live? */
router.get('/auth-status', requireRole('admin'), async (req, res) => {
    try {
        const token = await getToken().catch(() => null);
        res.json({ ok: !!token, error: token ? null : (getTokenError() || 'Not connected to Google.') });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message || 'Server error.' });
    }
});

/* ── PUT /api/calendar/refresh-token — paste a fresh OAuth refresh token ──────
   Saves it (DB), clears the cache, and immediately re-tests the connection.      */
router.put('/refresh-token', requireRole('admin'), async (req, res) => {
    try {
        const tok = String(req.body?.token || '').trim();
        await setSetting('google_refresh_token', tok);
        clearTokenCache();
        const token = await getToken().catch(() => null);
        res.json({ ok: !!token, error: token ? null : (getTokenError() || 'Token saved, but Google rejected it.') });
    } catch (err) {
        console.error('refresh-token error:', err.message);
        res.status(500).json({ ok: false, error: err.message || 'Server error.' });
    }
});

/* ── GET/PUT /api/calendar/ics-url — the Official calendar's secret iCal URL ── */
router.get('/ics-url', requireRole('admin'), async (req, res) => {
    try {
        res.json({ url: (await getSetting('official_ics_url')) || '' });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Server error.' });
    }
});
router.put('/ics-url', requireRole('admin'), async (req, res) => {
    try {
        const url = String(req.body?.url || '').trim();
        if (url && !/^https:\/\//i.test(url)) {
            return res.status(400).json({ error: 'Enter a full https:// iCal address (or leave blank to clear).' });
        }
        await setSetting('official_ics_url', url);
        res.json({ url });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Server error.' });
    }
});

/* ── GET /api/calendar/oauth/url — consent URL as JSON (admin, header-auth)
   Lets the Calendar page kick off the connect flow, since /oauth/start can't be
   reached by a plain browser navigation (it carries no auth header).           */
router.get('/oauth/url', requireRole('admin'), (req, res) => {
    const clientId    = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
    if (!clientId || !redirectUri) {
        return res.status(503).json({
            error: 'Google OAuth client not configured on the server. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_OAUTH_REDIRECT_URI in the server .env first.',
        });
    }
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id',     clientId);
    url.searchParams.set('redirect_uri',  redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope',         'https://www.googleapis.com/auth/calendar');
    url.searchParams.set('access_type',   'offline');
    url.searchParams.set('prompt',        'consent');
    return res.json({ url: url.toString() });
});

/* ── GET /api/calendar/oauth/start — visit once in browser to authorize ── */
router.get('/oauth/start', requireRole('admin'), (req, res) => {
    const clientId    = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
    if (!clientId)    return res.status(503).send('Set GOOGLE_CLIENT_ID in server .env first.');
    if (!redirectUri) return res.status(503).send('Set GOOGLE_OAUTH_REDIRECT_URI in server .env first.');

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id',     clientId);
    url.searchParams.set('redirect_uri',  redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope',         'https://www.googleapis.com/auth/calendar');
    url.searchParams.set('access_type',   'offline');
    url.searchParams.set('prompt',        'consent'); /* force refresh_token to be issued */
    res.redirect(url.toString());
});

/* ── GET /api/calendar/oauth/callback — Google redirects here with code ─ */
router.get('/oauth/callback', async (req, res) => {
    const { code, error } = req.query;
    if (error) return res.status(400).send(`Google denied access: ${error}`);
    if (!code)  return res.status(400).send('No authorization code received.');

    const clientId     = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri  = process.env.GOOGLE_OAUTH_REDIRECT_URI;

    try {
        const resp = await fetch('https://oauth2.googleapis.com/token', {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body:    new URLSearchParams({
                code,
                client_id:     clientId,
                client_secret: clientSecret,
                redirect_uri:  redirectUri,
                grant_type:    'authorization_code',
            }),
        });
        const data = await resp.json();
        if (!resp.ok) return res.status(400).send(`Token exchange failed: ${data.error_description || data.error}`);
        if (!data.refresh_token) return res.status(400).send('No refresh token returned — re-visit /api/calendar/oauth/start to retry.');

        res.send(`<!DOCTYPE html><html><head><title>Google Calendar Connected</title>
<style>body{font-family:sans-serif;background:#0d0d0d;color:#e0e0e0;padding:40px;max-width:640px;margin:auto}
pre{background:#111;border:1px solid #333;padding:16px;border-radius:8px;color:#4ade80;font-size:13px;word-break:break-all;white-space:pre-wrap}
h2{color:#4ade80}code{background:#1a1a1a;padding:2px 6px;border-radius:4px}</style></head>
<body>
<h2>✅ Google Calendar connected!</h2>
<p>Add this line to your server <code>.env</code> file:</p>
<pre>GOOGLE_REFRESH_TOKEN=${data.refresh_token}</pre>
<p>Then restart the server:</p>
<pre>pm2 restart phoenix-portal</pre>
<p style="color:#666;font-size:12px">Keep this token private — it grants write access to your Google Calendar.</p>
</body></html>`);
    } catch (err) {
        console.error('OAuth callback error:', err);
        res.status(500).send('OAuth callback failed — check server logs.');
    }
});

module.exports = router;
