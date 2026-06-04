const express = require('express');
const pool    = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/requireRole');

const router = express.Router();

pool.query(`
    CREATE TABLE IF NOT EXISTS admin_posts (
        id          SERIAL       PRIMARY KEY,
        content     TEXT         NOT NULL,
        author_id   INT          REFERENCES users(id) ON DELETE SET NULL,
        author_name VARCHAR(100),
        created_at  TIMESTAMP    DEFAULT NOW()
    )
`).catch(err => console.error('admin_posts table init:', err.message));

/* GET /api/posts — all users */
router.get('/', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM admin_posts ORDER BY created_at DESC LIMIT 100'
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch posts.' });
    }
});

/* POST /api/posts — admin only */
router.post('/', requireRole('admin'), async (req, res) => {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'content is required.' });
    try {
        const result = await pool.query(
            `INSERT INTO admin_posts (content, author_id, author_name)
             VALUES ($1, $2, $3) RETURNING *`,
            [content.trim(), req.user.id, req.user.name]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create post.' });
    }
});

/* DELETE /api/posts/:id — admin only */
router.delete('/:id', requireRole('admin'), async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM admin_posts WHERE id = $1 RETURNING id',
            [req.params.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Post not found.' });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete post.' });
    }
});

module.exports = router;
