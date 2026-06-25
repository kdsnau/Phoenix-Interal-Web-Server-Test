'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { issueToken, verifyToken, newTokenKey, newPublicId } = require('../src/services/tokens');

function makeCred() {
    return { public_id: newPublicId(), token_key: newTokenKey() };
}
const lookupFor = (cred) => (pid) => (pid === cred.public_id ? cred : null);

test('a freshly issued token verifies', () => {
    const cred = makeCred();
    const { token } = issueToken(cred, 180);
    const r = verifyToken(token, lookupFor(cred));
    assert.equal(r.ok, true);
    assert.equal(r.publicId, cred.public_id);
});

test('an expired token is rejected', () => {
    const cred = makeCred();
    const now = Date.now();
    const { token } = issueToken(cred, 180, now);
    const r = verifyToken(token, lookupFor(cred), now + 181_000);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'expired');
});

test('a tampered signature is rejected', () => {
    const cred = makeCred();
    const { token } = issueToken(cred, 180);
    const [pid, exp, sig] = token.split('.');
    const flipped = sig[0] === 'a' ? 'b' : 'a';
    const bad = `${pid}.${exp}.${flipped}${sig.slice(1)}`;
    const r = verifyToken(bad, lookupFor(cred));
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'bad_signature');
});

test('a token signed with another key is rejected', () => {
    const cred = makeCred();
    const attacker = { public_id: cred.public_id, token_key: newTokenKey() };
    const { token } = issueToken(attacker, 180);
    const r = verifyToken(token, lookupFor(cred)); // verify against the real key
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'bad_signature');
});

test('unknown public id is rejected', () => {
    const cred = makeCred();
    const { token } = issueToken(cred, 180);
    const r = verifyToken(token, () => null);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'unknown_public_id');
});

test('malformed tokens are rejected', () => {
    const cred = makeCred();
    for (const t of ['', 'nope', 'a.b', 'a.b.c.d']) {
        assert.equal(verifyToken(t, lookupFor(cred)).ok, false);
    }
});
