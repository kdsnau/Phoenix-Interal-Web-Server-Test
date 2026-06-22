const { test } = require('node:test');
const assert = require('node:assert/strict');
const qb = require('../lib/qbImport');

test('qbAmount parses money cells', () => {
    assert.equal(qb.qbAmount(1234.56), 1234.56);
    assert.equal(qb.qbAmount('1,234.56'), 1234.56);
    assert.equal(qb.qbAmount('$1,234.56'), 1234.56);
    assert.equal(qb.qbAmount('(123.45)'), -123.45);   // parens = negative
    assert.equal(qb.qbAmount(''), null);
    assert.equal(qb.qbAmount(null), null);
    assert.equal(qb.qbAmount('n/a'), null);
});

test('qbDate normalizes to YYYY-MM-DD', () => {
    assert.equal(qb.qbDate('1/5/26'), '2026-01-05');
    assert.equal(qb.qbDate('01/05/2026'), '2026-01-05');
    assert.equal(qb.qbDate(new Date(2026, 0, 5)), '2026-01-05');
    const serial = Math.round((Date.UTC(2026, 0, 5) - Date.UTC(1899, 11, 30)) / 86400000); // Excel epoch
    assert.equal(qb.qbDate(serial), '2026-01-05');
    assert.equal(qb.qbDate(''), null);
    assert.equal(qb.qbDate('not a date'), null);
});

test('topLevelCustomer strips rep/bracket prefixes and sub-jobs', () => {
    assert.equal(qb.topLevelCustomer('Acme:Job:Service'), 'Acme');
    assert.equal(qb.topLevelCustomer('** REP ** Acme:Job'), 'Acme');
    assert.equal(qb.topLevelCustomer('[DND] Acme'), 'Acme');
    assert.equal(qb.topLevelCustomer(''), null);
});

test('subAccount returns the path after the top-level customer', () => {
    assert.equal(qb.subAccount('Acme:Camelview:Hosting'), 'Camelview:Hosting');
    assert.equal(qb.subAccount('Acme'), null);
});

test('isJunkCustomer flags header / total / period rows', () => {
    for (const j of ['Customer', 'Total', 'TOTAL Acme', 'Jan - Dec 26']) assert.equal(qb.isJunkCustomer(j), true, j);
    for (const ok of ['Acme', 'The Pharm']) assert.equal(qb.isJunkCustomer(ok), false, ok);
});

test('isDeadCustomer flags DNS / DND / do-not-service', () => {
    for (const d of ['** DNS ** Acme', '[DND] Acme', 'Acme DO NOT SRVC']) assert.equal(qb.isDeadCustomer(d), true, d);
    assert.equal(qb.isDeadCustomer('Acme'), false);
});

test('invoiceAmounts splits paid / balance from open balance', () => {
    assert.deepEqual(qb.invoiceAmounts(5000, null),  { balance_due: 0,   paid_amount: 5000 }); // blank ⇒ fully paid
    assert.deepEqual(qb.invoiceAmounts(1305, 365),   { balance_due: 365, paid_amount: 940 });  // partial
    assert.deepEqual(qb.invoiceAmounts(760, 760),    { balance_due: 760, paid_amount: 0 });    // fully open
    assert.deepEqual(qb.invoiceAmounts(500, 999),    { balance_due: 500, paid_amount: 0 });    // clamp balance to total
    assert.deepEqual(qb.invoiceAmounts(500, -300),   { balance_due: 300, paid_amount: 200 });  // abs of negative
});

test('numberCandidates: invoice Num prefix and master Account No.', () => {
    const acctByName = new Map([['allied universal', '1234'], ['air gas', '599']]);
    // structured "digits-digits" prefix is the customer number
    assert.deepEqual(qb.numberCandidates({ name: 'Whoever', num: '1408-348', acctByName }), ['1408', '1408']);
    assert.deepEqual(qb.numberCandidates({ name: 'Whoever', num: '599-61', acctByName }), ['599']);
    // account map resolves by (case-insensitive) name
    assert.ok(qb.numberCandidates({ name: 'Allied Universal', num: 'FC 2605', acctByName }).includes('1234'));
});

test('numberCandidates: a finance charge never matches a document number', () => {
    // "FC 2605" has no digits-digits prefix; with no account match there are NO
    // candidates, so it can't be mis-matched to a client whose id is 2605.
    assert.deepEqual(qb.numberCandidates({ name: 'Unknown Co', num: 'FC 2605', acctByName: new Map() }), []);
});

test('end-to-end: totals reconcile (invoiced / paid / balance)', () => {
    // [customer, num, amount, openBalance]  ('' open balance ⇒ fully paid)
    const rows = [
        ['Optima:Hosting',  '691-367', 5000.00, ''],        // fully paid
        ['ProQual:Alarm',   '1500-78',  600.00, '600.00'],  // fully open
        ['Paradise:R6827',  '1949-02', 1305.00, '365.00'],  // partial → paid 940
        ['Culvers:Service', '1588-22',    0.00, ''],        // $0 → skipped
        ['Jan - Dec 26',    '',      999999.00, '999999'],  // report total row → skipped
    ];

    let invoiced = 0, paid = 0, balance = 0, count = 0;
    for (const [customer, , rawAmt, rawOb] of rows) {
        if (qb.isDeadCustomer(customer)) continue;
        const name = qb.topLevelCustomer(customer);
        if (!name || qb.isJunkCustomer(name)) continue;
        const amt = qb.qbAmount(rawAmt);
        if (amt == null || amt === 0) continue;
        const total = Math.abs(amt);
        const { balance_due, paid_amount } = qb.invoiceAmounts(total, qb.qbAmount(rawOb));
        invoiced += total; paid += paid_amount; balance += balance_due; count++;
    }

    assert.equal(count, 3);          // the $0 and the period-total row are excluded
    assert.equal(invoiced, 6905);    // 5000 + 600 + 1305
    assert.equal(paid, 5940);        // 5000 + 0 + 940
    assert.equal(balance, 965);      // 0 + 600 + 365
    assert.equal(invoiced, paid + balance);   // the invariant that must always hold
});
