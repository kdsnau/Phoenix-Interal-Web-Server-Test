'use strict';
const db = require('../db/pool');
const config = require('../config');
const { computeSignature, safeEqualHex } = require('../util/readerSig');

/**
 * Authenticates a door reader without TLS (the Uno can't do HTTPS).
 *
 * The reader sends:
 *   X-Reader-Id         the door id
 *   X-Reader-Timestamp  unix seconds
 *   X-Reader-Signature  hex HMAC-SHA256(reader_key, "METHOD\nPATH\nTIMESTAMP\nBODY")
 *
 * We recompute the MAC with the door's stored reader_key. Because the timestamp
 * is inside the signed string and must be fresh (within readerClockSkewSec), a
 * captured request can't be replayed later. On success req.door is set.
 *
 * Requires express.json({ verify }) to have stashed the raw bytes on req.rawBody.
 */
async function readerAuth(req, res, next) {
    try {
        const id = Number(req.get('X-Reader-Id'));
        const ts = Number(req.get('X-Reader-Timestamp'));
        const sig = req.get('X-Reader-Signature') || '';
        if (!id || !ts || !sig) return res.status(401).json({ error: 'reader_auth_missing' });

        const now = Math.floor(Date.now() / 1000);
        if (Math.abs(now - ts) > config.readerClockSkewSec) {
            return res.status(401).json({ error: 'reader_clock_skew' });
        }

        const { rows } = await db.query('SELECT * FROM doors WHERE id = $1', [id]);
        const door = rows[0];
        if (!door) return res.status(401).json({ error: 'unknown_reader' });

        const body = req.rawBody ? req.rawBody.toString('utf8') : '';
        const expected = computeSignature(door.reader_key, req.method, req.path, ts, body);
        if (!safeEqualHex(sig, expected)) {
            return res.status(401).json({ error: 'reader_bad_signature' });
        }

        // Touch heartbeat; non-fatal if it fails.
        db.query('UPDATE doors SET last_seen_at = NOW() WHERE id = $1', [id]).catch(() => {});
        req.door = door;
        next();
    } catch (err) {
        next(err);
    }
}

module.exports = { readerAuth };
