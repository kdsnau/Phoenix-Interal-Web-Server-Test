const express = require('express');
const https   = require('https');
const axios   = require('axios');
const pool    = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/requireRole');

const router = express.Router();
router.use(authenticate);

/* ── DB migration ─────────────────────────────────────────────────────── */
pool.query(`
    CREATE TABLE IF NOT EXISTS nvr_servers (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(100) NOT NULL,
        host       VARCHAR(255) NOT NULL,
        port       INTEGER      NOT NULL DEFAULT 7001,
        use_https  BOOLEAN      NOT NULL DEFAULT TRUE,
        username   VARCHAR(100) NOT NULL,
        password   VARCHAR(255) NOT NULL,
        client_id  INTEGER REFERENCES clients(id) ON DELETE SET NULL,
        created_at TIMESTAMP    NOT NULL DEFAULT NOW()
    )
`).catch(console.error);

/* ── Helpers ──────────────────────────────────────────────────────────── */

/** Fetch server row (with credentials). Never return password to the client. */
async function getServer(id) {
    const r = await pool.query('SELECT * FROM nvr_servers WHERE id = $1', [id]);
    if (r.rowCount === 0) throw Object.assign(new Error('NVR server not found'), { status: 404 });
    return r.rows[0];
}

/** Build an axios instance pre-configured for a given NVR server. */
function nvrClient(server) {
    const proto   = server.use_https ? 'https' : 'http';
    const baseURL = `${proto}://${server.host}:${server.port}`;
    return axios.create({
        baseURL,
        timeout: 10000,
        auth: { username: server.username, password: server.password },
        /* Allow self-signed certs — common on NVR appliances */
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });
}

/** Strip password before sending server data to the client. */
function safe(server) {
    const { password, ...rest } = server;   // eslint-disable-line no-unused-vars
    return rest;
}

/* ── CRUD: NVR servers ────────────────────────────────────────────────── */

router.get('/servers', async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT s.id, s.name, s.host, s.port, s.use_https, s.client_id,
                    s.created_at, c.name AS client_name
             FROM nvr_servers s
             LEFT JOIN clients c ON c.id = s.client_id
             ORDER BY s.name`
        );
        return res.json(r.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

router.post('/servers', requireRole('admin'), async (req, res) => {
    const { name, host, port, use_https, username, password, client_id } = req.body;
    if (!name || !host || !username || !password)
        return res.status(400).json({ error: 'name, host, username, and password are required.' });
    try {
        const r = await pool.query(
            `INSERT INTO nvr_servers (name, host, port, use_https, username, password, client_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, name, host, port, use_https, client_id, created_at`,
            [name.trim(), host.trim(), port || 7001, use_https !== false, username, password, client_id || null]
        );
        return res.status(201).json(r.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to create NVR server.' });
    }
});

router.patch('/servers/:id', requireRole('admin'), async (req, res) => {
    const { name, host, port, use_https, username, password, client_id } = req.body;
    try {
        const r = await pool.query(
            `UPDATE nvr_servers SET
                name      = COALESCE($1, name),
                host      = COALESCE($2, host),
                port      = COALESCE($3, port),
                use_https = COALESCE($4, use_https),
                username  = COALESCE($5, username),
                password  = COALESCE($6, password),
                client_id = $7
             WHERE id = $8
             RETURNING id, name, host, port, use_https, client_id, created_at`,
            [name || null, host || null, port || null, use_https ?? null,
             username || null, password || null, client_id || null, req.params.id]
        );
        if (r.rowCount === 0) return res.status(404).json({ error: 'Not found.' });
        return res.json(r.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to update NVR server.' });
    }
});

router.delete('/servers/:id', requireRole('admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM nvr_servers WHERE id = $1', [req.params.id]);
        return res.json({ success: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to delete NVR server.' });
    }
});

/* ── Proxy: DW Spectrum API ───────────────────────────────────────────── */

/**
 * GET /api/nvr/servers/:id/ping
 * Quick reachability check — returns { online, version? }
 */
router.get('/servers/:id/ping', async (req, res) => {
    try {
        const server = await getServer(req.params.id);
        const client = nvrClient(server);
        const { data } = await client.get('/rest/v2/system/info');
        return res.json({ online: true, info: data });
    } catch (err) {
        return res.json({ online: false, error: err.message });
    }
});

/**
 * GET /api/nvr/servers/:id/devices
 * List all cameras / devices on this NVR.
 */
router.get('/servers/:id/devices', async (req, res) => {
    try {
        const server = await getServer(req.params.id);
        const client = nvrClient(server);
        const { data } = await client.get('/rest/v2/devices', {
            params: { _with: 'status' },
        });
        return res.json(data);
    } catch (err) {
        console.error('NVR devices error:', err.message);
        return res.status(502).json({ error: 'Could not reach NVR.', detail: err.message });
    }
});

/**
 * GET /api/nvr/servers/:id/servers
 * List media servers registered in this system.
 */
router.get('/servers/:id/mediaservers', async (req, res) => {
    try {
        const server = await getServer(req.params.id);
        const client = nvrClient(server);
        const { data } = await client.get('/rest/v2/servers');
        return res.json(data);
    } catch (err) {
        console.error('NVR servers error:', err.message);
        return res.status(502).json({ error: 'Could not reach NVR.', detail: err.message });
    }
});

/**
 * GET /api/nvr/servers/:id/snapshot/:deviceId
 * Proxy a live snapshot image from a camera.
 * Streams the image bytes directly to the browser.
 */
router.get('/servers/:id/snapshot/:deviceId', async (req, res) => {
    try {
        const server = await getServer(req.params.id);
        const client = nvrClient(server);
        const response = await client.get(
            `/rest/v2/devices/${req.params.deviceId}/media/snapshot`,
            { responseType: 'stream', params: { width: 640 } }
        );
        res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
        response.data.pipe(res);
    } catch (err) {
        console.error('NVR snapshot error:', err.message);
        return res.status(502).json({ error: 'Snapshot unavailable.' });
    }
});

/**
 * GET /api/nvr/servers/:id/events
 * Recent events from this NVR system.
 */
router.get('/servers/:id/events', async (req, res) => {
    try {
        const server = await getServer(req.params.id);
        const client = nvrClient(server);
        const { data } = await client.get('/rest/v2/events/log', {
            params: { limit: req.query.limit || 50 },
        });
        return res.json(data);
    } catch (err) {
        console.error('NVR events error:', err.message);
        return res.status(502).json({ error: 'Could not fetch events.', detail: err.message });
    }
});

module.exports = router;
