/**
 * One-time migration: add slack_name column and populate it.
 * Run from the server directory:  node migrate-slack-names.js
 */
require('dotenv').config();
const pool = require('./db/pool');

async function main() {
    // 1. Add the column (safe to re-run)
    await pool.query(`
        ALTER TABLE vehicles
        ADD COLUMN IF NOT EXISTS slack_name VARCHAR(100)
    `);
    console.log('✓ slack_name column ensured\n');

    // 2. Apply mappings by exact vehicle_id — safest approach
    const updates = [
        { vehicle_id: 'VH-001', slack_name: 'NV200 #1'        },  // Unit 01 — Nissan NV200
        { vehicle_id: 'VH-002', slack_name: 'Nissan NV-2500'  },  // Unit 02 — Nissan NV2500
        { vehicle_id: 'VH-003', slack_name: 'NV200 #2'        },  // Unit 03 — NV200 Cargo Van
        { vehicle_id: 'VH-004', slack_name: 'Nissan Frontier' },  // Unit 04 — Frontier (adjust if Slack uses different name)
        { vehicle_id: 'VH-005', slack_name: 'Tesla #2'        },  // Unit 05 — Tesla Model Y
        // VH-011 Trailer left null — unlikely to appear in Slack vehicle reports
    ];

    for (const u of updates) {
        const res = await pool.query(
            `UPDATE vehicles SET slack_name = $1 WHERE vehicle_id = $2 RETURNING vehicle_id, name, slack_name`,
            [u.slack_name, u.vehicle_id]
        );
        if (res.rowCount > 0) {
            const r = res.rows[0];
            console.log(`✓ [${r.vehicle_id}] "${r.name}"  →  "${r.slack_name}"`);
        } else {
            console.log(`⚠  vehicle_id "${u.vehicle_id}" not found`);
        }
    }

    // 3. Show final state
    const after = await pool.query(
        `SELECT vehicle_id, name, slack_name FROM vehicles ORDER BY id`
    );
    console.log('\nFinal state:');
    after.rows.forEach(r =>
        console.log(`  [${r.vehicle_id}]  "${r.name}"  →  ${r.slack_name ?? 'null (no Slack filter)'}`)
    );

    await pool.end();
    console.log('\nDone.');
}

main().catch(err => { console.error('Migration failed:', err.message); process.exit(1); });
