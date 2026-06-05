const express = require('express');
const axios   = require('axios');
const pool    = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/requireRole');

const router = express.Router();
router.use(authenticate);

/* ── DB migration ─────────────────────────────────────────────────────── */
pool.query(`
    CREATE TABLE IF NOT EXISTS dmp_accounts (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(100) NOT NULL,
        site_id    VARCHAR(100) NOT NULL DEFAULT '',
        api_key    VARCHAR(255) NOT NULL DEFAULT '',
        api_url    VARCHAR(255) NOT NULL DEFAULT 'https://api.wadmp.com',
        mock       BOOLEAN      NOT NULL DEFAULT FALSE,
        client_id  INTEGER REFERENCES clients(id) ON DELETE SET NULL,
        created_at TIMESTAMP    NOT NULL DEFAULT NOW()
    )
`).catch(console.error);
pool.query(`ALTER TABLE dmp_accounts ADD COLUMN IF NOT EXISTS mock BOOLEAN NOT NULL DEFAULT FALSE`).catch(() => {});

/* ═══════════════════════════════════════════════════════════════════════
   MOCK DATA
   ═══════════════════════════════════════════════════════════════════════ */

function mockStatus() {
    return {
        panelId:    'MOCK-PANEL-01',
        online:     true,
        armState:   'armed_away',   // armed_away | armed_stay | disarmed
        trouble:    false,
        acPower:    true,
        batteryOk:  true,
        lastUpdate: new Date().toISOString(),
    };
}

function mockZones() {
    return [
        { id: 'z01', name: 'Front Door',       type: 'entry',    state: 'closed',   bypassed: false  },
        { id: 'z02', name: 'Rear Door',        type: 'entry',    state: 'closed',   bypassed: false  },
        { id: 'z03', name: 'Motion - Entry',   type: 'motion',   state: 'inactive', bypassed: false  },
        { id: 'z04', name: 'Motion - Hallway', type: 'motion',   state: 'inactive', bypassed: false  },
        { id: 'z05', name: 'Side Window',      type: 'perimeter',state: 'open',     bypassed: false  },
        { id: 'z06', name: 'Glass Break',      type: 'perimeter',state: 'closed',   bypassed: false  },
        { id: 'z07', name: 'Smoke Detector 1', type: 'fire',     state: 'inactive', bypassed: false  },
        { id: 'z08', name: 'CO Detector',      type: 'fire',     state: 'inactive', bypassed: false  },
        { id: 'z09', name: 'Server Room PIR',  type: 'motion',   state: 'inactive', bypassed: true   },
    ];
}

function mockEvents() {
    const m = 60000;
    const h = 3600000;
    return [
        { id: 'ev01', type: 'armed_away',   user: 'User 1',   description: 'Armed Away',           timestamp: new Date(Date.now() - 2  * h).toISOString() },
        { id: 'ev02', type: 'disarmed',     user: 'User 1',   description: 'Disarmed',              timestamp: new Date(Date.now() - 10 * h).toISOString() },
        { id: 'ev03', type: 'armed_away',   user: 'User 2',   description: 'Armed Away',           timestamp: new Date(Date.now() - 26 * h).toISOString() },
        { id: 'ev04', type: 'alarm',        user: null,       description: 'Zone 5 - Side Window', timestamp: new Date(Date.now() - 30 * h).toISOString() },
        { id: 'ev05', type: 'disarmed',     user: 'User 2',   description: 'Disarmed - Cancel',    timestamp: new Date(Date.now() - 30 * h + 2 * m).toISOString() },
        { id: 'ev06', type: 'trouble',      user: null,       description: 'AC Power Restore',     timestamp: new Date(Date.now() - 48 * h).toISOString() },
        { id: 'ev07', type: 'armed_stay',   user: 'User 1',   description: 'Armed Stay',           timestamp: new Date(Date.now() - 50 * h).toISOString() },
        { id: 'ev08', type: 'disarmed',     user: 'User 1',   description: 'Disarmed',              timestamp: new Date(Date.now() - 58 * h).toISOString() },
        { id: 'ev09', type: 'zone_bypass',  user: 'User 1',   description: 'Zone 9 Bypassed',      timestamp: new Date(Date.now() - 60 * h).toISOString() },
        { id: 'ev10', type: 'system',       user: null,       description: 'Panel Online',          timestamp: new Date(Date.now() - 72 * h).toISOString() },
    ];
}

/* ═══════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════ */

async function getAccount(id) {
    const r = await pool.query('SELECT * FROM dmp_accounts WHERE id = $1', [id]);
    if (r.rowCount === 0) throw Object.assign(new Error('DMP account not found'), { status: 404 });
    return r.rows[0];
}

