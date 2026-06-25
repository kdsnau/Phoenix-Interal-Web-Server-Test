'use strict';
const { Pool } = require('pg');

// Reads DATABASE_URL, or falls back to the standard PG* env vars (handled by pg).
const pool = new Pool(
    process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {},
);

pool.on('error', (err) => {
    console.error('[db] unexpected idle client error', err);
});

module.exports = {
    pool,
    query: (text, params) => pool.query(text, params),
};
