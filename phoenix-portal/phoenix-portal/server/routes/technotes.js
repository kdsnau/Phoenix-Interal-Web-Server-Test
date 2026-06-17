const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/requireRole');

const router = express.Router();

/* Technician reference notes — three editable sections, stored in app_settings
   and seeded with the original content the first time they're read. Admins edit;
   everyone reads. Links use [label](url) markdown; bare URLs are auto-linked. */
const SECTIONS = { dw: 'technotes_dw', dmp: 'technotes_dmp', ens: 'technotes_ens' };

const DEFAULTS = {
    dw: `[DW Spectrum Installation Procedures](https://sites.google.com/view/dwipcam/dw-cloud-site?authuser=0)

DW Support Phone: 813-888-9555
Tech Support Authorization #: 12336

For all DVR / DW Spectrum installs use Phx12345! as the default password.`,
    dmp: `[DMP Setup Parameters](http://leradmin.securecomwireless.com)

DMP Support: 1-888-436-7832
App Key: 04609DF2
Receiver 1 — 1st IP: 216.9.200.67
Receiver 1 — 2nd IP: 64.208.83.126

[Dealer Admin DMP Guide](https://drive.google.com/file/d/1PH6gGBV5PK4JmZjuGz_fHIq_4irER1cQ/view?usp=sharing)`,
    ens: `[ENS Security Mobile-Remote View Setup Guide](https://docs.google.com/document/d/1BrkBue0ckTM31aOYt3kMZvUKJCT9mYPPObFM8r3CP1Y/edit?usp=sharing)

[ENS Security Titanium NVR Quick Reference Guide](https://docs.google.com/document/d/1oerRxnmJmbCwmgxB4a0D_N7BVMs_GotIWGYX7llBLC8/edit?usp=sharing)`,
};

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

/* GET /api/tech-notes — all sections (stored value, or the seeded default). */
router.get('/', authenticate, async (_req, res) => {
    const out = {};
    for (const [k, key] of Object.entries(SECTIONS)) {
        const v = await getSetting(key);
        out[k] = v == null ? DEFAULTS[k] : v;
    }
    res.json({ sections: out });
});

/* PUT /api/tech-notes { section, content } — admin edits one section. */
router.put('/', requireRole('admin'), async (req, res) => {
    const { section, content } = req.body;
    if (!SECTIONS[section])            return res.status(400).json({ error: 'Invalid section.' });
    if (typeof content !== 'string')   return res.status(400).json({ error: 'content must be a string.' });
    try { await setSetting(SECTIONS[section], content); res.json({ ok: true }); }
    catch (e) { console.error('technotes save error:', e.message); res.status(500).json({ error: 'Failed to save.' }); }
});

module.exports = router;
