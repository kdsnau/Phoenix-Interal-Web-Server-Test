const express = require('express');
const crypto  = require('crypto');
const pool    = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/requireRole');

const router = express.Router();

/* Anyone signed in can open the vault; they only see the credentials granted to
   their role. Creating / rolling / editing / deleting stay admin-only (enforced
   per route). Admins always see every entry regardless of its allowed_roles. */
router.use(authenticate);

const VALID_ROLES = ['admin', 'accounting', 'technician'];
const cleanRoles  = v => (Array.isArray(v) ? [...new Set(v.filter(r => VALID_ROLES.includes(r)))] : []);

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
/* Per-entry access: the permission roles allowed to see this secret. Empty means
   admins only (admins see everything anyway). Existing rows default to empty, so
   nothing is exposed to non-admins until an admin grants access. */
pool.query(`ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS allowed_roles TEXT[] NOT NULL DEFAULT '{}'`).catch(() => {});

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

const ENTRY_COLS = 'id, label, username, allowed_roles, created_at, updated_at';

/* ── Routes ──────────────────────────────────────────────────────────────── */

/* GET /api/vault/status — is the server encryption key present? */
router.get('/status', (_req, res) => res.json({ keyOk: !!getKey() }));

/* GET /api/vault/entries — credentials visible to the caller, decrypted.
   Admins get everything; everyone else gets only entries granted to their role. */
router.get('/entries', async (req, res) => {
    if (!getKey()) return res.status(503).json({ error: 'VAULT_KEY is not configured on the server.' });
    try {
        const r = req.user.role === 'admin'
            ? await pool.query(`SELECT ${ENTRY_COLS}, secret FROM vault_entries ORDER BY label`)
            : await pool.query(`SELECT ${ENTRY_COLS}, secret FROM vault_entries WHERE $1 = ANY(allowed_roles) ORDER BY label`, [req.user.role]);
        const entries = r.rows.map(e => ({
            id: e.id, label: e.label, username: e.username,
            password: safeDecrypt(e.secret), allowed_roles: e.allowed_roles || [],
            created_at: e.created_at, updated_at: e.updated_at,
        }));
        res.json({ entries });
    } catch (err) { console.error('Vault read error:', err.message); res.status(500).json({ error: 'Failed to read vault.' }); }
});

/* POST /api/vault/generate { label, username, allowed_roles } — admin only. */
router.post('/generate', requireRole('admin'), async (req, res) => {
    if (!getKey()) return res.status(503).json({ error: 'VAULT_KEY is not configured on the server.' });
    const label = (req.body.label || '').trim();
    if (!label) return res.status(400).json({ error: 'Service label is required.' });
    const username = (req.body.username || '').trim() || null;
    const allowed  = cleanRoles(req.body.allowed_roles);
    try {
        const pw = generatePassword(15);
        const r  = await pool.query(
            `INSERT INTO vault_entries (label, username, secret, allowed_roles, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING ${ENTRY_COLS}`,
            [label, username, encrypt(pw), allowed, req.user.id]
        );
        res.status(201).json({ ...r.rows[0], password: pw });
    } catch (err) { console.error('Vault generate error:', err.message); res.status(500).json({ error: 'Failed to generate password.' }); }
});

/* POST /api/vault/entries/:id/regenerate — roll the password. Admin only. */
router.post('/entries/:id/regenerate', requireRole('admin'), async (req, res) => {
    if (!getKey()) return res.status(503).json({ error: 'VAULT_KEY is not configured on the server.' });
    try {
        const pw = generatePassword(15);
        const r  = await pool.query(
            `UPDATE vault_entries SET secret = $1, updated_at = NOW() WHERE id = $2 RETURNING ${ENTRY_COLS}`,
            [encrypt(pw), req.params.id]
        );
        if (r.rowCount === 0) return res.status(404).json({ error: 'Entry not found.' });
        res.json({ ...r.rows[0], password: pw });
    } catch (err) { console.error('Vault regenerate error:', err.message); res.status(500).json({ error: 'Failed to regenerate.' }); }
});

/* PATCH /api/vault/entries/:id { label?, username?, allowed_roles? } — edit
   metadata and who can access. Admin only. */
router.patch('/entries/:id', requireRole('admin'), async (req, res) => {
    const sets = [], vals = [];
    if (typeof req.body.label === 'string' && req.body.label.trim()) { vals.push(req.body.label.trim()); sets.push(`label = $${vals.length}`); }
    if ('username' in req.body)      { vals.push((req.body.username || '').trim() || null); sets.push(`username = $${vals.length}`); }
    if ('allowed_roles' in req.body) { vals.push(cleanRoles(req.body.allowed_roles));        sets.push(`allowed_roles = $${vals.length}`); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update.' });
    vals.push(req.params.id);
    try {
        const r = await pool.query(
            `UPDATE vault_entries SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length} RETURNING ${ENTRY_COLS}`,
            vals
        );
        if (r.rowCount === 0) return res.status(404).json({ error: 'Entry not found.' });
        res.json(r.rows[0]);
    } catch (err) { console.error('Vault update error:', err.message); res.status(500).json({ error: 'Failed to update entry.' }); }
});

/* DELETE /api/vault/entries/:id — remove an entry. Admin only. */
router.delete('/entries/:id', requireRole('admin'), async (req, res) => {
    try {
        const r = await pool.query('DELETE FROM vault_entries WHERE id = $1', [req.params.id]);
        if (r.rowCount === 0) return res.status(404).json({ error: 'Entry not found.' });
        res.json({ ok: true });
    } catch (err) { console.error('Vault delete error:', err.message); res.status(500).json({ error: 'Failed to delete.' }); }
});

module.exports = router;
