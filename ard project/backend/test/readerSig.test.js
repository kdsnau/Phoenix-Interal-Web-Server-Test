'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { signatureBase, computeSignature, safeEqualHex } = require('../src/util/readerSig');

test('signature base string is the documented format', () => {
    assert.equal(
        signatureBase('POST', '/validate', 1700000000, '{"type":"uid_card"}'),
        'POST\n/validate\n1700000000\n{"type":"uid_card"}',
    );
});

test('same inputs + key produce the same signature (server == firmware reference)', () => {
    const key = 'deadbeef'.repeat(8);
    const a = computeSignature(key, 'GET', '/sync', 1700000000, '');
    const b = computeSignature(key, 'GET', '/sync', 1700000000, '');
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
});

test('a different key changes the signature', () => {
    const base = ['POST', '/validate', 1700000000, '{}'];
    assert.notEqual(
        computeSignature('a'.repeat(64), ...base),
        computeSignature('b'.repeat(64), ...base),
    );
});

test('safeEqualHex compares correctly', () => {
    assert.equal(safeEqualHex('abc123', 'abc123'), true);
    assert.equal(safeEqualHex('abc123', 'abc124'), false);
    assert.equal(safeEqualHex('abc', 'abcd'), false);
});
