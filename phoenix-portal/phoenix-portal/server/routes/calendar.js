const express  = require('express');
const router   = express.Router();
const pool     = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/requireRole');

const GCAL = 'https://www.googleapis.com/calendar/v3/calendars';

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

/* ── Helpers ──────────────────────────────────────────────────────────── */
function parseEventStart(e) {
    const raw = e.start?.dateTime || e.start?.date;
    return raw ? new Date(raw) : null;
}

function parseEventEnd(e) {
    const raw = e.end?.dateTime || e.end?.date;
    return raw ? new Date(raw) : null;
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

/* ── POST /api/calendar/sync  — pull events → upsert as tickets ────────── */
router.post('/sync', requireRole('admin', 'technician'), async (req, res) => {
    const calId = process.env.GOOGLE_CALENDAR_ID;
    const key   = process.env.GOOGLE_API_KEY;
    if (!calId || !key) return res.status(503).json({ error: 'Google Calendar not configured. Add GOOGLE_CALENDAR_ID and GOOGLE_API_KEY to server .env.', unconfigured: true });

    /* Fetch upcoming 90 days */
    const now    = new Date();
    const future = new Date(now.getFullYear(), now.getMonth() + 3, now.getDate());

    const url = [
        `${GCAL}/${encodeURIComponent(calId)}/events`,
        `?key=${key}`,
        `&timeMin=${encodeURIComponent(now.toISOString())}`,
        `&timeMax=${encodeURIComponent(future.toISOString())}`,
        `&orderBy=startTime&singleEvents=true&maxResults=250`,
    ].join('');

    let gEvents;
    try {
        const gRes = await fetch(url);
        const body = await gRes.json();
        if (!gRes.ok) return res.status(gRes.status).json({ error: body?.error?.message || 'Google API error' });
        gEvents = body.items || [];
    } catch (err) {
        return res.status(500).json({ error: 'Failed to reach Google Calendar API.' });
    }

    let created = 0, updated = 0;

    for (const e of gEvents) {
        if (!e.id || !e.summary) continue;   /* skip events with no title */

        const title    = e.summary;
        const desc     = buildDescription(e);
        const start    = parseEventStart(e);
        const end      = parseEventEnd(e);
        const location = e.location || null;

        /* Check for existing ticket */
        const existing = await pool.query(
            `SELECT id FROM service_tickets WHERE google_event_id = $1`,
            [e.id]
        ).catch(() => ({ rows: [] }));

        if (existing.rows.length > 0) {
            /* Update title / description / timing — never touch status */
            await pool.query(
                `UPDATE service_tickets
                 SET title = $1, description = $2, event_start = $3, event_end = $4, event_location = $5
                 WHERE google_event_id = $6`,
                [title, desc, start, end, location, e.id]
            );
            updated++;
        } else {
            /* Create new ticket */
            await pool.query(
                `INSERT INTO service_tickets
                 (title, description, created_by, source, google_event_id, event_start, event_end, event_location, status)
                 VALUES ($1, $2, $3, 'calendar', $4, $5, $6, $7, 'open')`,
                [title, desc, req.user.id, e.id, start, end, location]
            );
            created++;
        }
    }

    res.json({ created, updated, total: gEvents.length });
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
