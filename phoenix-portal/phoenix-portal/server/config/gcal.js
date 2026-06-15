'use strict';
/**
 * gcal.js — Google Calendar write helper
 *
 * Supports two auth methods (first one configured wins):
 *
 *  A) OAuth 2.0 refresh token  ← easiest for personal Google accounts
 *     GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *     Run the one-time flow: GET /api/calendar/oauth/start  (admin only)
 *
 *  B) Service Account JSON key  ← better for Google Workspace
 *     GOOGLE_SERVICE_ACCOUNT_JSON=/path/to/key.json
 *     Share calendar with the service-account email ("Make changes to events")
 *
 * If neither is configured every write function is a silent no-op.
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const pool   = require('../db/pool');

const TZ = 'America/Phoenix';

/* Last token-exchange failure reason, surfaced by the auth-status diagnostic. */
let _lastTokenError = null;
function getTokenError() { return _lastTokenError; }
function clearTokenCache() { _cache = { token: null, exp: 0 }; }

/* Refresh token can live in app_settings (pasted via the UI) or fall back to .env. */
async function getStoredRefreshToken() {
    const r = await pool.query("SELECT value FROM app_settings WHERE key = 'google_refresh_token'").catch(() => ({ rows: [] }));
    return (r.rows[0]?.value || '').trim() || null;
}

/* Format a Date as a naive "YYYY-MM-DDTHH:MM:SS" wall-clock string (no timezone
   suffix). Paired with an explicit timeZone field, this avoids the UTC drift you
   get from toISOString() when the server clock isn't on Phoenix time. */
function localISO(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* ── Token cache ───────────────────────────────────────────────────────── */
let _cache = { token: null, exp: 0 };

/* ── Auth method A: OAuth refresh token ───────────────────────────────── */
async function getOAuthToken() {
    const clientId     = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = (await getStoredRefreshToken()) || process.env.GOOGLE_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) {
        _lastTokenError = !refreshToken
            ? 'No Google refresh token configured.'
            : 'Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in the server .env.';
        return null;
    }

    const resp = await fetch('https://oauth2.googleapis.com/token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    new URLSearchParams({
            client_id:     clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type:    'refresh_token',
        }),
    });
    const data = await resp.json();
    if (!resp.ok) {
        /* invalid_grant = refresh token expired or revoked (common in "Testing" apps
           where refresh tokens die after 7 days). */
        _lastTokenError = (data.error === 'invalid_grant')
            ? 'Refresh token expired or revoked — generate a new one and paste it in (publish the OAuth app to Production to stop the 7-day expiry).'
            : (data.error_description || data.error || 'OAuth token exchange failed.');
        console.error('[gcal] OAuth token error:', _lastTokenError);
        return null;
    }
    _lastTokenError = null;
    return { token: data.access_token, exp: Math.floor(Date.now() / 1000) + (data.expires_in || 3600) };
}

/* ── Auth method B: Service account JWT ───────────────────────────────── */
function loadSA() {
    const p = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!p) return null;
    try {
        const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
        return JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (e) {
        console.warn('[gcal] Could not load service account JSON:', e.message);
        return null;
    }
}

function b64url(str) {
    return Buffer.from(str).toString('base64')
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getSAToken(sa) {
    const now     = Math.floor(Date.now() / 1000);
    const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = b64url(JSON.stringify({
        iss:   sa.client_email,
        scope: 'https://www.googleapis.com/auth/calendar',
        aud:   'https://oauth2.googleapis.com/token',
        exp:   now + 3600,
        iat:   now,
    }));
    const unsigned = `${header}.${payload}`;
    const sign     = crypto.createSign('RSA-SHA256');
    sign.update(unsigned);
    const sig = b64url(sign.sign(sa.private_key));

    const resp = await fetch('https://oauth2.googleapis.com/token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion:  `${unsigned}.${sig}`,
        }),
    });
    const data = await resp.json();
    if (!resp.ok) {
        console.error('[gcal] SA token error:', data.error_description || data.error);
        return null;
    }
    return { token: data.access_token, exp: now + (data.expires_in || 3600) };
}

