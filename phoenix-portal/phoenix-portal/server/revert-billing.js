/**
 * revert-billing.js
 * Removes all billing data sourced from the Alarm Invoicing sheet,
 * which has been confirmed as out of date.
 *
 * What this does:
 *   1. Deletes the 22 client records inserted by migrate-missing-clients.js
 *   2. Clears billing_amount and monitoring_enabled on all remaining clients
 *
 * Run from the server directory:
 *   node revert-billing.js
 */

require('dotenv').config();
const pool = require('./db/pool');

/* customer_ids of the 22 clients inserted by migrate-missing-clients.js */
const INSERTED_CIDS = [
    '88-5914', '88-5913', '88-5915',
    '386097',  '386098',  '386133',  '386134',  '139946',
    '88-5421', '130918',
    '88-3789',
    '131701',  '88-4901',
    '135366',
    '88-5419',
    '139945',
    '88-4967',
    '88-3784',
    '88-5413',
    '386276',
    '380244',
    '935026',
];

async function run() {
    console.log('=== Phoenix Portal — Billing Data Revert ===\n');

    /* Step 1: Delete the 22 inserted clients */
    const del = await pool.query(
        `DELETE FROM clients WHERE customer_id = ANY($1) RETURNING customer_id, name`,
        [INSERTED_CIDS]
    );
    console.log(`✅  Deleted ${del.rowCount} inserted clients:`);
    del.rows.forEach(r => console.log(`     ${r.customer_id.padEnd(10)}  ${r.name}`));

    /* Step 2: Clear billing_amount and monitoring_enabled on all remaining clients */
    const clear = await pool.query(
        `UPDATE clients SET billing_amount = NULL, monitoring_enabled = FALSE`
    );
    console.log(`\n✅  Cleared billing_amount and monitoring_enabled on ${clear.rowCount} remaining clients`);

    /* Confirm MRR is now zero */
    const mrr = await pool.query(
        `SELECT COALESCE(SUM(billing_amount), 0) AS mrr FROM clients WHERE billing_amount > 0`
    );
    console.log(`\n💰  MRR after revert: $${Number(mrr.rows[0].mrr).toFixed(2)}/mo`);

    console.log('\nDone.');
    await pool.end();
}

run().catch(err => {
    console.error('Revert failed:', err.message);
    process.exit(1);
});
