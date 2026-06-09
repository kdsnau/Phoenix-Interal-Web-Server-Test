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
        host       VARCHAR(255) NOT NULL DEFAULT 'localhost',
        port       INTEGER      NOT NULL DEFAULT 7001,
        use_https  BOOLEAN      NOT NULL DEFAULT TRUE,
        username   VARCHAR(100) NOT NULL DEFAULT '',
        password   VARCHAR(255) NOT NULL DEFAULT '',
        mock       BOOLEAN      NOT NULL DEFAULT FALSE,
        client_id  INTEGER REFERENCES clients(id) ON DELETE SET NULL,
        created_at TIMESTAMP    NOT NULL DEFAULT NOW()
    )
`).catch(console.error);
pool.query(`ALTER TABLE nvr_servers ADD COLUMN IF NOT EXISTS mock BOOLEAN NOT NULL DEFAULT FALSE`).catch(() => {});

/* ═══════════════════════════════════════════════════════════════════════
   MOCK DATA
   ═══════════════════════════════════════════════════════════════════════ */

const MOCK_DEVICES = [
    { id: 'mock-cam-01', name: 'Front Entrance',  model: 'DW-MD421D',   vendor: 'Digital Watchdog', status: 'Online',    isLicensed: true  },
    { id: 'mock-cam-02', name: 'Parking Lot A',   model: 'DW-MD421D',   vendor: 'Digital Watchdog', status: 'Recording', isLicensed: true  },
    { id: 'mock-cam-03', name: 'Server Room',     model: 'DW-PF5M1TIR', vendor: 'Digital Watchdog', status: 'Recording', isLicensed: true  },
    { id: 'mock-cam-04', name: 'Back Door',       model: 'DW-MD421D',   vendor: 'Digital Watchdog', status: 'Offline',   isLicensed: true  },
    { id: 'mock-cam-05', name: 'Reception',       model: 'DW-PF5M1TIR', vendor: 'Digital Watchdog', status: 'Online',    isLicensed: true  },
    { id: 'mock-cam-06', name: 'Loading Dock',    model: 'DW-MD421D',   vendor: 'Digital Watchdog', status: 'Offline',   isLicensed: false },
    { id: 'mock-cam-07', name: 'Side Gate',       model: 'DW-PF5M1TIR', vendor: 'Digital Watchdog', status: 'Online',    isLicensed: true  },
    { id: 'mock-cam-08', name: 'Break Room',      model: 'DW-MD421D',   vendor: 'Digital Watchdog', status: 'Recording', isLicensed: false },
];

const MOCK_LICENSES = [
    {
        id: 'mock-lic-01',
        key: 'MOCK-XXXX-XXXX-XXXX',
        type: 'permanent',
        channels: 6,
        usedChannels: 6,
        expirationDate: null,
        isValid: true,
    },
    {
        id: 'mock-lic-02',
        key: 'MOCK-TRIAL-XXXX',
        type: 'trial',
        channels: 4,
        usedChannels: 0,
        expirationDate: new Date(Date.now() + 14 * 86400000).toISOString(),
        isValid: true,
    },
];

function mockNow(offsetMs = 0) {
    return new Date(Date.now() - offsetMs).toISOString();
}

function mockEvents() {
    const m = 60000;
    return [
        { id: 'ev-01', eventType: 'motionDetected',    deviceId: 'mock-cam-01', deviceName: 'Front Entrance', description: 'Zone 1',        eventTimestampUsec: (Date.now() - 2  * m) * 1000 },
        { id: 'ev-02', eventType: 'cameraDisconnected', deviceId: 'mock-cam-04', deviceName: 'Back Door',      description: 'No signal',     eventTimestampUsec: (Date.now() - 15 * m) * 1000 },
        { id: 'ev-03', eventType: 'motionDetected',    deviceId: 'mock-cam-02', deviceName: 'Parking Lot A',  description: 'Zone 2',        eventTimestampUsec: (Date.now() - 22 * m) * 1000 },
        { id: 'ev-04', eventType: 'cameraReconnected', deviceId: 'mock-cam-06', deviceName: 'Loading Dock',   description: '',              eventTimestampUsec: (Date.now() - 60 * m) * 1000 },
        { id: 'ev-05', eventType: 'motionDetected',    deviceId: 'mock-cam-07', deviceName: 'Side Gate',      description: 'Zone 1',        eventTimestampUsec: (Date.now() - 90 * m) * 1000 },
        { id: 'ev-06', eventType: 'storageFailure',    deviceId: null,          deviceName: 'NVR Storage',    description: 'Drive 2 warn',  eventTimestampUsec: (Date.now() - 3  * 60 * m) * 1000 },
        { id: 'ev-07', eventType: 'cameraDisconnected', deviceId: 'mock-cam-06', deviceName: 'Loading Dock',  description: 'No signal',     eventTimestampUsec: (Date.now() - 5  * 60 * m) * 1000 },
        { id: 'ev-08', eventType: 'motionDetected',    deviceId: 'mock-cam-03', deviceName: 'Server Room',    description: 'Zone 1',        eventTimestampUsec: (Date.now() - 8  * 60 * m) * 1000 },
        { id: 'ev-09', eventType: 'serverStarted',     deviceId: null,          deviceName: 'NVR',            description: 'System boot',   eventTimestampUsec: (Date.now() - 24 * 60 * m) * 1000 },
        { id: 'ev-10', eventType: 'backupFinished',    deviceId: null,          deviceName: 'NVR',            description: 'Daily backup',  eventTimestampUsec: (Date.now() - 26 * 60 * m) * 1000 },
    ];
}

/** Return a simple dark SVG that looks like a camera placeholder with the camera name */
function mockSnapshotSvg(cameraName) {
    const label = (cameraName || 'CAMERA').toUpperCase().replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="#0d1117"/>
  <rect x="1" y="1" width="638" height="358" fill="none" stroke="#30363d" stroke-width="1"/>
  <text x="320" y="155" font-family="monospace" font-size="11" fill="#444" text-anchor="middle" letter-spacing="2">LIVE</text>
  <circle cx="320" cy="175" r="4" fill="#e05252" opacity="0.9"/>
  <text x="320" y="210" font-family="monospace" font-size="13" fill="#8b949e" text-anchor="middle">${label}</text>
  <text x="320" y="235" font-family="monospace" font-size="10" fill="#3d444d" text-anchor="middle">MOCK · DW SPECTRUM</text>
</svg>`;
    return Buffer.from(svg);
}

