'use strict';
/**
 * Live end-to-end demo against a running backend + database.
 * Exercises the real admin API, then taps the door via the reader simulator.
 *
 *   1. admin logs in
 *   2. create a user (with a login password, so we can test the phone too)
 *   3. assign a UID card + issue a phone credential
 *   4. create a door (mints reader_key) and an allow rule
 *   5. reader-sim: tap the card           -> expect GRANTED
 *   6. user logs in, mints a rotating token; reader-sim taps it -> expect GRANTED
 *   7. reader-sim: tap an unknown card     -> expect DENIED
 *   8. print the scan-usage summary + recent events
 */
const { execFileSync } = require('child_process');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:4000';
const ADMIN = { email: 'admin@phoenixsectech.com', password: 'Admin1234!' };
const CARD_UID = '04A1B2C3D4';

async function api(method, p, token, body) {
    const res = await fetch(`${BASE}${p}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${text}`);
    return json;
}

function sim(args) {
    const out = execFileSync('node', [path.join(__dirname, 'reader-sim.js'), ...args], {
        encoding: 'utf8',
    });
    return out.trim();
}

const line = (s) => console.log(`\n=== ${s} ===`);

(async () => {
    line('1. admin login');
    const { token: adminTok } = await api('POST', '/api/auth/login', null, ADMIN);
    console.log('admin token acquired');

    line('2. create user');
    const user = await api('POST', '/api/users', adminTok, {
        name: 'Dana Tech', email: `dana${Date.now()}@phx.test`, role: 'user', password: 'Dana1234!',
    });
    console.log('user id', user.id);

    line('3. assign card + issue phone credential');
    const card = await api('POST', '/api/credentials/card', adminTok, {
        userId: user.id, uid: CARD_UID, label: 'Blue fob',
    });
    console.log('card credential', card.id, 'uid', card.uid);
    const phone = await api('POST', '/api/credentials/phone', adminTok, {
        userId: user.id, label: 'Dana Pixel',
    });
    console.log('phone credential', phone.id, 'public_id', phone.public_id);

    line('4. create door + allow rule');
    const door = await api('POST', '/api/doors', adminTok, {
        name: 'Front Door', location: 'HQ lobby', relayUnlockMs: 4000,
    });
    console.log('door id', door.id, 'reader_key', door.reader_key.slice(0, 12) + '...');
    await api('POST', '/api/rules', adminTok, {
        name: 'Staff may enter', type: 'door_access', scope: 'all', effect: 'allow', priority: 0,
    });
    console.log('allow-all door_access rule created');

    const key = door.reader_key;
    const id = door.id;

    line('5. TAP the card (expect granted)');
    console.log(sim(['validate', '--id', id, '--key', key, '--uid', CARD_UID]));

    line('6. phone: user logs in, mints rotating token, taps it (expect granted)');
    const { token: userTok } = await api('POST', '/api/auth/login', null, {
        email: user.email, password: 'Dana1234!',
    });
    const mint = await api('POST', '/api/me/token', userTok, {});
    console.log('minted token (ttl', mint.ttl + 's):', mint.token.slice(0, 24) + '...');
    console.log(sim(['validate', '--id', id, '--key', key, '--token', mint.token]));

    line('7. TAP an unknown card (expect denied)');
    console.log(sim(['validate', '--id', id, '--key', key, '--uid', 'DEADBEEF99']));

    line('8. scan-usage summary');
    const summary = await api('GET', '/api/scans/summary', adminTok);
    console.log('totals:', JSON.stringify(summary.totals));
    console.log('perDoor:', JSON.stringify(summary.perDoor));
    const recent = await api('GET', '/api/scans?limit=5', adminTok);
    console.log('recent events:');
    for (const e of recent) {
        console.log(`  ${e.scanned_at}  ${e.decision.toUpperCase().padEnd(7)} ${e.reason.padEnd(20)} door=${e.door_name} user=${e.user_name || '-'}`);
    }

    console.log('\nE2E complete.');
})().catch((e) => {
    console.error('\nE2E FAILED:', e.message);
    process.exit(1);
});
