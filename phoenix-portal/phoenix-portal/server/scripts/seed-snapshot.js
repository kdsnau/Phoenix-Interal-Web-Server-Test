#!/usr/bin/env node
/* ==========================================================================
   One-time seed for the Financials → Snapshot board, from the
   "Alarm - Daily Update" sheet (PROJECTS IN PROGRESS / COMPLETED PROJECTS /
   DEADBEATS & PROBLEM PILE).

   Usage:   node scripts/seed-snapshot.js
   Safe:    aborts if snapshot_entries already has rows (won't double-seed).
   ========================================================================== */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pool = require('../db/pool');

/* In-progress: [customer, rfq, hours, scheduled_date, notes] */
const IN_PROGRESS = [
    ['Verrado Regent Hills',   'R6622-1', 65, 'TBD', 'Good to go'],
    ['Asbury dba World Oil',   'R6828',  102, 'TBD', 'PO P500-00148608 Pending CO'],
    ['Terros Health',          'R6808-2', 36, 'TBD', 'Good to go'],
    ['Robson Resort Goodyear', 'R6807',   24, 'TBD', 'Good to go'],
];

/* Complete / Deadbeat: [customer, invoice_num, email_date, rfq, notes] */
const COMPLETE = [
    ['Hydro',                          '962-95',        '05/13/26',   'R6861',          'Complete 06/26/26'],
    ['Hydro',                          '962-91',        '05/14/26',   'R6834-1',        'Complete 06/28/26'],
    ['Paradise Reserve Additional Cam','1949-02',       '05/06/26',   'R6827-3',        'Complete on partial $ due'],
    ['Quick Corner 3',                 '1951-01F',      '',           'R6842',          'Complete and will no longer install for them'],
    ['Briggs',                         '1341-10F',      '05/27/26',   'R6724',          'Complete'],
    ['Fairview Manor (Tucson)',        '1387-25',       '06/04/26',   'R6786',          'Complete Did F/U Call for Vicki'],
    ['Fort Wekopa Resort',             '523-152',       '06/09/26',   'R6872',          'Complete'],
    ['Fort Control Main',              '523-153',       '06/09/26',   'R6869',          'Complete'],
    ['Ave Living TERRA',               '1847-71F',      '06/09/26',   'R6844',          'Final to be done with CO this is install'],
    ['Ave Living TERRA / Sky',         '1847-73,74 CO', '06/15/26',   'R6844/R6847',    'Complete'],
    ['Foresight',                      '1881-35',       '06/23/26',   'R6873',          'Complete'],
    ['The Pharm Distribution Center',  'R6587-3',       '06/23/2026', 'R6587-3',        'Complete'],
];

const DEADBEAT = [
    ['Papago',         '737-27F',  '09/29/23', 'R6299', 'No longer able to Service SORRY DEADBEAT'],
    ['Cyrus Bldg 9',   '1654-19F', '11/06/23', 'R6102', 'UGH NOW LEGAL'],
    ['Genie Car Wash', 'AM CO',    '???',      'R6332', 'AM to bill change order ALL ADAM ALL THE TIME'],
    ['Pump Pros',      '1924-01F', '07/08/25', 'R6643', 'FF Debacle per AM BD this is now a DNS sccount'],
];

const nn = s => { const v = (s == null ? '' : String(s)).trim(); return v === '' ? null : v; };

async function main() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS snapshot_entries (
            id SERIAL PRIMARY KEY, type TEXT NOT NULL, customer TEXT NOT NULL,
            rfq TEXT, hours NUMERIC, scheduled_date TEXT, invoice_num TEXT,
            email_date TEXT, notes TEXT, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
        )
    `);

    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM snapshot_entries');
    if (rows[0].n > 0) {
        console.log(`snapshot_entries already has ${rows[0].n} rows — refusing to double-seed. Clear it first if you really want to re-seed.`);
        await pool.end();
        return;
    }

    let n = 0;
    for (const [customer, rfq, hours, scheduled_date, notes] of IN_PROGRESS) {
        await pool.query(
            `INSERT INTO snapshot_entries (type, customer, rfq, hours, scheduled_date, notes) VALUES ('in_progress',$1,$2,$3,$4,$5)`,
            [nn(customer), nn(rfq), hours, nn(scheduled_date), nn(notes)]
        ); n++;
    }
    for (const [type, list] of [['complete', COMPLETE], ['deadbeat', DEADBEAT]]) {
        for (const [customer, invoice_num, email_date, rfq, notes] of list) {
            await pool.query(
                `INSERT INTO snapshot_entries (type, customer, invoice_num, email_date, rfq, notes) VALUES ($1,$2,$3,$4,$5,$6)`,
                [type, nn(customer), nn(invoice_num), nn(email_date), nn(rfq), nn(notes)]
            ); n++;
        }
    }
    console.log(`Seeded ${n} snapshot entries (${IN_PROGRESS.length} in progress, ${COMPLETE.length} complete, ${DEADBEAT.length} deadbeat).`);
    await pool.end();
}

main().catch(err => { console.error('Seed failed:', err.message); process.exit(1); });
