/**
 * migrate-missing-clients.js
 * Inserts the 22 monitored clients that appear in the Alarm Invoicing sheet
 * but have no existing DB record.
 *
 * Data sources: Alarm Invoicing sheet (alarm #, type, annual billing amount)
 *               + corroborating records from Service Report Tracker, Project
 *                 Tracker, Customer Remote Info, Maint Host - LX, and Daily Update.
 *
 * Run from the server directory:
 *   node migrate-missing-clients.js
 */

require('dotenv').config();
const pool = require('./db/pool');

/*
 * services field maps alarm type to the portal's service tag:
 *   Burg  → ['alarm']
 *   Fire  → ['fire']
 */
const NEW_CLIENTS = [
    // --- PAL CONSULTING fire panels (acct 1112) ----------------------------
    // All three confirmed in Service Report Tracker (R6552: cellular radio
    // installs Feb 2025) and Projects - Old - LX.
    { customer_id: '88-5914', name: 'PAL CONSULTING: 2929 GROW (FIRE)',       services: ['fire'],  annual: 600 },
    { customer_id: '88-5913', name: 'PAL CONSULTING: 2937 GROW (FIRE)',       services: ['fire'],  annual: 600 },
    { customer_id: '88-5915', name: 'PAL CONSULTING: 15TH AVE (FIRE)',        services: ['fire'],  annual: 600 },

    // --- JF LONG PROPERTIES panels (acct 716) ------------------------------
    // No service history found; monitoring-only accounts.
    { customer_id: '386097',  name: 'JF LONG PROPERTIES: OFFICE MAIN (BURG)', services: ['alarm'], annual: 540 },
    { customer_id: '386098',  name: 'JF LONG PROPERTIES: OFFICE MAIN (FIRE)', services: ['fire'],  annual: 600 },
    { customer_id: '386133',  name: 'JF LONG PROPERTIES: JFL 7136 (BURG)',    services: ['alarm'], annual: 540 },
    { customer_id: '386134',  name: 'JF LONG PROPERTIES: JFL 7136 (FIRE)',    services: ['fire'],  annual: 600 },
    { customer_id: '139946',  name: 'JF LONG PROPERTIES: JFL 7130 (FIRE)',    services: ['fire'],  annual: 600 },

    // --- PBP / PITNEY BOWES panels (acct 823) ------------------------------
    // Confirmed in Project Tracker (R6687: door station work Aug 2025).
    { customer_id: '88-5421', name: 'PBP: PITNEY BOWES - MAIN (FIRE)',        services: ['fire'],  annual: 540 },
    { customer_id: '130918',  name: 'PBP: PITNEY BOWES - GSA CELL (BURG)',    services: ['alarm'], annual: 540 },

    // --- THE PHARM (acct 1408) ---------------------------------------------
    // Confirmed in 7 sheets including Customer Remote Info (Rust ID 351919767).
    { customer_id: '88-3789', name: 'THE PHARM: SUNDAY GOODS TEMPE (BURG)',   services: ['alarm'], annual: 540 },

    // --- HANA MEDS / HANA MED (acct 1765) ----------------------------------
    // Broadway: confirmed in Project Tracker (R6309) and Service Report Tracker.
    // Hana Med (2nd panel): same account, separate alarm system.
    { customer_id: '131701',  name: 'HANA MEDS: BROADWAY DISPENSARY (BURG)',  services: ['alarm'], annual: 600 },
    { customer_id: '88-4901', name: 'HANA MED (BURG)',                         services: ['alarm'], annual: 540 },

    // --- SOUTHWEST CONCRETE PAVING (acct 1640) -----------------------------
    // Confirmed in Maint Host - LX (hosting acct HOST-669, 10 doors).
    { customer_id: '135366',  name: 'SOUTHWEST CONCRETE PAVING CO. (BURG)',   services: ['alarm'], annual: 660 },

    // --- JEEP FARM (acct 1762) ---------------------------------------------
    // Confirmed in Daily Update (W9896), OS Report Tracker, and Project Tracker.
    { customer_id: '88-5419', name: 'JEEP FARM (BURG)',                        services: ['alarm'], annual: 540 },

    // --- FBN OFFICE / WAREHOUSE (acct 1713) --------------------------------
    // Confirmed in Customer Remote Info (as "FBN Contracting").
    { customer_id: '139945',  name: 'FBN OFFICE / WAREHOUSE (BURG)',           services: ['alarm'], annual: 800 },

    // --- NUMARK TRANSPORTATION (acct 1905) ---------------------------------
    // Confirmed in Project Tracker (R6272 Jun 2024, R6541 Feb 2025).
    { customer_id: '88-4967', name: 'NUMARK TRANSPORTATION (BURG)',            services: ['alarm'], annual: 600 },

    // --- HEATHER WILSON (acct 1788) ----------------------------------------
    // Confirmed in Project Tracker (W10103 Apr 2025 — battery swap).
    { customer_id: '88-3784', name: 'HEATHER WILSON: RESIDENCE (BURG)',        services: ['alarm'], annual: 540 },

    // --- PUMP PROS INTERNATIONAL (acct 1924) --------------------------------
    // Confirmed in Daily Update + Project Tracker (R6643 — new install Jun–Aug 2025).
    { customer_id: '88-5413', name: 'PUMP PROS INTERNATIONAL (BURG)',          services: ['alarm'], annual: 200 },

    // --- CARTS & PARTS (acct 896) ------------------------------------------
    // No service history found; monitoring-only account.
    { customer_id: '386276',  name: 'CARTS & PARTS (BURG)',                    services: ['alarm'], annual: 480 },

    // --- LIUNA (acct 1730) -------------------------------------------------
    // No service history found; monitoring-only account.
    { customer_id: '380244',  name: 'LIUNA (FIRE)',                            services: ['fire'],  annual: 600 },

    // --- MAAX SPAS — BURG panel (acct 1218) --------------------------------
    // No service history found (fire panel already in DB at 88-4857).
    // Note: alarm 935026 is an unusual format — not an 88-series panel.
    { customer_id: '935026',  name: 'MAAX SPAS (BURG)',                        services: ['alarm'], annual: 600 },
];

