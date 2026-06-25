'use strict';
// Applies db/schema.sql to the configured database. Safe to re-run.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db/pool');

(async () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    try {
        await pool.query(sql);
        console.log('[migrate] schema applied.');
    } catch (err) {
        console.error('[migrate] failed:', err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();
