'use strict';
require('dotenv').config();

const config = {
    port: Number(process.env.PORT) || 4000,
    jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
    phoneTokenTtl: Number(process.env.PHONE_TOKEN_TTL) || 180,
    readerClockSkewSec: 60, // reader HMAC timestamp tolerance
    seedAdmin: {
        name: process.env.SEED_ADMIN_NAME || 'Admin',
        email: process.env.SEED_ADMIN_EMAIL || 'admin@phoenixsectech.com',
        password: process.env.SEED_ADMIN_PASSWORD || '',
    },
};

if (config.jwtSecret === 'dev-insecure-secret-change-me') {
    console.warn('[config] WARNING: JWT_SECRET is unset; using an insecure dev default.');
}

module.exports = config;
