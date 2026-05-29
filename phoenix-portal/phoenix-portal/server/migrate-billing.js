/**
 * migrate-billing.js
 * Wipes test billing data and populates real billing_amount + monitoring_enabled
 * from the 2025-2026 Alarm Invoicing sheet.
 *
 * Billing amounts in the sheet are ANNUAL — stored in DB as monthly (annual / 12).
 * Alarm # → customer_id mapping:
 *   6-digit alarms starting with "88" → "88-XXXX"  (e.g. 884863 → "88-4863")
 *   All others                         → used as-is  (e.g. 130916 → "130916")
 *
 * Run from the server directory:
 *   node migrate-billing.js
 */

require('dotenv').config();
const pool = require('./db/pool');

/* Convert a sheet alarm number to the DB customer_id format */
function toCid(alarm) {
    const s = String(alarm);
    if (/^88\d{4}$/.test(s)) return `88-${s.slice(2)}`;
    return s;
}

/* ------------------------------------------------------------------
   Active accounts with billing amounts from the 2025-2026 sheet.
   annual = yearly invoice amount in dollars.
   ------------------------------------------------------------------ */
const BILLING = [
    // JANUARY
    { alarm: '137877', annual: 600,  name: 'ProQual 402 Bld.' },
    { alarm: '130914', annual: 265,  name: 'I-17 Auto Cell' },
    { alarm: '139941', annual: 600,  name: 'BLT Modern Tortilla' },
    { alarm: '139943', annual: 540,  name: 'Pal Consulting 15th Ave (Burg)' },
    { alarm: '135366', annual: 660,  name: 'Southwest Concrete Paving' },
    { alarm: '885437', annual: 600,  name: 'DP Consulting Residence' },
    { alarm: '884893', annual: 600,  name: 'DP Consulting Main (Fire)' },
    { alarm: '885414', annual: 540,  name: 'I Smoke (Shea)' },

    // FEBRUARY
    { alarm: '885914', annual: 600,  name: 'Pal Consulting 2929 Grow (Fire)' },
    { alarm: '885913', annual: 600,  name: 'Pal Consulting 2937 Grow (Fire)' },
    { alarm: '885915', annual: 600,  name: 'Pal Consulting 15th Ave (Fire)' },
    { alarm: '135363', annual: 540,  name: 'Dairy Queen 28th Dr' },
    { alarm: '137879', annual: 600,  name: 'Arizona Professional Painting' },
    { alarm: '386071', annual: 480,  name: 'Jeff Dadam' },
    { alarm: '885439', annual: 480,  name: 'Quality Woods' },
    { alarm: '386073', annual: 480,  name: 'Jeff Dadam Guest House' },
    { alarm: '386093', annual: 540,  name: 'Desert Lakes Apts: Maintenance' },

    // MARCH
    { alarm: '386111', annual: 960,  name: 'Sunbelt Management (Fire)' },
    { alarm: '884936', annual: 600,  name: 'DRINIQUE' },
    { alarm: '885418', annual: 420,  name: 'APD Power Center' },
    { alarm: '885419', annual: 540,  name: 'Jeep Farm' },
    { alarm: '386098', annual: 600,  name: 'JF Long Office Main (Fire)' },
    { alarm: '386133', annual: 540,  name: 'JF Long JFL 7136 (Burg)' },
    { alarm: '386276', annual: 480,  name: 'Carts & Parts' },
    { alarm: '386097', annual: 540,  name: 'JF Long Office Main (Burg)' },
    { alarm: 'EL1719', annual: 505,  name: 'Foresight ~ Priest (Elevator)' },

    // APRIL
    { alarm: '884904', annual: 600,  name: 'STSS 63rd Ave (Acct 1408)' },
    { alarm: '130909', annual: 660,  name: 'ProQual 411/423 Bld.' },
    { alarm: '885446', annual: 600,  name: 'Verde Industries (Fire 1)' },
    { alarm: '885447', annual: 600,  name: 'Verde Industries (Fire 2)' },
    { alarm: '139945', annual: 800,  name: 'FBN Office/Warehouse (Burg)' },
    { alarm: '885422', annual: 600,  name: 'STSS 63rd Ave (Acct 1423)' },
    { alarm: '386134', annual: 600,  name: 'JF Long JFL 7136 (Fire)' },

    // MAY
    { alarm: '139946', annual: 600,  name: 'JF Long JFL 7130 (Fire)' },
    { alarm: '380244', annual: 600,  name: 'Liuna (Fire)' },
    { alarm: '885423', annual: 660,  name: 'ICM Document Solutions' },
    { alarm: '884857', annual: 600,  name: 'MAAX Spas (Fire)' },
    { alarm: '884863', annual: 1200, name: 'Achen-Garner Construction' },
    { alarm: '884865', annual: 600,  name: 'Biltmore ENT' },
    { alarm: '885404', annual: 600,  name: 'First Lineage (Fire)' },
    { alarm: '884940', annual: 540,  name: 'Hellas Construction' },
    { alarm: '131008', annual: 600,  name: 'Sunbelt Climate Control Rentals' },
    { alarm: '386079', annual: 540,  name: 'Ramen Deep DQ Baseline (Fire)' },

    // JUNE
    { alarm: '130912', annual: 600,  name: 'BuyBack Boss' },
    { alarm: '137884', annual: 600,  name: 'Culvers (Queen Creek)' },
    { alarm: '135479', annual: 600,  name: 'JF Long Building B' },
    { alarm: '884964', annual: 600,  name: 'Verde Industries (Burg)' },
    { alarm: '884967', annual: 600,  name: 'Numark Transportation' },
    { alarm: '884971', annual: 600,  name: 'Ztejas' },

    // JULY
    { alarm: '130913', annual: 600,  name: 'Ellen Dean' },
    { alarm: '131701', annual: 600,  name: 'Hana Meds Broadway' },
    { alarm: '885442', annual: 600,  name: 'Envoy Data' },

    // AUGUST
    { alarm: '130916', annual: 660,  name: 'Torah Day School' },
    { alarm: '130917', annual: 540,  name: 'Jamie Regina' },
    { alarm: '386140', annual: 600,  name: 'Sunbelt: Casual Astronaut' },
    { alarm: '131568', annual: 540,  name: 'The Pharm: Wilcox' },
    { alarm: '131578', annual: 600,  name: 'Pal Consulting Warehouse' },
    { alarm: '885417', annual: 720,  name: 'Assa Abloy (10027 S 51st)' },
    { alarm: '885906', annual: 605,  name: 'Desert Appeal' },
    { alarm: 'EL1401', annual: 360,  name: 'Flora Tech (Elevator)' },
    { alarm: '883768', annual: 540,  name: 'JF Long JFL 7130 (Burg)' },
    { alarm: '883784', annual: 540,  name: 'Heather Wilson Residence' },
    { alarm: '884972', annual: 900,  name: 'Event Rents' },
    { alarm: '885402', annual: 720,  name: 'Jupiter Research' },
    { alarm: '885413', annual: 200,  name: 'Pump Pros International' },

    // SEPTEMBER
    { alarm: '885421', annual: 540,  name: 'PBP: Pitney Bowes (Fire)' },
    { alarm: '130915', annual: 540,  name: 'PBP: Pitney Bowes (Burg)' },
    { alarm: '130918', annual: 540,  name: 'PBP: Pitney Bowes GSA' },
    { alarm: '130919', annual: 660,  name: 'FairyTale Brownies' },
    { alarm: '139954', annual: 600,  name: 'Pal 2929 Grow (Burg)' },
    { alarm: '135469', annual: 540,  name: 'Ramen Deep DQ Lake Pleasant' },
    { alarm: '386082', annual: 600,  name: 'Flora Tech (Fire)' },
    { alarm: '884892', annual: 780,  name: 'Foresight Technologies (Burg)' },
    { alarm: '884895', annual: 540,  name: 'STSS Recycling 39th Buckeye' },

    // OCTOBER
    { alarm: '883786', annual: 540,  name: 'The Pharm: Sunday Goods Tempe (Fire)' },
    { alarm: '883789', annual: 540,  name: 'The Pharm: Sunday Goods Tempe (Burg)' },
    { alarm: '131576', annual: 600,  name: 'Cork N Bottle' },
    { alarm: '139952', annual: 540,  name: 'Pal Consulting 3006' },
    { alarm: '884901', annual: 540,  name: 'Hana Med' },
    { alarm: '885902', annual: 1020, name: 'Foresight Technologies 1301' },
    { alarm: '935026', annual: 600,  name: 'MAAX Spas (Burg)' },

    // DECEMBER (past due / active)
    { alarm: '885407', annual: 540,  name: 'I Smoke (Shea) Grey Hawk' },
];

