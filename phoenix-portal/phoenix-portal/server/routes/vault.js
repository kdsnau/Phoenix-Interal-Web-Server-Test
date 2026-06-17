const express = require('express');
const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const pool    = require('../db/pool');
const { requireRole } = require('../middleware/requireRole');

const router = express.Router();

/* The entire vault is admin-only (requireRole runs authenticate + role check). */
router.use(requireRole('admin'));

/* ── Schema ──────────────────────────────────────────────────────────────── */
pool.query(`
    CREATE TABLE IF NOT EXISTS vault_entries (
        id         SERIAL PRIMARY KEY,
        label      TEXT NOT NULL,
        username   TEXT,
        secret     TEXT NOT NULL,           -- AES-256-GCM, stored as iv:tag:ciphertext (base64)
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    )
`).catch(() => {});

/* app_settings holds the bcrypt hash of the page (gate) password. */
const GATE_KEY = 'vault_gate_hash';
async function getSetting(key) {
    try { const r = await pool.query('SELECT value FROM app_settings WHERE key = $1', [key]); return r.rows[0]?.value ?? null; }
    catch { return null; }
}
async function setSetting(key, value) {
    await pool.query(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMP DEFAULT NOW())`).catch(() => {});
    await pool.query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, value]
    );
}

/* ── Crypto ──────────────────────────────────────────────────────────────── */
/* 32-byte AES key from server/.env VAULT_KEY (64 hex chars, or base64). */
function getKey() {
    const raw = process.env.VAULT_KEY || '';
    let buf = null;
    if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, 'hex');
    else { try { buf = Buffer.from(raw, 'base64'); } catch { buf = null; } }
    return buf && buf.length === 32 ? buf : null;
}

function encrypt(plain) {
    const key = getKey();
    if (!key) throw new Error('VAULT_KEY not configured');
    const iv     = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct     = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    const tag    = cipher.getAuthTag();
    return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

function decrypt(stored) {
    const key = getKey();
    if (!key) throw new Error('VAULT_KEY not configured');
    const [ivB, tagB, ctB] = String(stored).split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
}
const safeDecrypt = s => { try { return decrypt(s); } catch { return null; } };

/* CSPRNG password — 15 chars from a 62-char pool, unbiased via crypto.randomInt. */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function generatePassword(len = 15) {
    let out = '';
    for (let i = 0; i < len; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
    return out;
}

async function verifyGate(password) {
    const hash = await getSetting(GATE_KEY);
    if (!hash || !password) return false;
    try { return await bcrypt.compare(String(password), hash); } catch { return false; }
}

/* ── Routes ──────────────────────────────────────────────────────────────── */

/* GET /api/vault/status — is the gate set up, and is the server key present? */
router.get('/status', async (_req, res) => {
    res.json({ configured: !!(await getSetting(GATE_KEY)), keyOk: !!getKey() });
});

/* POST /api/vault/setup { password } — first-time set the page password. */
router.post('/setup', async (req, res) => {
    const { password } = req.body;
    if (!password || String(password).length < 8) return res.status(400).json({ error: 'Vault password must be at least 8 characters.' });
    if (await getSetting(GATE_KEY)) return res.status(409).json({ error: 'Vault is already set up.' });
    try {
        await setSetting(GATE_KEY, await bcrypt.hash(String(password), 12));
        res.json({ ok: true });
    } catch (err) { console.error('Vault setup error:', err.message); res.status(500).json({ error: 'Failed to set up vault.' }); }
});

/* POST /api/vault/unlock { password } — verify, return decrypted entries. */
router.post('/unlock', async (req, res) => {
    if (!getKey()) return res.status(503).json({ error: 'VAULT_KEY is not configured on the server.' });
    if (!await verifyGate(req.body.password)) return res.status(401).json({ error: 'Incorrect vault password.' });
    try {
        const r = await pool.query('SELECT id, label, username, secret, created_at, updated_at FROM vault_entries ORDER BY label');
        const entries = r.rows.map(e => ({
            id: e.id, label: e.label, username: e.username,
            password: safeDecrypt(e.secret), created_at: e.created_at, updated_at: e.updated_at,
        }));
        res.json({ entries });
    } catch (err) { console.error('Vault unlock error:', err.message); res.status(500).json({ error: 'Failed to read vault.' }); }
});

/* POST /api/vault/generate { password, label, username } — new CSPRNG password. */
router.post('/generate', async (req, res) => {
    if (!getKey()) return res.status(503).json({ error: 'VAULT_KEY is not configured on the server.' });
    if (!await verifyGate(req.body.password)) return res.status(401).json({ error: 'Incorrect vault password.' });
    const label = (req.body.label || '').trim();
    if (!label) return res.status(400).json({ error: 'Service label is required.' });
    const username = (req.body.username || '').trim() || null;
    try {
        const pw = generatePassword(15);
        const r  = await pool.query(
            'INSERT INTO vault_entries (label, username, secret, created_by) VALUES ($1, $2, $3, $4) RETURNING id, label, username, created_at, updated_at',
            [label, username, encrypt(pw), req.user.id]
        );
        res.status(201).json({ ...r.rows[0], password: pw });
    } catch (err) { console.error('Vault generate error:', err.message); res.status(500).json({ error: 'Failed to generate password.' }); }
});

/* POST /api/vault/entries/:id/regenerate { password } — roll the password. */
router.post('/entries/:id/regenerate', async (req, res) => {
    if (!getKey()) return res.status(503).json({ error: 'VAULT_KEY is not configured on the server.' });
    if (!await verifyGate(req.body.password)) return res.status(401).json({ error: 'Incorrect vault password.' });
    try {
        const pw = generatePassword(15);
        const r  = await pool.query(
            'UPDATE vault_entries SET secret = $1, updated_at = NOW() WHERE id = $2 RETURNING id, label, username, created_at, updated_at',
            [encrypt(pw), req.params.id]
        );
        if (r.rowCount === 0) return res.status(404).json({ error: 'Entry not found.' });
        res.json({ ...r.rows[0], password: pw });
    } catch (err) { console.error('Vault regenerate error:', err.message); res.status(500).json({ error: 'Failed to regenerate.' }); }
});

/* POST /api/vault/entries/:id/delete { password } — remove an entry. */
router.post('/entries/:id/delete', async (req, res) => {
    if (!await verifyGate(req.body.password)) return res.status(401).json({ error: 'Incorrect vault password.' });
    try {
        const r = await pool.query('DELETE FROM vault_entries WHERE id = $1', [req.params.id]);
        if (r.rowCount === 0) return res.status(404).json({ error: 'Entry not found.' });
        res.json({ ok: true });
    } catch (err) { console.error('Vault delete error:', err.message); res.status(500).json({ error: 'Failed to delete.' }); }
});

module.exports = router;
