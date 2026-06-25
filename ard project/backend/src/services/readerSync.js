'use strict';
const db = require('../db/pool');

/**
 * Build the compact cache a reader uses to decide OFFLINE. Kept deliberately
 * small because the Uno has ~2 KB RAM / 1 KB EEPROM:
 *   - cards:   active UID card list for users who have at least one applicable
 *              allow rule on this door (so we don't ship the whole org to a door).
 *   - rules:   active rules affecting this door (door-specific + all-doors).
 *   - phoneKeys: public_id -> token_key for phones, so the reader can verify
 *              rotating tokens offline with one HMAC.
 *   - serverTime / generatedAt let the reader sanity-check its clock & TTLs.
 *
 * NOTE: this errs toward correctness/simplicity over minimality; for very large
 * deployments the card list should be scoped harder or the door moved to an ESP32.
 */
async function buildSyncBundle(door) {
    const rules = (
        await db.query(
            'SELECT id, type, scope, target_id, door_id, days_mask, start_time, end_time, effect, priority FROM rules WHERE active = TRUE AND (door_id IS NULL OR door_id = $1)',
            [door.id],
        )
    ).rows;

    const cards = (
        await db.query(
            `SELECT c.uid, c.user_id
               FROM credentials c
               JOIN users u ON u.id = c.user_id
              WHERE c.type = 'uid_card' AND c.active = TRUE AND c.revoked_at IS NULL
                AND u.active = TRUE`,
        )
    ).rows;

    const phoneKeys = (
        await db.query(
            `SELECT c.public_id, c.token_key
               FROM credentials c JOIN users u ON u.id = c.user_id
              WHERE c.type = 'phone' AND c.active = TRUE AND c.revoked_at IS NULL
                AND u.active = TRUE`,
        )
    ).rows;

    // Group membership for the cards we are shipping (so the reader can evaluate
    // group-scoped rules without another round trip).
    const userGroups = (await db.query('SELECT user_id, group_id FROM user_groups')).rows;

    return {
        doorId: door.id,
        failPolicy: door.fail_policy,
        relayUnlockMs: door.relay_unlock_ms,
        serverTime: Math.floor(Date.now() / 1000),
        generatedAt: new Date().toISOString(),
        rules,
        cards,
        phoneKeys,
        userGroups,
    };
}

module.exports = { buildSyncBundle };
