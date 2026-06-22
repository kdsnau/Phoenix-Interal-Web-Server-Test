/* Pure helpers for the QuickBooks CSV/XLSX import (routes/clients.js).
   Extracted so the money-critical parsing + matching can be unit tested without
   a database or HTTP server. No side effects; the only dependency is xlsx, used
   solely to decode Excel serial dates. */
const XLSX = require('xlsx');

/* QuickBooks "Customer" cells look like "** REP ** Acme:Job:Service".
   The real top-level customer is the rep-prefix-stripped text before the first colon. */
function topLevelCustomer(raw) {
    let s = String(raw || '').trim();
    if (!s) return null;
    s = s.replace(/^\*\*[^*]*\*\*\s*/, '');   // drop "** REP **" / "** DNS **" prefix
    s = s.replace(/^\[[^\]]*\]\s*/, '');        // drop "[DND]" bracket prefix
    s = s.split(':')[0].trim();               // top-level customer only
    return s || null;
}

/* Header rows, subtotal rows, and report period labels ("Jan - Dec 26"). */
function isJunkCustomer(name) {
    const n = String(name || '').toLowerCase();
    if (n === 'customer') return true;
    if (n.startsWith('total')) return true;
    if (/^[a-z]{3,9} - [a-z]{3,9} \d{2,4}$/.test(n)) return true;
    return false;
}

/* Dead / do-not-service accounts flagged in older QB data — excluded from Unmonitored. */
function isDeadCustomer(raw) {
    const s = String(raw || '').toLowerCase();
    if (/\*\*\s*dns\s*\*\*/.test(s)) return true;     // "** DNS **"
    if (/\[dn[ds]/.test(s)) return true;              // "[DND]" / "[DNS]" (any variant)
    if (/do not s(?:rvc|erv)/.test(s)) return true;   // "DO NOT SRVC" / "DO NOT SERVICE"
    return false;
}

/* The sub-account path after the top-level customer ("Acme:Camelview:Hosting" → "Camelview:Hosting"). */
function subAccount(raw) {
    let s = String(raw || '').trim()
        .replace(/^\*\*[^*]*\*\*\s*/, '')
        .replace(/^\[[^\]]*\]\s*/, '');
    const i = s.indexOf(':');
    return i >= 0 ? s.slice(i + 1).trim() : null;
}

/* A date cell → "YYYY-MM-DD", or null. Handles XLSX's three forms: an Excel
   serial number, a JS Date, or a literal "M/D/YY" / "MM/DD/YYYY" string. */
function qbDate(raw) {
    if (raw == null || raw === '') return null;
    if (raw instanceof Date) {
        return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, '0')}-${String(raw.getDate()).padStart(2, '0')}`;
    }
    if (typeof raw === 'number') {
        const o = XLSX.SSF.parse_date_code(raw);
        if (!o || !o.y) return null;
        return `${o.y}-${String(o.m).padStart(2, '0')}-${String(o.d).padStart(2, '0')}`;
    }
    const m = String(raw).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m) return null;
    let [, mo, d, y] = m;
    if (y.length === 2) y = '20' + y;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/* Parse a money cell — number, "1,234.56", "$1,234.56", or "(123.45)" → Number or null. */
function qbAmount(raw) {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number') return raw;
    let s = String(raw).trim();
    const neg = /^\(.*\)$/.test(s);
    s = s.replace(/[(),$\s]/g, '');
    if (s === '' || isNaN(Number(s))) return null;
    return neg ? -Number(s) : Number(s);
}

/* Split an invoice into paid / balance from its Open Balance:
   balance = Open Balance (blank/null ⇒ fully paid), clamped to the total;
   paid = total − balance. `ob` is the already-parsed open balance (number|null). */
function invoiceAmounts(total, ob) {
    const balance_due = ob != null ? Math.min(Math.abs(ob), total) : 0;
    const paid_amount = Math.max(0, total - balance_due);
    return { balance_due, paid_amount };
}

/* A standalone 4-digit run (the client account number scheme). */
const fourDigit = s => { const m = String(s || '').match(/(?<!\d)\d{4}(?!\d)/); return m ? m[0] : null; };

/* Normalize a raw account/customer number for comparison. */
const numKey = s => String(s || '').trim().toUpperCase().replace(/\s+/g, '');

/* The customer number an invoice should match a client on, in priority order:
   the Account No. from the customer master (by name), then the invoice Num's
   structured prefix ("1408-348" → "1408"; "FC 2605" yields none — it has no
   "digits-digits" prefix, so a finance charge never matches a document number).
   Returns the candidate keys to look up against the client-by-number index. */
function numberCandidates({ name, num, acctByName }) {
    const acct   = acctByName && acctByName.get ? acctByName.get(String(name || '').toLowerCase()) : undefined;
    const prefix = (String(num || '').match(/^(\d{3,5})-\d+/) || [])[1] || null;
    return [numKey(acct), fourDigit(acct), numKey(prefix), fourDigit(prefix)].filter(Boolean);
}

module.exports = {
    topLevelCustomer, isJunkCustomer, isDeadCustomer, subAccount,
    qbDate, qbAmount, invoiceAmounts, fourDigit, numKey, numberCandidates,
};
