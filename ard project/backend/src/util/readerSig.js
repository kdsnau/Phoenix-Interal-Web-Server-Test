'use strict';
const crypto = require('crypto');

/**
 * Canonical string a reader signs / the server verifies. Keeping this in ONE
 * place guarantees the firmware (which reproduces this exact format) and the
 * backend never drift apart.
 *
 *   METHOD\nPATH\nTIMESTAMP\nBODY
 *
 * BODY is the exact request body bytes (empty string for GET).
 */
function signatureBase(method, path, timestamp, body = '') {
    return `${method}\n${path}\n${timestamp}\n${body}`;
}

function computeSignature(readerKey, method, path, timestamp, body = '') {
    return crypto
        .createHmac('sha256', readerKey)
        .update(signatureBase(method, path, timestamp, body))
        .digest('hex');
}

function safeEqualHex(a, b) {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
}

module.exports = { signatureBase, computeSignature, safeEqualHex };
