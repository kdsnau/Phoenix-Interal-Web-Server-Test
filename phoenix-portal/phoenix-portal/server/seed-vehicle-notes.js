/**
 * seed-vehicle-notes.js
 * Seeds open maintenance issues per vehicle from the Vehicle Tracker sheet
 * inspection history. Only current/unresolved issues as of the most recent
 * inspection are included.
 *
 * Run from the server directory:
 *   node seed-vehicle-notes.js
 */

require('dotenv').config();
const pool = require('./db/pool');

/* vehicle_id (string) → notes to insert */
const NOTES = {
    'VH-001': [
        { category: 'repair',  content: 'Transmission slips out of gear when hot — loses drive completely until cooled down.' },
        { category: 'repair',  content: 'Driver side sliding door handle broken.' },
        { category: 'repair',  content: 'Windshield cracked/chipped — needs replacement.' },
        { category: 'repair',  content: 'Battery terminals corroded and loose.' },
        { category: 'service', content: 'Oil change overdue.' },
        { category: 'service', content: 'Tires need rotation. Air compressor in vehicle is broken.' },
        { category: 'misc',    content: 'Medical kit missing from vehicle.' },
    ],
    'VH-002': [
        { category: 'repair',  content: 'Check engine light on — O2 sensor fault.' },
        { category: 'repair',  content: 'AC not functioning properly — not blowing adequately.' },
        { category: 'repair',  content: 'Windshield cracked/chipped — needs replacement.' },
        { category: 'repair',  content: 'Transmission hops between 2nd and 3rd gear.' },
        { category: 'service', content: 'Oil change overdue.' },
        { category: 'service', content: 'Tires worn — rotation needed. Low tire pressure.' },
        { category: 'misc',    content: 'Medical kit and fire extinguisher both missing from vehicle.' },
    ],
    'VH-003': [
        { category: 'repair',  content: 'All three cargo doors malfunctioning — driver side sliding door does not open, passenger side sliding door starting to fail, rear barn doors do not open.' },
        { category: 'repair',  content: 'Spare tire flat/blown — needs replacement.' },
        { category: 'repair',  content: 'Passenger side brake light housing cracked.' },
        { category: 'repair',  content: 'Windshield cracked on driver side.' },
        { category: 'service', content: 'Oil change due. Oil level getting low.' },
        { category: 'service', content: 'Tires worn — rotation needed. Wiper blades streaky.' },
    ],
    'VH-004': [
        { category: 'service', content: 'AC needs recharge — blows hot intermittently.' },
    ],
    'VH-005': [
        { category: 'service', content: 'Cabin air filter overdue for replacement — last serviced in 2022.' },
        { category: 'repair',  content: 'Brakes screeching / brake dust buildup — rated unsatisfactory on last two inspections.' },
    ],
};

async function run() {
    console.log('=== Phoenix Portal — Vehicle Notes Seed ===\n');

    /* Get integer IDs for all vehicles */
    const vehicles = await pool.query('SELECT id, vehicle_id, name FROM vehicles');
    const idMap = {};
    vehicles.rows.forEach(v => { idMap[v.vehicle_id] = { id: v.id, name: v.name }; });

    let total = 0;
    for (const [vehicleId, notes] of Object.entries(NOTES)) {
        const v = idMap[vehicleId];
        if (!v) { console.log(`⚠️  Vehicle ${vehicleId} not found in DB — skipping`); continue; }

        /* Clear any existing seeded notes for this vehicle first to avoid duplication */
        await pool.query('DELETE FROM vehicle_notes WHERE vehicle_id = $1', [v.id]);

        for (const note of notes) {
            await pool.query(
                'INSERT INTO vehicle_notes (vehicle_id, category, content) VALUES ($1, $2, $3)',
                [v.id, note.category, note.content]
            );
        }

        console.log(`✅  ${vehicleId} — ${v.name}: inserted ${notes.length} note${notes.length !== 1 ? 's' : ''}`);
        total += notes.length;
    }

    console.log(`\nTotal notes inserted: ${total}`);
    console.log('Done.');
    await pool.end();
}

run().catch(err => {
    console.error('Seed failed:', err.message);
    process.exit(1);
});
