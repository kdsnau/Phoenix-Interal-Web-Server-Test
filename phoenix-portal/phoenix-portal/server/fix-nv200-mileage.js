require('dotenv').config();
const pool = require('./db/pool');
pool.query('UPDATE vehicles SET mileage = 137128 WHERE vehicle_id = $1', ['VH-001'])
    .then(r => { console.log('Updated rows:', r.rowCount); pool.end(); })
    .catch(e => { console.error(e.message); pool.end(); });
