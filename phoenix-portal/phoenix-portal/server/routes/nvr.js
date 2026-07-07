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
/* DW Spectrum Cloud relay connection support */
pool.query(`ALTER TABLE nvr_servers ADD COLUMN IF NOT EXISTS conn_type       VARCHAR(10)  NOT NULL DEFAULT 'direct'`).catch(() => {});
pool.query(`ALTER TABLE nvr_servers ADD COLUMN IF NOT EXISTS cloud_system_id VARCHAR(100) NOT NULL DEFAULT ''`).catch(() => {});
pool.query(`ALTER TABLE nvr_servers ADD COLUMN IF NOT EXISTS cloud_host      VARCHAR(255) NOT NULL DEFAULT 'https://dwspectrum.digital-watchdog.com'`).catch(() => {});
pool.query(`ALTER TABLE nvr_servers ADD COLUMN IF NOT EXISTS cloud_user      VARCHAR(255) NOT NULL DEFAULT ''`).catch(() => {});
pool.query(`ALTER TABLE nvr_servers ADD COLUMN IF NOT EXISTS cloud_password  VARCHAR(255) NOT NULL DEFAULT ''`).catch(() => {});

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

/* ── Cloud (DW Spectrum Cloud) bearer-token cache ───────────────────────
   Cloud-relay systems authenticate with an OAuth2 bearer token from the
   cloud, cached per server and refreshed ~30s before expiry. */
const cloudTokens = new Map();   // serverId -> { token, expiresAt }

async function getCloudToken(server, force = false) {
    const cached = cloudTokens.get(server.id);
    if (!force && cached && cached.expiresAt > Date.now() + 30000) return cached.token;
    const host = (server.cloud_host || 'https://dwspectrum.digital-watchdog.com').replace(/\/+$/, '');
    const { data } = await axios.post(`${host}/cdb/oauth2/token`, {
        grant_type:    'password',
        response_type: 'token',
        client_id:     '3rdParty',
        username:      server.cloud_user,
        password:      server.cloud_password,
        scope:         `cloudSystemId=${server.cloud_system_id}`,
    }, { timeout: 12000 });
    if (!data.access_token) throw new Error('Cloud auth returned no token');
    cloudTokens.set(server.id, {
        token:     data.access_token,
        expiresAt: Date.now() + (Number(data.expires_in || 3600) * 1000),
    });
    return data.access_token;
}

/* Build an axios client for a server: a direct host:port connection (Basic
   auth) or a DW Spectrum Cloud relay connection (Bearer token). */
async function getClient(server) {
    if (server.conn_type === 'cloud') {
        const token = await getCloudToken(server);
        return axios.create({
            baseURL: `https://${server.cloud_system_id}.relay.vmsproxy.com`,
            timeout: 15000,
            headers: { Authorization: `Bearer ${token}` },
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
            maxRedirects: 5,
            // The relay can redirect; re-attach auth so it survives the hop.
            beforeRedirect: (options) => {
                options.headers = { ...options.headers, Authorization: `Bearer ${token}` };
            },
        });
    }
    const proto = server.use_https ? 'https' : 'http';
    return axios.create({
        baseURL: `${proto}://${server.host}:${server.port}`,
        timeout: 10000,
        auth: { username: server.username, password: server.password },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });
}

/* Single request entry point with retry. Cloud relay tunnels can cold-start
   (the first request after idle fails) and tokens can expire early, so retry
   network errors and 401s (forcing a fresh token); don't retry other 4xx. */
async function nvrRequest(server, config, attempts = 3) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            const client = await getClient(server);
            return await client.request(config);
        } catch (err) {
            lastErr = err;
            const status = err.response?.status;
            if (status && status >= 400 && status < 500) {
                if (status === 401 && server.conn_type === 'cloud') {
                    cloudTokens.delete(server.id);   // force re-auth on next attempt
                } else {
                    break;                            // other 4xx won't be fixed by retrying
                }
            }
            if (i < attempts - 1) await new Promise(r => setTimeout(r, 400 * (i + 1)));
        }
    }
    throw lastErr;
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

/* Fetch the raw license list. Tries the modern REST path, then the legacy ec2
   path — the portal-api user can often read /ec2/getLicenses when
   /rest/v2/licenses returns 403 (permissions) or 404 (older build). */
async function fetchLicensesRaw(server) {
    let lastErr;
    for (const url of ['/rest/v2/licenses', '/ec2/getLicenses']) {
        try {
            const { data } = await nvrRequest(server, { method: 'get', url });
            if (Array.isArray(data))          return data;
            if (Array.isArray(data?.licenses)) return data.licenses;
            if (Array.isArray(data?.reply))    return data.reply;
            return [];
        } catch (err) {
            lastErr = err;
            const s = err.response?.status;
            if (s !== 403 && s !== 404) throw err;   // only fall through on perm/not-found
        }
    }
    throw lastErr;
}