/* ── Unified token getter (cached) ────────────────────────────────────── */
async function getToken() {
    const now = Math.floor(Date.now() / 1000);
    if (_cache.token && _cache.exp > now + 60) return _cache.token;

    /* Try OAuth refresh token (DB or .env) first */
    let result = await getOAuthToken().catch(() => null);

    /* Fall back to service account */
    if (!result) {
        const sa = loadSA();
        if (sa) result = await getSAToken(sa).catch(() => null);
    }

    if (!result) return null;
    _cache = result;
    return _cache.token;
}

/* ── Event body builder ────────────────────────────────────────────────── */
function buildBody(ticket, assigneeName) {
    const lines = [];
    if (ticket.description) { lines.push(ticket.description); lines.push(''); }
    lines.push('────────────────────────────');
    lines.push(`🎫 Ticket #${ticket.id}  ·  ${(ticket.status || 'open').replace('_', ' ').toUpperCase()}`);
    if (assigneeName)          lines.push(`👷 Assigned tech: ${assigneeName}`);
    if (ticket.event_location) lines.push(`📍 ${ticket.event_location}`);
    const origin = (process.env.CLIENT_ORIGIN || '').split(',')[0].trim();
    if (origin) lines.push(`\n🔗 ${origin}/tickets`);

    const start = ticket.event_start ? new Date(ticket.event_start) : null;
    const end   = ticket.event_end   ? new Date(ticket.event_end)
                : start              ? new Date(start.getTime() + 3600000) : null;

    const body = { summary: ticket.title, description: lines.join('\n') };
    if (ticket.event_location) body.location = ticket.event_location;

    if (start && end) {
        /* Send the wall-clock time + an explicit timeZone instead of a UTC ('Z')
           instant, so the event lands at the entry/departure time the user picked
           regardless of what timezone the server runs in. */
        body.start = { dateTime: localISO(start), timeZone: TZ };
        body.end   = { dateTime: localISO(end),   timeZone: TZ };
    } else {
        const d = localISO(start || new Date()).slice(0, 10);
        body.start = { date: d };
        body.end   = { date: d };
    }
    return body;
}

function calUrl(suffix) {
    const id = process.env.GOOGLE_CALENDAR_ID;
    if (!id) return null;
    return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events${suffix || ''}`;
}

/* ── Public API ───────────────────────────────────────────────────────── */
async function gcalCreate(ticket, assigneeName) {
    const url   = calUrl('');
    if (!url) return null;
    const token = await getToken().catch(() => null);
    if (!token) return null;
    try {
        const resp = await fetch(url, {
            method:  'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify(buildBody(ticket, assigneeName)),
        });
        const data = await resp.json();
        if (!resp.ok) { console.error('[gcal] Create failed:', data?.error?.message); return null; }
        return data.id;
    } catch (e) {
        console.error('[gcal] Create error:', e.message);
        return null;
    }
}

async function gcalUpdate(googleEventId, ticket, assigneeName) {
    if (!googleEventId) return;
    const url   = calUrl(`/${googleEventId}`);
    if (!url) return;
    const token = await getToken().catch(() => null);
    if (!token) return;
    try {
        const resp = await fetch(url, {
            method:  'PUT',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify(buildBody(ticket, assigneeName)),
        });
        if (!resp.ok) {
            const data = await resp.json();
            console.error('[gcal] Update failed:', data?.error?.message);
        }
    } catch (e) {
        console.error('[gcal] Update error:', e.message);
    }
}

async function gcalDelete(googleEventId) {
    if (!googleEventId) return;
    const url   = calUrl(`/${googleEventId}`);
    if (!url) return;
    const token = await getToken().catch(() => null);
    if (!token) return;
    try {
        await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    } catch (e) {
        console.error('[gcal] Delete error:', e.message);
    }
}

module.exports = { gcalCreate, gcalUpdate, gcalDelete, getToken, getTokenError, clearTokenCache };
