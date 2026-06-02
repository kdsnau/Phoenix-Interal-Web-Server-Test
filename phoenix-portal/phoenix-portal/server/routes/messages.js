const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { authenticate } = require('../middleware/requireRole');

/* Create table on first start */
pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
        id         SERIAL PRIMARY KEY,
        from_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        to_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body       TEXT    NOT NULL,
        read       BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
    )
`).catch(err => console.error('messages table init:', err.message));

/* -----------------------------------------------------------------------
   GET /users  — all users except self, for search/autocomplete
   ----------------------------------------------------------------------- */
router.get('/users', authenticate, async (req, res) => {
    const { rows } = await pool.query(
        `SELECT id, name, email, role FROM users WHERE id != $1 ORDER BY name`,
        [req.user.id]
    );
    res.json(rows);
});

/* -----------------------------------------------------------------------
   GET /unread  — total unread count for current user (nav badge)
   ----------------------------------------------------------------------- */
router.get('/unread', authenticate, async (req, res) => {
    const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS count FROM messages WHERE to_id = $1 AND read = FALSE`,
        [req.user.id]
    );
    res.json({ count: rows[0].count });
});

/* -----------------------------------------------------------------------
   GET /inbox  — conversation list with last message + unread count
   ----------------------------------------------------------------------- */
router.get('/inbox', authenticate, async (req, res) => {
    const uid = req.user.id;
    const { rows } = await pool.query(`
        SELECT
            t.other_id,
            u.name  AS other_name,
            u.role  AS other_role,
            t.last_body,
            t.last_at,
            t.unread_count::int
        FROM (
            SELECT
                CASE WHEN from_id = $1 THEN to_id ELSE from_id END AS other_id,
                (array_agg(body ORDER BY created_at DESC))[1]       AS last_body,
                MAX(created_at)                                      AS last_at,
                COUNT(*) FILTER (WHERE to_id = $1 AND read = FALSE)  AS unread_count
            FROM messages
            WHERE from_id = $1 OR to_id = $1
            GROUP BY CASE WHEN from_id = $1 THEN to_id ELSE from_id END
        ) t
        JOIN users u ON u.id = t.other_id
        ORDER BY t.last_at DESC
    `, [uid]);
    res.json(rows);
});

/* -----------------------------------------------------------------------
   GET /thread/:userId  — full message history between two users
   ----------------------------------------------------------------------- */
router.get('/thread/:userId', authenticate, async (req, res) => {
    const uid   = req.user.id;
    const other = Number(req.params.userId);
    const { rows } = await pool.query(`
        SELECT m.id, m.from_id, m.to_id, m.body, m.read, m.created_at,
               u.name AS from_name, u.role AS from_role
        FROM messages m
        JOIN users u ON u.id = m.from_id
        WHERE (m.from_id = $1 AND m.to_id = $2)
           OR (m.from_id = $2 AND m.to_id = $1)
        ORDER BY m.created_at ASC
    `, [uid, other]);
    res.json(rows);
});

/* -----------------------------------------------------------------------
   POST /  — send a message  { to_id, body }
   ----------------------------------------------------------------------- */
router.post('/', authenticate, async (req, res) => {
    const { to_id, body } = req.body;
    if (!to_id || !body?.trim())
        return res.status(400).json({ error: 'to_id and body are required.' });
    if (Number(to_id) === req.user.id)
        return res.status(400).json({ error: 'Cannot message yourself.' });

    const check = await pool.query('SELECT id FROM users WHERE id = $1', [to_id]);
    if (check.rows.length === 0)
        return res.status(404).json({ error: 'Recipient not found.' });

    const { rows } = await pool.query(
        `INSERT INTO messages (from_id, to_id, body) VALUES ($1, $2, $3) RETURNING *`,
        [req.user.id, to_id, body.trim()]
    );
    res.json(rows[0]);
});

/* -----------------------------------------------------------------------
   PATCH /read/:userId  — mark all messages from userId as read
   ----------------------------------------------------------------------- */
router.patch('/read/:userId', authenticate, async (req, res) => {
    await pool.query(
        `UPDATE messages SET read = TRUE
         WHERE from_id = $1 AND to_id = $2 AND read = FALSE`,
        [req.params.userId, req.user.id]
    );
    res.json({ ok: true });
});

module.exports = router;
