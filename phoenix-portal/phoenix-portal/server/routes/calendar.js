const express  = require('express');
const router   = express.Router();
const pool     = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/requireRole');

const GCAL = 'https://www.googleapis.com/calendar/v3/calendars';

/* ── Schema migrations ────────────────────────────────────────────────── */
pool.query(`ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS source         TEXT      DEFAULT 'manual'`).catch(() => {});
pool.query(`ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS google_event_id TEXT`).catch(() => {});
pool.query(`ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS event_start     TIMESTAMP`).catch(() => {});
pool.query(`ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS event_location  TEXT`).catch(() => {});
/* Unique index on google_event_id (ignoring NULLs so manual tickets don't conflict) */
pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uix_tickets_google_event_id
            ON service_tickets(google_event_id)
            WHERE google_event_id IS NOT NULL`).catch(() => {});

/* ── Helpers ──────────────────────────────────────────────────────────── */
function parseEventStart(e) {
    const raw = e.start?.dateTime || e.start?.date;
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
                 SET title = $1, description = $2, event_start = $3, event_location = $4
                 WHERE google_event_id = $5`,
                [title, desc, start, location, e.id]
            );
            updated++;
        } else {
            /* Create new ticket */
            await pool.query(
                `INSERT INTO service_tickets
                 (title, description, created_by, source, google_event_id, event_start, event_location, status)
                 VALUES ($1, $2, $3, 'calendar', $4, $5, $6, 'open')`,
                [title, desc, req.user.id, e.id, start, location]
            );
            created++;
        }
    }

    res.json({ created, updated, total: gEvents.length });
});

module.exports = router;
