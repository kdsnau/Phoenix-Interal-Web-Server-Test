const express = require('express');
const pool    = require('../db/pool');
const { requireRole } = require('../middleware/requireRole');

const router = express.Router();

/* Office origin for travel estimates. Override in server/.env. */
const OFFICE_ADDRESS = process.env.OFFICE_ADDRESS || '4001 E Broadway Rd 815, Phoenix, AZ';
const mapsKey = () => process.env.GOOGLE_MAPS_API_KEY || '';

const round2   = n => Math.round((Number(n) || 0) * 100) / 100;
const normAddr = a => String(a || '').replace(/\s+/g, ' ').trim();

/* Cache office→address distance so Google is called once per unique address
   (client addresses are stable, so a timesheet re-render costs no API calls). */
pool.query(`
    CREATE TABLE IF NOT EXISTS distance_cache (
        address     TEXT PRIMARY KEY,
        miles       NUMERIC,
        minutes     NUMERIC,
        status      TEXT,
        computed_at TIMESTAMP DEFAULT NOW()
    )
`).catch(() => {});

/* Google Distance Matrix: OFFICE → dest. Returns { miles, minutes } (one-way)
   or null (no key / geocode failure). Caches OK results in distance_cache. */
async function officeDistance(destRaw) {
    const dest = normAddr(destRaw);
    if (!dest) return null;

    const hit = await pool.query('SELECT miles, minutes, status FROM distance_cache WHERE address = $1', [dest]).catch(() => null);
    if (hit && hit.rowCount && hit.rows[0].status === 'OK') {
        return { miles: Number(hit.rows[0].miles), minutes: Number(hit.rows[0].minutes) };
    }

    const key = mapsKey();
    if (!key || typeof fetch !== 'function') return null;
    try {
        const url = 'https://maps.googleapis.com/maps/api/distancematrix/json?units=imperial'
            + `&origins=${encodeURIComponent(OFFICE_ADDRESS)}`
            + `&destinations=${encodeURIComponent(dest)}&key=${key}`;
        const j  = await (await fetch(url)).json();
        const el = j && j.rows && j.rows[0] && j.rows[0].elements && j.rows[0].elements[0];
        const status = (el && el.status) || j.status || 'UNKNOWN';
        if (!el || status !== 'OK') {
            await pool.query(
                `INSERT INTO distance_cache (address, status, computed_at) VALUES ($1, $2, NOW())
                 ON CONFLICT (address) DO UPDATE SET status = EXCLUDED.status, computed_at = NOW()`,
                [dest, status]
            ).catch(() => {});
            return null;
        }
        const miles   = el.distance.value / 1609.344;
        const minutes = el.duration.value / 60;
        await pool.query(
            `INSERT INTO distance_cache (address, miles, minutes, status, computed_at)
             VALUES ($1, $2, $3, 'OK', NOW())
             ON CONFLICT (address) DO UPDATE
               SET miles = EXCLUDED.miles, minutes = EXCLUDED.minutes, status = 'OK', computed_at = NOW()`,
            [dest, miles, minutes]
        ).catch(() => {});
        return { miles, minutes };
    } catch (e) {
        console.error('Distance Matrix error:', e.message);
        return null;
    }
}

/* Estimated timesheet for one user over [start, end] (inclusive dates).
   Per completed, scheduled ticket: on-site = entry→departure; travel =
   round-trip office↔location drive time counted once. */
async function buildTimesheet(userId, start, end) {
    const r = await pool.query(`
        SELECT st.id, st.title, st.event_start, st.event_end, st.event_location,
               c.name AS client_name, c.site_address,
               EXTRACT(EPOCH FROM (st.event_end - st.event_start)) / 3600.0 AS onsite_hours
        FROM service_tickets st
        LEFT JOIN clients c ON c.id = st.client_id
        WHERE $1::int = ANY(st.assignee_ids)
          AND st.status IN ('resolved', 'closed')
          AND st.event_start IS NOT NULL AND st.event_end IS NOT NULL
          AND st.event_end > st.event_start
          AND st.event_end >= $2::date AND st.event_end < ($3::date + 1)
        ORDER BY st.event_start
    `, [userId, start, end]);

    const rows = [];
    let totOnsite = 0, totTravel = 0;
    for (const t of r.rows) {
        const dest   = normAddr(t.event_location) || normAddr(t.site_address);
        const dist   = dest ? await officeDistance(dest) : null;
        const onsite = Number(t.onsite_hours) || 0;
        const travelHours = dist ? (dist.minutes * 2) / 60 : null;   // round trip
        totOnsite += onsite;
        totTravel += travelHours || 0;
        rows.push({
            id: t.id,
            title: t.title,
            date: t.event_start,
            client: t.client_name,
            location: dest || null,
            onsite_hours: round2(onsite),
            travel_miles: dist ? round2(dist.miles * 2) : null,
            travel_hours: travelHours != null ? round2(travelHours) : null,
            total_hours:  round2(onsite + (travelHours || 0)),
            distance_ok:  !!dist,
        });
    }
    return {
        rows,
        totals: {
            onsite_hours: round2(totOnsite),
            travel_hours: round2(totTravel),
            total_hours:  round2(totOnsite + totTravel),
        },
    };
}

/* GET /api/timesheets/staff — people who can hold a timesheet. */
router.get('/staff', requireRole('accounting', 'admin'), async (_req, res) => {
    try {
        const r = await pool.query(
            "SELECT id, name FROM users WHERE role = 'technician' OR assignable = TRUE ORDER BY name"
        );
        res.json(r.rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to load staff.' }); }
});

/* GET /api/timesheets?user_id=&start=&end= — one person's estimated sheet. */
router.get('/', requireRole('accounting', 'admin'), async (req, res) => {
    const userId = Number(req.query.user_id);
    const { start, end } = req.query;
    if (!userId || !start || !end) return res.status(400).json({ error: 'user_id, start and end are required.' });
    try {
        const sheet = await buildTimesheet(userId, start, end);
        res.json({ user_id: userId, start, end, office: OFFICE_ADDRESS, maps_configured: !!mapsKey(), ...sheet });
    } catch (err) { console.error('timesheet error:', err); res.status(500).json({ error: 'Failed to build timesheet.' }); }
});

/* GET /api/timesheets/summary?start=&end= — totals for everyone with hours. */
router.get('/summary', requireRole('accounting', 'admin'), async (req, res) => {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'start and end are required.' });
    try {
        const staff = await pool.query("SELECT id, name FROM users WHERE role = 'technician' OR assignable = TRUE ORDER BY name");
        const out = [];
        for (const u of staff.rows) {
            const sheet = await buildTimesheet(u.id, start, end);
            if (sheet.rows.length) out.push({ user_id: u.id, name: u.name, tickets: sheet.rows.length, ...sheet.totals });
        }
        out.sort((a, b) => b.total_hours - a.total_hours);
        res.json({ start, end, maps_configured: !!mapsKey(), staff: out });
    } catch (err) { console.error('timesheet summary error:', err); res.status(500).json({ error: 'Failed to build summary.' }); }
});

module.exports = router;
