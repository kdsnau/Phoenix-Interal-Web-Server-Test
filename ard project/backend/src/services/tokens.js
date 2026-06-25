'use strict';
/**
 * Rotating phone-credential tokens.
 *
 * A phone credential has a per-credential secret (`token_key`). While online the
 * app asks the backend to mint a short-lived token; it presents that token to the
 * reader over NFC/HCE. The reader can verify it OFFLINE because /reader/sync hands
 * the reader the same `token_key`s -- verification is a single HMAC, fast enough
 * for an ATmega328. Expiry (default ~3 min) makes a captured tap useless minutes
 * later, which is what gives the phone credential its replay/clone resistance.
 *
 * Token wire format (compact ASCII, NFC-friendly):
 *     <public_id>.<exp>.<hmacHex>
 *   where hmac = HMAC_SHA256(token_key, "<public_id>.<exp>"), hex, truncated to
 *   32 hex chars (128 bits) to keep the APDU small.
 */

const crypto = require('crypto');

const SIG_HEX_LEN = 32; // 128-bit truncated HMAC

function sign(publicId, exp, tokenKey) {
    return crypto
        .createHmac('sha256', tokenKey)
        .update(`${publicId}.${exp}`)
        .digest('hex')
        .slice(0, SIG_HEX_LEN);
}

/**
 * Mint a token for a phone credential.
 * @param {{public_id:string, token_key:string}} credential
 * @param {number} ttlSeconds
 * @param {number} [nowMs]
 */
function issueToken(credential, ttlSeconds, nowMs = Date.now()) {
    const exp = Math.floor(nowMs / 1000) + ttlSeconds;
    const sig = sign(credential.public_id, exp, credential.token_key);
    return { token: `${credential.public_id}.${exp}.${sig}`, exp };
}

function constantTimeEqual(a, b) {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
}

/**
 * Verify a token string.
 * @param {string} token
 * @param {(publicId:string) => ({token_key:string}|null|undefined)} lookupKey
 *        resolves a credential's token_key by public_id (DB or synced cache).
 * @param {number} [nowMs]
 * @returns {{ok:boolean, publicId?:string, reason?:string}}
 */
function verifyToken(token, lookupKey, nowMs = Date.now()) {
    if (typeof token !== 'string') return { ok: false, reason: 'malformed' };
    const parts = token.split('.');
    if (parts.length !== 3) return { ok: false, reason: 'malformed' };
    const [publicId, expStr, sig] = parts;

    const exp = Number(expStr);
    if (!Number.isFinite(exp)) return { ok: false, reason: 'malformed' };

    const cred = lookupKey(publicId);
    if (!cred || !cred.token_key) return { ok: false, reason: 'unknown_public_id' };

    const expected = sign(publicId, exp, cred.token_key);
    if (!constantTimeEqual(sig, expected)) return { ok: false, reason: 'bad_signature' };

    if (Math.floor(nowMs / 1000) >= exp) return { ok: false, reason: 'expired', publicId };

    return { ok: true, publicId };
}

/** A fresh random secret for a new phone credential. */
function newTokenKey() {
    return crypto.randomBytes(32).toString('hex');
}

/** A short, URL/NFC-safe public identifier for a phone credential. */
function newPublicId() {
    return crypto.randomBytes(8).toString('hex');
}

module.exports = { issueToken, verifyToken, newTokenKey, newPublicId, SIG_HEX_LEN };
