const express = require('express');
const pool    = require('../db/pool');
const { requireRole } = require('../middleware/requireRole');

const router = express.Router();

/* Office origin for travel estimates. Override in server/.env. */
const OFFICE_ADDRESS = process.env.OFFICE_ADDRESS || '4001 E Broadway Rd 815, Phoenix, AZ';
/* Simple, no-cost estimate: straight-line distance × road-detour factor ÷ average
   speed. Geocoding is the free OpenStreetMap/Nominatim service (no key). Tune via env. */
const AVG_MPH = Number(process.env.TRAVEL_MPH || 32);       // effective drive speed
const DETOUR  = Number(process.env.TRAVEL_DETOUR || 1.3);   // straight-line → road miles
const GEO_UA  = 'PhoenixSecTechPortal/1.0 (internal timesheet travel estimate)';

const round2   = n => Math.round((Number(n) || 0) * 100) / 100;
const normAddr = a => String(a || '').replace(/\s+/g, ' ').trim();

/* Cache geocodes + computed distance so each unique address is looked up once
   (client addresses are stable, so a timesheet re-render costs no lookups). */
pool.query(`
    CREATE TABLE IF NOT EXISTS distance_cache (
        address     TEXT PRIMARY KEY,
        lat         NUMERIC,
        lng         NUMERIC,
        miles       NUMERIC,
        minutes     NUMERIC,
        status      TEXT,
        computed_at TIMESTAMP DEFAULT NOW()
    )
`).catch(() => {});
pool.query(`ALTER TABLE distance_cache ADD COLUMN IF NOT EXISTS lat NUMERIC`).catch(() => {});
pool.query(`ALTER TABLE distance_cache ADD COLUMN IF NOT EXISTS lng NUMERIC`).catch(() => {});

function haversineMiles(a, b) {
    const R = 3958.8, rad = d => d * Math.PI / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

let officeCoords;   // memoized office lat/lng across requests

/* Geocode an address to { lat, lng } via free OSM Nominatim, cached per address. */
async function coordsFor(addrRaw) {
    const addr = normAddr(addrRaw);
    if (!addr) return null;
    const hit = await pool.query('SELECT lat, lng FROM distance_cache WHERE address = $1 AND lat IS NOT NULL', [addr]).catch(() => null);
    if (hit && hit.rowCount) return { lat: Number(hit.rows[0].lat), lng: Number(hit.rows[0].lng) };
    if (typeof fetch !== 'function') return null;
    try {
        const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(addr);
        const j   = await (await fetch(url, { headers: { 'User-Agent': GEO_UA } })).json();
        const top = Array.isArray(j) && j[0];
        if (!top || top.lat == null) {
            await pool.query(
                `INSERT INTO distance_cache (address, status, computed_at) VALUES ($1, 'NOT_FOUND', NOW())
                 ON CONFLICT (address) DO UPDATE SET status = 'NOT_FOUND', computed_at = NOW()`, [addr]).catch(() => {});
            return null;
        }
        const c = { lat: Number(top.lat), lng: Number(top.lon) };
        await pool.query(
            `INSERT INTO distance_cache (address, lat, lng, computed_at) VALUES ($1, $2, $3, NOW())
             ON CONFLICT (address) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, computed_at = NOW()`,
            [addr, c.lat, c.lng]).catch(() => {});
        return c;
    } catch (e) {
        console.error('Geocode error:', e.message);
        return null;
    }
}

/* Estimated OFFICE → dest one-way { miles, minutes } (straight-line × detour ÷ speed),
   or null if either address can't be geocoded. Final result cached per dest address. */
async function officeDistance(destRaw) {
    const dest = normAddr(destRaw);
    if (!dest) return null;
    const hit = await pool.query('SELECT miles, minutes, status FROM distance_cache WHERE address = $1', [dest]).catch(() => null);
    if (hit && hit.rowCount && hit.rows[0].status === 'OK' && hit.rows[0].miles != null) {
        return { miles: Number(hit.rows[0].miles), minutes: Number(hit.rows[0].minutes) };
    }
    if (!officeCoords) officeCoords = await coordsFor(OFFICE_ADDRESS);
    if (!officeCoords) return null;
    const dc = await coordsFor(dest);
    if (!dc) return null;
    const miles   = haversineMiles(officeCoords, dc) * DETOUR;
    const minutes = (miles / AVG_MPH) * 60;
    await pool.query(
        `INSERT INTO distance_cache (address, lat, lng, miles, minutes, status, computed_at)
         VALUES ($1, $2, $3, $4, $5, 'OK', NOW())
         ON CONFLICT (address) DO UPDATE
           SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, miles = EXCLUDED.miles, minutes = EXCLUDED.minutes, status = 'OK', computed_at = NOW()`,
        [dest, dc.lat, dc.lng, miles, minutes]).catch(() => {});
    return { miles, minutes };
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
        res.json({ user_id: userId, start, end, office: OFFICE_ADDRESS, ...sheet });
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
        res.json({ start, end, staff: out });
    } catch (err) { console.error('timesheet summary error:', err); res.status(500).json({ error: 'Failed to build summary.' }); }
});

module.exports = router;
