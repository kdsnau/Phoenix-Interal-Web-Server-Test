'use strict';
/**
 * Pure, dependency-free access-decision engine.
 *
 * It takes already-loaded plain objects (no DB access here so it stays trivially
 * testable) and returns a decision. The DB layer in services/access.js is what
 * loads the rows and calls evaluate().
 *
 * Semantics (default-deny, deny-overrides):
 *   1. A missing / inactive / revoked credential or inactive user => denied.
 *   2. Otherwise collect the rules that APPLY (scope + door match + active) and
 *      are IN EFFECT at `when`:
 *        - door_access rules are always in effect (no time component).
 *        - time_window rules are in effect only when `when` lands inside their
 *          day mask + [start_time, end_time] window.
 *   3. If any in-effect rule says `deny`  -> denied  (deny always wins -- safest
 *      for a door).
 *      Else if any in-effect rule says `allow` -> granted.
 *      Else -> denied ("no_matching_allow"), i.e. default-deny.
 *   `priority` only breaks ties for which rule's id/name is reported as the reason.
 */

const DENY = (reason, ruleId) => ({ decision: 'denied', reason, ruleId: ruleId ?? null });
const GRANT = (reason, ruleId) => ({ decision: 'granted', reason, ruleId: ruleId ?? null });

/** Minutes-since-midnight for a "HH:MM" / "HH:MM:SS" string, or null. */
function toMinutes(t) {
    if (!t) return null;
    const [h, m] = String(t).split(':');
    return Number(h) * 60 + Number(m);
}

/** Does this rule target the given user (by scope)? */
function scopeMatches(rule, user) {
    if (rule.scope === 'all') return true;
    if (rule.scope === 'user') return rule.target_id === user.id;
    if (rule.scope === 'group') return (user.groupIds || []).includes(rule.target_id);
    return false;
}

/** Does this rule apply to the given door? (null door_id = every door) */
function doorMatches(rule, door) {
    return rule.door_id == null || rule.door_id === door.id;
}

/** Is a time_window rule active at `when`? door_access rules are always active. */
function inEffectNow(rule, when) {
    if (rule.type === 'door_access') return true;
    if (rule.type !== 'time_window') return false;

    // Day-of-week mask: bit i set means day i (0=Sun..6=Sat) is included.
    const dayBit = 1 << when.getDay();
    if ((rule.days_mask & dayBit) === 0) return false;

    const start = toMinutes(rule.start_time);
    const end = toMinutes(rule.end_time);
    if (start == null || end == null) return true; // window with no times = all day on matching days

    const nowMin = when.getHours() * 60 + when.getMinutes();
    if (start <= end) return nowMin >= start && nowMin < end;     // same-day window
    return nowMin >= start || nowMin < end;                       // overnight window (e.g. 22:00-06:00)
}

/**
 * @param {object}   ctx
 * @param {object}   ctx.credential  { id, type, active, revoked_at } | null
 * @param {object}   ctx.user        { id, active, groupIds:number[] } | null
 * @param {object}   ctx.door        { id }
 * @param {object[]} ctx.rules       all candidate rules (engine filters them)
 * @param {Date}     [ctx.when]      defaults to now
 * @returns {{decision:'granted'|'denied', reason:string, ruleId:number|null}}
 */
function evaluate({ credential, user, door, rules = [], when = new Date() }) {
    if (!credential) return DENY('unknown_credential');
    if (!credential.active || credential.revoked_at) return DENY('credential_revoked');
    if (!user || !user.active) return DENY('user_inactive');
    if (!door) return DENY('no_door');

    const applicable = rules.filter(
        (r) => r.active && scopeMatches(r, user) && doorMatches(r, door) && inEffectNow(r, when),
    );

    // Deny overrides everything. Highest priority deny supplies the reason.
    const denies = applicable.filter((r) => r.effect === 'deny');
    if (denies.length) {
        const top = denies.sort((a, b) => b.priority - a.priority)[0];
        return DENY('rule_deny', top.id);
    }

    const allows = applicable.filter((r) => r.effect === 'allow');
    if (allows.length) {
        const top = allows.sort((a, b) => b.priority - a.priority)[0];
        return GRANT('rule_allow', top.id);
    }

    return DENY('no_matching_allow');
}

module.exports = { evaluate, inEffectNow, scopeMatches, doorMatches, toMinutes };