/* ------------------------------------------------------------------
   Cancelled accounts — monitoring_enabled stays FALSE (default).
   Listed here for reference / audit trail only.
   ------------------------------------------------------------------ */
const CANCELLED = [
    { alarm: '135460', name: 'Vinco Inc. (cancelled 4/28/25)' },
    { alarm: '135466', name: 'Ramen Deep DQ Baseline Burg (cancelled 5/7/25)' },
    { alarm: '386105', name: 'Mega Metals Inc. (cancelled 5/6/25)' },
    { alarm: '885732', name: 'GG&D Motor Vehicle Services (sold building)' },
];

/* ------------------------------------------------------------------
   $0 monitored accounts — monitoring enabled but no billing amount.
   ------------------------------------------------------------------ */
const FREE_MONITORING = [
    { alarm: '885409', name: 'Ramsey Residence' },
    { alarm: '884874', name: 'Damien Clark' },
];

async function run() {
    console.log('=== Phoenix Portal — Billing Migration ===\n');

    /* Step 1: Reset all test data */
    await pool.query('UPDATE clients SET billing_amount = NULL, monitoring_enabled = FALSE');
    console.log('✓ Cleared all existing billing_amount and monitoring_enabled values\n');

    const matched   = [];
    const notFound  = [];

    /* Step 2: Populate active billing accounts */
    for (const entry of BILLING) {
        const cid     = toCid(entry.alarm);
        const monthly = (entry.annual / 12).toFixed(2);

        const r = await pool.query(
            `UPDATE clients
             SET billing_amount = $1, monitoring_enabled = TRUE
             WHERE customer_id = $2
             RETURNING id, name, customer_id`,
            [monthly, cid]
        );

        if (r.rowCount > 0) {
            matched.push({ ...entry, cid, monthly, dbName: r.rows[0].name });
        } else {
            notFound.push({ ...entry, cid });
        }
    }

    /* Step 3: Enable monitoring for $0 accounts */
    for (const entry of FREE_MONITORING) {
        const cid = toCid(entry.alarm);
        await pool.query(
            'UPDATE clients SET monitoring_enabled = TRUE WHERE customer_id = $1',
            [cid]
        );
    }

    /* Step 4: Report */
    console.log(`✅  MATCHED & UPDATED (${matched.length} accounts)`);
    console.log('─'.repeat(60));
    matched.forEach(e =>
        console.log(`  Alarm ${e.alarm.padEnd(8)} → ${e.dbName.padEnd(45)} $${e.monthly}/mo  ($${e.annual}/yr)`)
    );

    console.log(`\n❌  NOT FOUND IN DB — needs manual entry (${notFound.length} accounts)`);
    console.log('─'.repeat(60));
    notFound.forEach(e =>
        console.log(`  Alarm ${e.alarm.padEnd(8)} → cid would be: ${e.cid.padEnd(10)}  ${e.name}  ($${e.annual}/yr)`)
    );

    console.log(`\n⊘   CANCELLED (monitoring disabled):`);
    CANCELLED.forEach(e => console.log(`  Alarm ${e.alarm}  ${e.name}`));

    console.log('\nDone.');
    await pool.end();
}

run().catch(err => {
    console.error('Migration failed:', err.message);
    process.exit(1);
});