/* DW /api/getEvents returns { reply: [ { eventParams: {...}, actionType, ... } ] }.
   Flatten eventParams into the shape the Cameras EventsLog expects; the camera
   name is resolved client-side from eventResourceId via the device list. */
function normalizeEvent(ev, i) {
    const p = ev.eventParams || {};
    return {
        id:                 p.eventResourceId ? `${p.eventResourceId}-${p.eventTimestampUsec}` : `ev-${i}`,
        eventType:          p.eventType,
        deviceId:           p.eventResourceId || null,
        deviceName:         p.resourceName || p.caption || null,
        description:        p.caption || p.description || p.reasonCode || '',
        eventTimestampUsec: Number(p.eventTimestampUsec) || null,
    };
}

/* ═══════════════════════════════════════════════════════════════════════
   CRUD
   ═══════════════════════════════════════════════════════════════════════ */

router.get('/servers', async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT s.id, s.name, s.host, s.port, s.use_https, s.mock,
                    s.conn_type, s.cloud_system_id, s.cloud_host, s.cloud_user,
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
    const { name, host, port, use_https, username, password, client_id, mock,
            conn_type, cloud_system_id, cloud_host, cloud_user, cloud_password } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required.' });
    const type = conn_type === 'cloud' ? 'cloud' : 'direct';
    if (!mock && type === 'cloud' && (!cloud_system_id || !cloud_user || !cloud_password))
        return res.status(400).json({ error: 'cloud system ID, user, and password are required for cloud systems.' });
    if (!mock && type === 'direct' && (!host || !username || !password))
        return res.status(400).json({ error: 'host, username, and password are required for direct systems.' });
    try {
        const r = await pool.query(
            `INSERT INTO nvr_servers
                (name, host, port, use_https, username, password, client_id, mock,
                 conn_type, cloud_system_id, cloud_host, cloud_user, cloud_password)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             RETURNING id, name, host, port, use_https, mock, conn_type,
                       cloud_system_id, cloud_host, cloud_user, client_id, created_at`,
            [
                name.trim(),
                host?.trim() || 'localhost',
                port || 7001,
                use_https !== false,
                username || '',
                password || '',
                client_id || null,
                !!mock,
                type,
                cloud_system_id || '',
                cloud_host || 'https://dwspectrum.digital-watchdog.com',
                cloud_user || '',
                cloud_password || '',
            ]
        );
        return res.status(201).json(r.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to create NVR server.' });
    }
});

router.patch('/servers/:id', requireRole('admin'), async (req, res) => {
    const { name, host, port, use_https, username, password, client_id, mock,
            conn_type, cloud_system_id, cloud_host, cloud_user, cloud_password } = req.body;
    try {
        const r = await pool.query(
            `UPDATE nvr_servers SET
                name            = COALESCE($1, name),
                host            = COALESCE($2, host),
                port            = COALESCE($3, port),
                use_https       = COALESCE($4, use_https),
                username        = COALESCE($5, username),
                password        = COALESCE($6, password),
                client_id       = $7,
                mock            = COALESCE($8, mock),
                conn_type       = COALESCE($9, conn_type),
                cloud_system_id = COALESCE($10, cloud_system_id),
                cloud_host      = COALESCE($11, cloud_host),
                cloud_user      = COALESCE($12, cloud_user),
                cloud_password  = COALESCE($13, cloud_password)
             WHERE id = $14
             RETURNING id, name, host, port, use_https, mock, conn_type,
                       cloud_system_id, cloud_host, cloud_user, client_id, created_at`,
            [name || null, host || null, port || null, use_https ?? null,
             username || null, password || null, client_id || null, mock ?? null,
             conn_type || null, cloud_system_id || null, cloud_host || null,
             cloud_user || null, cloud_password || null, req.params.id]
        );
        if (r.rowCount === 0) return res.status(404).json({ error: 'Not found.' });
        cloudTokens.delete(Number(req.params.id));   // creds may have changed
        return res.json(r.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to update NVR server.' });
    }
});

router.delete('/servers/:id', requireRole('admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM nvr_servers WHERE id = $1', [req.params.id]);
        cloudTokens.delete(Number(req.params.id));
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
        const { data } = await nvrRequest(server, { method: 'get', url: '/rest/v2/system/info' });
        return res.json({ online: true, info: data });
    } catch (err) {
        return res.json({ online: false, error: err.message });
    }
});

