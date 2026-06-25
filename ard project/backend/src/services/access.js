'use strict';
const db = require('../db/pool');
const { evaluate } = require('./ruleEngine');
const { verifyToken } = require('./tokens');

/** Load a user plus the ids of the groups they belong to. */
async function loadUserWithGroups(userId) {
    const { rows } = await db.query('SELECT id, active FROM users WHERE id = $1', [userId]);
    const user = rows[0];
    if (!user) return null;
    const g = await db.query('SELECT group_id FROM user_groups WHERE user_id = $1', [userId]);
    user.groupIds = g.rows.map((r) => r.group_id);
    return user;
}

/** Rules that could apply to this door (door-specific or all-doors). Engine filters further. */
async function loadRulesForDoor(doorId) {
    const { rows } = await db.query(
        'SELECT * FROM rules WHERE active = TRUE AND (door_id IS NULL OR door_id = $1)',
        [doorId],
    );
    return rows;
}

async function logEvent({ doorId, credentialId, userId, decision, reason, rawUid, wasOffline }) {
    await db.query(
        `INSERT INTO access_events
           (door_id, credential_id, user_id, decision, reason, raw_uid, was_offline)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [doorId ?? null, credentialId ?? null, userId ?? null, decision, reason, rawUid ?? null, !!wasOffline],
    );
}

/**
 * Authoritative online decision for one tap. Resolves the credential, runs the
 * rule engine, writes an access_events row, and returns what the reader needs.
 *
 * @param {object} door  the door row (from readerAuth)
 * @param {object} tap   { type:'uid_card'|'phone', uid?, token?, wasOffline? }
 */
async function decide(door, tap, when = new Date()) {
    let credential = null;
    let rawUid = tap.uid || null;

    if (tap.type === 'uid_card') {
        const { rows } = await db.query(
            `SELECT * FROM credentials WHERE type='uid_card' AND uid = $1`,
            [tap.uid],
        );
        credential = rows[0] || null;
    } else if (tap.type === 'phone') {
        const publicId = String(tap.token || '').split('.')[0];
        const { rows } = await db.query(
            `SELECT * FROM credentials WHERE type='phone' AND public_id = $1`,
            [publicId],
        );
        const cred = rows[0] || null;
        const v = verifyToken(tap.token, () => cred, when.getTime());
        if (!v.ok) {
            await logEvent({ doorId: door.id, decision: 'denied', reason: v.reason, rawUid, wasOffline: tap.wasOffline });
            return { decision: 'denied', reason: v.reason, unlock_ms: 0 };
        }
        credential = cred;
    } else {
        return { decision: 'denied', reason: 'bad_tap_type', unlock_ms: 0 };
    }

    const user = credential ? await loadUserWithGroups(credential.user_id) : null;
    const rules = await loadRulesForDoor(door.id);
    const result = evaluate({ credential, user, door: { id: door.id }, rules, when });

    await logEvent({
        doorId: door.id,
        credentialId: credential ? credential.id : null,
        userId: user ? user.id : null,
        decision: result.decision,
        reason: result.reason,
        rawUid,
        wasOffline: tap.wasOffline,
    });

    return {
        decision: result.decision,
        reason: result.reason,
        unlock_ms: result.decision === 'granted' ? door.relay_unlock_ms : 0,
    };
}

/** Record an event the reader already decided offline (backfill on reconnect). */
async function recordOfflineEvent(door, ev) {
    let credentialId = null;
    let userId = null;
    if (ev.uid) {
        const { rows } = await db.query(
            `SELECT c.id, c.user_id FROM credentials c WHERE c.uid = $1`,
            [ev.uid],
        );
        if (rows[0]) {
            credentialId = rows[0].id;
            userId = rows[0].user_id;
        }
    }
    await logEvent({
        doorId: door.id,
        credentialId,
        userId,
        decision: ev.decision,
        reason: ev.reason || 'offline_cache',
        rawUid: ev.uid || null,
        wasOffline: true,
    });
}

module.exports = { decide, recordOfflineEvent, loadUserWithGroups, loadRulesForDoor };
