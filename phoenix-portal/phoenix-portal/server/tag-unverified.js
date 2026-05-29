require('dotenv').config();
const pool = require('./db/pool');

const EXTRA_CIDS = [
    '1-35781', '1-3786', '1-41482', '1-52774', '1-5406', '1-64119', '1-8561',
    '88-17542', '88-4963', '88-4971', '88-5407', '88-5415', '88-5439', '88-5445',
];

pool.query(
    `UPDATE clients SET notes = 'Potentially incorrect — account not found in authoritative monitoring list'
     WHERE customer_id = ANY($1)`,
    [EXTRA_CIDS]
).then(r => { console.log(`Tagged ${r.rowCount} clients.`); pool.end(); })
 .catch(e => { console.error(e.message); pool.end(); });