router.get('/servers/:id/devices', async (req, res) => {
    try {
        const server = await getServer(req.params.id);
        if (server.mock) return res.json(MOCK_DEVICES);
        const { data } = await nvrRequest(server, { method: 'get', url: '/rest/v2/devices' });
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
        const list = await fetchLicensesRaw(server);
        return res.json(list.map(normalizeLicense));
    } catch (err) {
        console.error('NVR licenses error:', err.message);
        return res.status(502).json({ error: 'Could not fetch licenses.', detail: err.message });
    }
});

/* POST /api/nvr/import-licenses [admin] — pull DW Spectrum licenses from every
   linked (non-mock) server into the Licenses tracker. Upserts by license key,
   and best-effort fills used seats from the system's in-use channel count. */
router.post('/import-licenses', requireRole('admin'), async (_req, res) => {
    const ids = (await pool.query('SELECT id FROM nvr_servers').catch(() => ({ rows: [] }))).rows;
    let imported = 0, updated = 0, servers = 0;
    const errors = [];

    for (const { id } of ids) {
        let server;
        try { server = await getServer(id); } catch { continue; }
        if (server.mock) continue;
        servers++;
        try {
            const lics = (await fetchLicensesRaw(server)).map(normalizeLicense).filter(l => (l.channels > 0) || l.key);
            if (!lics.length) continue;

            /* System-wide used channels (devices currently consuming a license). */
            let usedTotal = 0;
            try {
                const { data } = await nvrRequest(server, { method: 'get', url: '/rest/v2/devices' });
                usedTotal = (Array.isArray(data) ? data : []).filter(d => d.isLicenseUsed ?? d.isLicensed).length;
            } catch { /* usage optional */ }

            /* DW omits per-license usage, so greedily allocate the used channels
               across licenses (largest first) — the bars still reflect reality. */
            const usedByKey = new Map();
            let remaining = usedTotal;
            for (const l of [...lics].sort((a, b) => (b.channels || 0) - (a.channels || 0))) {
                const u = Math.min(l.channels || 0, Math.max(0, remaining));
                usedByKey.set(l.key, u);
                remaining -= u;
            }

            for (const l of lics) {
                const total = l.channels || null;
                const used  = usedByKey.get(l.key) || 0;
                const exp   = l.expirationDate && /\d/.test(l.expirationDate) ? l.expirationDate : null;
                const name  = `DW Spectrum — ${l.type || 'license'}${l.channels ? ` (${l.channels} ch)` : ''} · ${server.name}`;
                const found = l.key
                    ? await pool.query('SELECT id FROM licenses WHERE license_key = $1', [l.key])
                    : await pool.query('SELECT id FROM licenses WHERE license_key IS NULL AND name = $1', [name]);
                if (found.rowCount) {
                    await pool.query(
                        `UPDATE licenses SET name = $1, vendor = 'DW Spectrum', seats_total = $2, seats_used = $3,
                                category = 'DW Spectrum', expires_at = $4, updated_at = NOW() WHERE id = $5`,
                        [name, total, used, exp, found.rows[0].id]);
                    updated++;
                } else {
                    await pool.query(
                        `INSERT INTO licenses (name, vendor, license_key, seats_total, seats_used, category, expires_at)
                         VALUES ($1, 'DW Spectrum', $2, $3, $4, 'DW Spectrum', $5)`,
                        [name, l.key, total, used, exp]);
                    imported++;
                }
            }
        } catch (err) {
            errors.push({ server: server.name, error: err.response?.status ? `HTTP ${err.response.status}` : err.message });
        }
    }
    res.json({ imported, updated, servers, errors });
});

router.get('/servers/:id/mediaservers', async (req, res) => {
    try {
        const server = await getServer(req.params.id);
        if (server.mock) {
            return res.json([{ id: 'mock-srv-01', name: 'Mock NVR Server', status: 'Online', version: 'mock' }]);
        }
        const { data } = await nvrRequest(server, { method: 'get', url: '/rest/v2/servers' });
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
        const height   = Math.min(Math.max(parseInt(req.query.height, 10) || 480, 120), 1080);
        const response = await nvrRequest(server, {
            method: 'get',
            url: '/ec2/cameraThumbnail',
            responseType: 'stream',
            params: { cameraId: req.params.deviceId, time: 'latest', height },
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
        const now  = Date.now();
        const from = now - (Number(req.query.hours) || 24) * 3600000;
        const { data } = await nvrRequest(server, {
            method: 'get',
            url: '/api/getEvents',
            params: { from, to: now },
        });
        const reply  = Array.isArray(data?.reply) ? data.reply : [];
        const events = reply
            .map(normalizeEvent)
            .sort((a, b) => (b.eventTimestampUsec || 0) - (a.eventTimestampUsec || 0))
            .slice(0, Number(req.query.limit) || 100);
        return res.json(events);
    } catch (err) {
        console.error('NVR events error:', err.message);
        return res.status(502).json({ error: 'Could not fetch events.', detail: err.message });
    }
});

module.exports = router;