/* ═══════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════ */

async function getServer(id) {
    const r = await pool.query('SELECT * FROM nvr_servers WHERE id = $1', [id]);
    if (r.rowCount === 0) throw Object.assign(new Error('NVR server not found'), { status: 404 });
    return r.rows[0];
}

function nvrClient(server) {
    const proto   = server.use_https ? 'https' : 'http';
    const baseURL = `${proto}://${server.host}:${server.port}`;
    return axios.create({
        baseURL,
        timeout: 10000,
        auth: { username: server.username, password: server.password },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });
}

/* The real /rest/v2/devices objects carry ~100 fields each; trim to what the
   UI needs and normalise the license flag (real API uses isLicenseUsed,
   our mock uses isLicensed). */
function normalizeDevice(d) {
    return {
        id:         d.id,
        name:       d.name,
        model:      d.model,
        vendor:     d.vendor,
        status:     d.status,
        isLicensed: d.isLicensed ?? d.isLicenseUsed ?? null,
    };
}

/* DW returns licenses as { key, licenseBlock } where licenseBlock is a
   newline-delimited "NAME=...\nCOUNT=...\nEXPIRATION=..." text block. */
function parseLicenseBlock(block) {
    const out = {};
    (block || '').split('\n').forEach(line => {
        const i = line.indexOf('=');
        if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });
    return out;
}

function normalizeLicense(lic) {
    // Mock licenses already have the normalised shape — pass them through.
    if (lic.channels != null || lic.type) return lic;
    const info = parseLicenseBlock(lic.licenseBlock);
    return {
        key:            lic.key || info.SERIAL || null,
        type:           (info.CLASS || 'license').toLowerCase(),
        channels:       parseInt(info.COUNT, 10) || 0,
        usedChannels:   null,                       // DW doesn't report per-license usage
        expirationDate: info.EXPIRATION || null,    // empty = permanent
        isValid:        true,
    };
}

/* ═══════════════════════════════════════════════════════════════════════
   CRUD
   ═══════════════════════════════════════════════════════════════════════ */

