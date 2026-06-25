'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('../src/services/ruleEngine');

const door = { id: 1 };
const activeCred = { id: 10, type: 'uid_card', active: true, revoked_at: null };
const activeUser = { id: 100, active: true, groupIds: [7] };

// A Wednesday at 12:00 and at 20:00 (getDay()===3 for 2026-06-24).
const noon = new Date('2026-06-24T12:00:00');
const evening = new Date('2026-06-24T20:00:00');
const ALL_DAYS = 127;

function allowAll(extra = {}) {
    return { id: 1, type: 'door_access', scope: 'all', target_id: null, door_id: null,
        days_mask: ALL_DAYS, effect: 'allow', priority: 0, active: true, ...extra };
}
function window9to5(extra = {}) {
    return { id: 2, type: 'time_window', scope: 'all', target_id: null, door_id: null,
        days_mask: ALL_DAYS, start_time: '09:00', end_time: '17:00', effect: 'allow',
        priority: 0, active: true, ...extra };
}

test('default-deny when no rules match', () => {
    const r = evaluate({ credential: activeCred, user: activeUser, door, rules: [], when: noon });
    assert.equal(r.decision, 'denied');
    assert.equal(r.reason, 'no_matching_allow');
});

test('unknown credential is denied', () => {
    const r = evaluate({ credential: null, user: activeUser, door, rules: [allowAll()], when: noon });
    assert.equal(r.decision, 'denied');
    assert.equal(r.reason, 'unknown_credential');
});

test('revoked credential is denied even with allow rule', () => {
    const cred = { ...activeCred, revoked_at: new Date() };
    const r = evaluate({ credential: cred, user: activeUser, door, rules: [allowAll()], when: noon });
    assert.equal(r.decision, 'denied');
    assert.equal(r.reason, 'credential_revoked');
});

test('inactive user is denied', () => {
    const r = evaluate({ credential: activeCred, user: { ...activeUser, active: false }, door, rules: [allowAll()], when: noon });
    assert.equal(r.decision, 'denied');
    assert.equal(r.reason, 'user_inactive');
});

test('door_access allow grants', () => {
    const r = evaluate({ credential: activeCred, user: activeUser, door, rules: [allowAll()], when: noon });
    assert.equal(r.decision, 'granted');
});

test('time window grants inside 9-5 and denies outside', () => {
    const inside = evaluate({ credential: activeCred, user: activeUser, door, rules: [window9to5()], when: noon });
    assert.equal(inside.decision, 'granted');
    const outside = evaluate({ credential: activeCred, user: activeUser, door, rules: [window9to5()], when: evening });
    assert.equal(outside.decision, 'denied');
    assert.equal(outside.reason, 'no_matching_allow');
});

test('deny overrides allow (blocklist beats allow-all)', () => {
    const deny = { id: 3, type: 'door_access', scope: 'user', target_id: activeUser.id, door_id: null,
        days_mask: ALL_DAYS, effect: 'deny', priority: 0, active: true };
    const r = evaluate({ credential: activeCred, user: activeUser, door, rules: [allowAll(), deny], when: noon });
    assert.equal(r.decision, 'denied');
    assert.equal(r.reason, 'rule_deny');
    assert.equal(r.ruleId, 3);
});

test('group-scoped allow applies to a member', () => {
    const groupAllow = allowAll({ id: 4, scope: 'group', target_id: 7 });
    const r = evaluate({ credential: activeCred, user: activeUser, door, rules: [groupAllow], when: noon });
    assert.equal(r.decision, 'granted');
});

test('group-scoped allow does NOT apply to a non-member', () => {
    const groupAllow = allowAll({ id: 4, scope: 'group', target_id: 999 });
    const r = evaluate({ credential: activeCred, user: activeUser, door, rules: [groupAllow], when: noon });
    assert.equal(r.decision, 'denied');
});

test('rule for a different door is ignored', () => {
    const otherDoor = allowAll({ door_id: 2 });
    const r = evaluate({ credential: activeCred, user: activeUser, door, rules: [otherDoor], when: noon });
    assert.equal(r.decision, 'denied');
});

test('day mask excludes the wrong day', () => {
    // mask with only Monday (bit 1). Wednesday tap should not match.
    const mondayOnly = window9to5({ days_mask: 1 << 1 });
    const r = evaluate({ credential: activeCred, user: activeUser, door, rules: [mondayOnly], when: noon });
    assert.equal(r.decision, 'denied');
});

test('overnight window (22:00-06:00) grants at 02:00', () => {
    const night = window9to5({ start_time: '22:00', end_time: '06:00' });
    const at2am = new Date('2026-06-24T02:00:00');
    const r = evaluate({ credential: activeCred, user: activeUser, door, rules: [night], when: at2am });
    assert.equal(r.decision, 'granted');
});
