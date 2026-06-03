const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/requireRole');

const GCAL = 'https://www.googleapis.com/calendar/v3/calendars';

/* -----------------------------------------------------------------------
   GET /api/calendar/events?year=2026&month=5
   Proxies Google Calendar API so the API key never reaches the browser.
   Fetches events for the requested month (±1 day buffer each side).

   Required env vars:
     GOOGLE_CALENDAR_ID  — e.g. yourcompany@gmail.com
     GOOGLE_API_KEY      — restricted to Google Calendar API
   ----------------------------------------------------------------------- */
router.get('/events', authenticate, async (req, res) => {
    const calId = process.env.GOOGLE_CALENDAR_ID;
    const key   = process.env.GOOGLE_API_KEY;

    if (!calId || !key) {
        return res.status(503).json({
            error: 'Google Calendar is not configured. Add GOOGLE_CALENDAR_ID and GOOGLE_API_KEY to the server .env file.',
            unconfigured: true,
        });
    }

    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth();   /* 0-indexed */

    const timeMin = new Date(year, month,      1).toISOString();
    const timeMax = new Date(year, month + 1,  1).toISOString();

    const url = [
        `${GCAL}/${encodeURIComponent(calId)}/events`,
        `?key=${key}`,
        `&timeMin=${encodeURIComponent(timeMin)}`,
        `&timeMax=${encodeURIComponent(timeMax)}`,
        `&orderBy=startTime`,
        `&singleEvents=true`,
        `&maxResults=250`,
    ].join('');

    try {
        const gRes = await fetch(url);
        const body = await gRes.json();

        if (!gRes.ok) {
            const msg = body?.error?.message || `Google API error ${gRes.status}`;
            return res.status(gRes.status).json({ error: msg });
        }

        res.json(body.items || []);
    } catch (err) {
        console.error('Calendar fetch error:', err.message);
        res.status(500).json({ error: 'Failed to reach Google Calendar API.' });
    }
});

module.exports = router;