function dmpClient(account) {
    return axios.create({
        baseURL: account.api_url,
        timeout: 10000,
        headers: { Authorization: `Bearer ${account.api_key}` },
    });
}

function safe(account) {
    const { api_key, ...rest } = account;  // eslint-disable-line no-unused-vars
    return rest;
}

/* ═══════════════════════════════════════════════════════════════════════
   CRUD
   ═══════════════════════════════════════════════════════════════════════ */

/* GET all accounts (optionally filtered by client) */
router.get('/accounts', async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT a.id, a.name, a.site_id, a.api_url, a.mock,
                    a.client_id, a.created_at, c.name AS client_name
             FROM dmp_accounts a
             LEFT JOIN clients c ON c.id = a.client_id
             ${req.query.client_id ? 'WHERE a.client_id = $1' : ''}
             ORDER BY a.name`,
            req.query.client_id ? [req.query.client_id] : []
        );
        return res.json(r.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

router.post('/accounts', requireRole('admin'), async (req, res) => {
    const { name, site_id, api_key, api_url, mock, client_id } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required.' });
    if (!mock && !site_id) return res.status(400).json({ error: 'site_id is required for non-mock accounts.' });
    try {
        const r = await pool.query(
            `INSERT INTO dmp_accounts (name, site_id, api_key, api_url, mock, client_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, name, site_id, api_url, mock, client_id, created_at`,
            [
                name.trim(),
                site_id  || '',
                api_key  || '',
                api_url  || 'https://api.wadmp.com',
                !!mock,
                client_id || null,
            ]
        );
        return res.status(201).json(r.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to create DMP account.' });
    }
});

router.patch('/accounts/:id', requireRole('admin'), async (req, res) => {
    const { name, site_id, api_key, api_url, mock, client_id } = req.body;
    try {
        const r = await pool.query(
            `UPDATE dmp_accounts SET
                name      = COALESCE($1, name),
                site_id   = COALESCE($2, site_id),
                api_key   = COALESCE($3, api_key),
                api_url   = COALESCE($4, api_url),
                mock      = COALESCE($5, mock),
                client_id = $6
             WHERE id = $7
             RETURNING id, name, site_id, api_url, mock, client_id, created_at`,
            [name || null, site_id || null, api_key || null, api_url || null,
             mock ?? null, client_id || null, req.params.id]
        );
        if (r.rowCount === 0) return res.status(404).json({ error: 'Not found.' });
        return res.json(r.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to update DMP account.' });
    }
});

router.delete('/accounts/:id', requireRole('admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM dmp_accounts WHERE id = $1', [req.params.id]);
        return res.json({ success: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to delete DMP account.' });
    }
});

/* ═══════════════════════════════════════════════════════════════════════
   PROXY / MOCK ENDPOINTS
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * GET /api/dmp/accounts/:id/status
 * Panel online status, arm state, trouble flags.
 */
router.get('/accounts/:id/status', async (req, res) => {
    try {
        const account = await getAccount(req.params.id);
        if (account.mock) return res.json(mockStatus());
        const client = dmpClient(account);
        const { data } = await client.get(`/api/v1/sites/${account.site_id}/status`);
        return res.json(data);
    } catch (err) {
        console.error('DMP status error:', err.message);
        return res.status(502).json({ error: 'Could not reach DMP.', detail: err.message });
    }
});

/**
 * GET /api/dmp/accounts/:id/zones
 * Zone list with current state.
 */
router.get('/accounts/:id/zones', async (req, res) => {
    try {
        const account = await getAccount(req.params.id);
        if (account.mock) return res.json(mockZones());
        const client = dmpClient(account);
        const { data } = await client.get(`/api/v1/sites/${account.site_id}/zones`);
        return res.json(data);
    } catch (err) {
        console.error('DMP zones error:', err.message);
        return res.status(502).json({ error: 'Could not fetch zones.', detail: err.message });
    }
});

/**
 * GET /api/dmp/accounts/:id/events
 * Recent alarm/arm/disarm event log.
 */
router.get('/accounts/:id/events', async (req, res) => {
    try {
        const account = await getAccount(req.params.id);
        if (account.mock) return res.json(mockEvents());
        const client = dmpClient(account);
        const { data } = await client.get(`/api/v1/sites/${account.site_id}/events`, {
            params: { limit: req.query.limit || 50 },
        });
        return res.json(data);
    } catch (err) {
        console.error('DMP events error:', err.message);
        return res.status(502).json({ error: 'Could not fetch events.', detail: err.message });
    }
});

module.exports = router;
