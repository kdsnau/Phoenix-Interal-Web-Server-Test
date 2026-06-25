'use strict';
// Creates (or updates the password of) the first admin from env. No hard-coded
// credentials in SQL. Run after migrate: `npm run seed-admin`.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db/pool');
const config = require('../src/config');

(async () => {
    const { name, email, password } = config.seedAdmin;
    if (!password) {
        console.error('[seed-admin] SEED_ADMIN_PASSWORD is empty; set it in .env first.');
        process.exitCode = 1;
        await pool.end();
        return;
    }
    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            `INSERT INTO users (name, email, password_hash, role, active)
             VALUES ($1,$2,$3,'admin',TRUE)
             ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin', active = TRUE`,
            [name, email, hash],
        );
        console.log(`[seed-admin] admin ready: ${email}`);
    } catch (err) {
        console.error('[seed-admin] failed:', err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();