router.get('/servers', async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT s.id, s.name, s.host, s.port, s.use_https, s.mock,
                    s.client_id, s.created_at, c.name AS client_name
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
    const { name, host, port, use_https, username, password, client_id, mock } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required.' });
    if (!mock && (!host || !username || !password))
        return res.status(400).json({ error: 'host, username, and password are required for non-mock systems.' });
    try {
        const r = await pool.query(
            `INSERT INTO nvr_servers (name, host, port, use_https, username, password, client_id, mock)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, name, host, port, use_https, mock, client_id, created_at`,
            [
                name.trim(),
                host?.trim() || 'localhost',
                port || 7001,
                use_https !== false,
                username || '',
                password || '',
                client_id || null,
                !!mock,
            ]
        );
        return res.status(201).json(r.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to create NVR server.' });
    }
});

router.patch('/servers/:id', requireRole('admin'), async (req, res) => {
    const { name, host, port, use_https, username, password, client_id, mock } = req.body;
    try {
        const r = await pool.query(
            `UPDATE nvr_servers SET
                name      = COALESCE($1, name),
                host      = COALESCE($2, host),
                port      = COALESCE($3, port),
                use_https = COALESCE($4, use_https),
                username  = COALESCE($5, username),
                password  = COALESCE($6, password),
                client_id = $7,
                mock      = COALESCE($8, mock)
             WHERE id = $9
             RETURNING id, name, host, port, use_https, mock, client_id, created_at`,
            [name || null, host || null, port || null, use_https ?? null,
             username || null, password || null, client_id || null, mock ?? null, req.params.id]
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

/* ═══════════════════════════════════════════════════════════════════════
   PROXY / MOCK ENDPOINTS
   ═══════════════════════════════════════════════════════════════════════ */

router.get('/servers/:id/ping', async (req, res) => {
    try {
        const server = await getServer(req.params.id);
        if (server.mock) {
            return res.json({ online: true, info: { name: server.name, version: 'mock', mock: true } });
        }
        const client = nvrClient(server);
        const { data } = await client.get('/rest/v2/system/info');
        return res.json({ online: true, info: data });
    } catch (err) {
        return res.json({ online: false, error: err.message });
    }
});

router.get('/servers/:id/devices', async (req, res) => {
    try {
        const server = await getServer(req.params.id);
        if (server.mock) return res.json(MOCK_DEVICES);
        const client = nvrClient(server);
        const { data } = await client.get('/rest/v2/devices');
        const list = Array.isArray(data) ? data : [];
        return res.json(list.map(normalizeDevice));
    } catch (err) {
        console.error('NVR devices error:', err.message);
        return res.status(502).json({ error: 'Could not reach NVR.', detail: err.message });
    }
});

router.get('/servers/:id/licenses', async (req, res) => {
    try {
        const server = await getServer(req.params.id);
        if (server.mock) return res.json(MOCK_LICENSES);
        const client = nvrClient(server);
        const { data } = await client.get('/rest/v2/licenses');
        const list = Array.isArray(data) ? data : [];
        return res.json(list.map(normalizeLicense));
    } catch (err) {
        console.error('NVR licenses error:', err.message);
        return res.status(502).json({ error: 'Could not fetch licenses.', detail: err.message });
    }
});

router.get('/servers/:id/mediaservers', async (req, res) => {
    try {
        const server = await getServer(req.params.id);
        if (server.mock) {
            return res.json([{ id: 'mock-srv-01', name: 'Mock NVR Server', status: 'Online', version: 'mock' }]);
        }
        const client = nvrClient(server);
        const { data } = await client.get('/rest/v2/servers');
        return res.json(data);
    } catch (err) {
        console.error('NVR servers error:', err.message);
        return res.status(502).json({ error: 'Could not reach NVR.', detail: err.message });
    }
});

router.get('/servers/:id/snapshot/:deviceId', async (req, res) => {
    try {
        const server = await getServer(req.params.id);
        if (server.mock) {
            const cam  = MOCK_DEVICES.find(d => d.id === req.params.deviceId);
            const svg  = mockSnapshotSvg(cam?.name || req.params.deviceId);
            res.setHeader('Content-Type', 'image/svg+xml');
            res.setHeader('Cache-Control', 'no-cache');
            return res.send(svg);
        }
        const client   = nvrClient(server);
        const response = await client.get('/ec2/cameraThumbnail', {
            responseType: 'stream',
            params: { cameraId: req.params.deviceId, time: 'latest', height: 480 },
        });
        res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
        response.data.pipe(res);
    } catch (err) {
        console.error('NVR snapshot error:', err.message);
        return res.status(502).json({ error: 'Snapshot unavailable.' });
    }
});

router.get('/servers/:id/events', async (req, res) => {
    try {
        const server = await getServer(req.params.id);
        if (server.mock) return res.json(mockEvents());
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