async function run() {
    console.log('=== Phoenix Portal — Missing Client Insert ===\n');

    const inserted = [];
    const skipped  = [];

    for (const c of NEW_CLIENTS) {
        const monthly = (c.annual / 12).toFixed(2);

        const exists = await pool.query(
            'SELECT 1 FROM clients WHERE customer_id = $1', [c.customer_id]
        );
        if (exists.rowCount > 0) { skipped.push(c); continue; }

        const r = await pool.query(`
            INSERT INTO clients (customer_id, name, services, billing_amount, monitoring_enabled)
            VALUES ($1, $2, $3, $4, TRUE)
            RETURNING id, customer_id, name
        `, [c.customer_id, c.name, c.services, monthly]);

        if (r.rowCount > 0) {
            inserted.push({ ...c, monthly, id: r.rows[0].id });
        } else {
            skipped.push(c);
        }
    }

    console.log(`✅  INSERTED (${inserted.length} clients):`);
    console.log('─'.repeat(72));
    inserted.forEach(c =>
        console.log(`  [id ${String(c.id).padEnd(4)}] ${c.customer_id.padEnd(10)}  ${c.name.padEnd(48)}  $${c.monthly}/mo`)
    );

    if (skipped.length) {
        console.log(`\n⚠️   SKIPPED — customer_id already exists (${skipped.length}):`);
        skipped.forEach(c => console.log(`  ${c.customer_id.padEnd(10)}  ${c.name}`));
    }

    /* Quick MRR sanity check */
    const mrrResult = await pool.query(`
        SELECT COALESCE(SUM(billing_amount), 0) AS mrr
        FROM clients
        WHERE billing_amount IS NOT NULL AND billing_amount > 0
    `);
    const mrr = Number(mrrResult.rows[0].mrr);
    console.log(`\n💰  Current MRR after insert: $${mrr.toFixed(2)}/mo  ($${(mrr * 12).toFixed(0)}/yr)`);

    console.log('\nDone.');
    await pool.end();
}

run().catch(err => {
    console.error('Migration failed:', err.message);
    process.exit(1);
});
