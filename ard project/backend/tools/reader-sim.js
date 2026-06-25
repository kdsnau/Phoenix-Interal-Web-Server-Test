'use strict';
/**
 * Reader simulator -- signs and sends requests to the backend exactly like the
 * Arduino firmware will. Use it to smoke-test the reader API without hardware,
 * and as the canonical reference for the firmware's HMAC signing.
 *
 * Usage:
 *   node tools/reader-sim.js validate --id 1 --key <reader_key> --uid 04A1B2C3
 *   node tools/reader-sim.js validate --id 1 --key <reader_key> --token <phone_token>
 *   node tools/reader-sim.js sync     --id 1 --key <reader_key>
 *   node tools/reader-sim.js events   --id 1 --key <reader_key> --uid 04A1B2C3 --decision granted
 *
 * Options: --base http://localhost:4000  (default)
 */
const http = require('http');
const { URL } = require('url');
const { computeSignature } = require('../src/util/readerSig');

function parseArgs(argv) {
    const out = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[++i];
        else out._.push(argv[i]);
    }
    return out;
}

function request(base, method, path, readerId, readerKey, bodyObj) {
    return new Promise((resolve, reject) => {
        const body = bodyObj ? JSON.stringify(bodyObj) : '';
        const ts = Math.floor(Date.now() / 1000);
        const sig = computeSignature(readerKey, method, path, ts, body);
        const u = new URL(base);
        const req = http.request(
            {
                hostname: u.hostname,
                port: u.port || 80,
                path: `/api/reader${path}`,
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                    'X-Reader-Id': String(readerId),
                    'X-Reader-Timestamp': String(ts),
                    'X-Reader-Signature': sig,
                },
            },
            (res) => {
                let d = '';
                res.on('data', (c) => (d += c));
                res.on('end', () => resolve({ status: res.statusCode, body: d }));
            },
        );
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

(async () => {
    const args = parseArgs(process.argv.slice(2));
    const cmd = args._[0];
    const base = args.base || 'http://localhost:4000';
    const id = args.id;
    const key = args.key;
    if (!cmd || !id || !key) {
        console.error('need: <validate|sync|events> --id <doorId> --key <reader_key> [...]');
        process.exit(1);
    }

    let r;
    if (cmd === 'validate') {
        const tap = args.token
            ? { type: 'phone', token: args.token }
            : { type: 'uid_card', uid: args.uid };
        r = await request(base, 'POST', '/validate', id, key, tap);
    } else if (cmd === 'sync') {
        r = await request(base, 'GET', '/sync', id, key, null);
    } else if (cmd === 'events') {
        r = await request(base, 'POST', '/events', id, key, {
            events: [{ uid: args.uid, decision: args.decision || 'granted', reason: 'offline_cache' }],
        });
    } else {
        console.error('unknown command', cmd);
        process.exit(1);
    }
    console.log(r.status, r.body);
})();
