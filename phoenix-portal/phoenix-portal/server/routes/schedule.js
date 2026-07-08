const express = require('express');
const pool    = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/requireRole');

const router = express.Router();

/* Time-off requests + per-day team notes for the internal Team Calendar
   (independent of the Google Calendar integration). */
pool.query(`
    CREATE TABLE IF NOT EXISTS time_off (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        start_date DATE NOT NULL,
        end_date   DATE NOT NULL,
        reason     TEXT,
        status     TEXT NOT NULL DEFAULT 'requested',   -- requested | approved | denied
        decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        decided_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
    )
`).catch(() => {});
pool.query(`
    CREATE TABLE IF NOT EXISTS calendar_notes (
        id         SERIAL PRIMARY KEY,
        note_date  DATE NOT NULL,
        user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        body       TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
    )
`).catch(() => {});
pool.query(`CREATE INDEX IF NOT EXISTS idx_time_off_dates ON time_off (start_date, end_date)`).catch(() => {});
pool.query(`CREATE INDEX IF NOT EXISTS idx_calendar_notes_date ON calendar_notes (note_date)`).catch(() => {});

/* Dates are returned as plain 'YYYY-MM-DD' text to avoid the driver's
   local-midnight Date objects shifting a day across timezones. */

/* GET /api/schedule/time-off?start=&end= — approved TO for everyone in the
   window, plus the caller's own requests (any status) so pending shows too. */
router.get('/time-off', authenticate, async (req, res) => {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'start and end are required.' });
    try {
        const r = await pool.query(`
            SELECT t.id, t.user_id, u.name AS user_name,
                   to_char(t.start_date, 'YYYY-MM-DD') AS start_date,
                   to_char(t.end_date,   'YYYY-MM-DD') AS end_date,
                   t.reason, t.status
            FROM time_off t JOIN users u ON u.id = t.user_id
            WHERE t.end_date >= $1::date AND t.start_date <= $2::date
              AND (t.status = 'approved' OR t.user_id = $3)
            ORDER BY t.start_date`,
            [start, end, req.user.id]);
        res.json(r.rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to load time off.' }); }
});

/* GET /api/schedule/time-off/pending — admin: all pending requests. */
router.get('/time-off/pending', requireRole('admin'), async (_req, res) => {
    try {
        const r = await pool.query(`
            SELECT t.id, t.user_id, u.name AS user_name,
                   to_char(t.start_date, 'YYYY-MM-DD') AS start_date,
                   to_char(t.end_date,   'YYYY-MM-DD') AS end_date,
                   t.reason, t.status, t.created_at
            FROM time_off t JOIN users u ON u.id = t.user_id
            WHERE t.status = 'requested'
            ORDER BY t.start_date, t.created_at`);
        res.json(r.rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to load requests.' }); }
});

/* POST /api/schedule/time-off { start_date, end_date?, reason? } — self request. */
router.post('/time-off', authenticate, async (req, res) => {
    const start = req.body.start_date;
    const end   = req.body.end_date || start;
    if (!start) return res.status(400).json({ error: 'start_date is required.' });
    if (end < start) return res.status(400).json({ error: 'End date is before the start date.' });
    try {
        const r = await pool.query(
            `INSERT INTO time_off (user_id, start_date, end_date, reason) VALUES ($1, $2, $3, $4) RETURNING id`,
            [req.user.id, start, end, (req.body.reason || '').trim() || null]);
        res.status(201).json({ id: r.rows[0].id });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to request time off.' }); }
});

/* PATCH /api/schedule/time-off/:id { status } — admin approve/deny. */
router.patch('/time-off/:id', requireRole('admin'), async (req, res) => {
    const status = req.body.status;
    if (!['approved', 'denied', 'requested'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    try {
        const r = await pool.query(
            `UPDATE time_off SET status = $1, decided_by = $2, decided_at = NOW() WHERE id = $3 RETURNING id`,
            [status, req.user.id, req.params.id]);
        if (!r.rowCount) return res.status(404).json({ error: 'Request not found.' });
        res.json({ id: Number(req.params.id), status });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to update request.' }); }
});

/* DELETE /api/schedule/time-off/:id — requester cancels own, or admin removes. */
router.delete('/time-off/:id', authenticate, async (req, res) => {
    const admin = req.user.role === 'admin';
    try {
        const r = await pool.query(
            `DELETE FROM time_off WHERE id = $1${admin ? '' : ' AND user_id = $2'} RETURNING id`,
            admin ? [req.params.id] : [req.params.id, req.user.id]);
        if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
        res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to delete.' }); }
});

/* GET /api/schedule/notes?start=&end= — per-day notes with author. */
router.get('/notes', authenticate, async (req, res) => {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'start and end are required.' });
    try {
        const r = await pool.query(`
            SELECT n.id, to_char(n.note_date, 'YYYY-MM-DD') AS note_date,
                   n.user_id, u.name AS author, n.body, n.created_at
            FROM calendar_notes n LEFT JOIN users u ON u.id = n.user_id
            WHERE n.note_date >= $1::date AND n.note_date <= $2::date
            ORDER BY n.created_at`,
            [start, end]);
        res.json(r.rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to load notes.' }); }
});

/* POST /api/schedule/notes { note_date, body } — any signed-in user. */
router.post('/notes', authenticate, async (req, res) => {
    const { note_date } = req.body;
    const body = (req.body.body || '').trim();
    if (!note_date || !body) return res.status(400).json({ error: 'note_date and body are required.' });
    try {
        const r = await pool.query(
            `INSERT INTO calendar_notes (note_date, user_id, body) VALUES ($1, $2, $3)
             RETURNING id, to_char(note_date, 'YYYY-MM-DD') AS note_date, user_id, body, created_at`,
            [note_date, req.user.id, body.slice(0, 2000)]);
        res.status(201).json({ ...r.rows[0], author: req.user.name });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to add note.' }); }
});

/* DELETE /api/schedule/notes/:id — author or admin. */
router.delete('/notes/:id', authenticate, async (req, res) => {
    const admin = req.user.role === 'admin';
    try {
        const r = await pool.query(
            `DELETE FROM calendar_notes WHERE id = $1${admin ? '' : ' AND user_id = $2'} RETURNING id`,
            admin ? [req.params.id] : [req.params.id, req.user.id]);
        if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
        res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to delete note.' }); }
});

module.exports = router;
