'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config');

/** Verifies the Bearer JWT and attaches { id, role, email } to req.user. */
function authRequired(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'missing_token' });
    try {
        req.user = jwt.verify(token, config.jwtSecret);
        next();
    } catch {
        res.status(401).json({ error: 'invalid_token' });
    }
}

function signToken(user) {
    return jwt.sign({ id: user.id, role: user.role, email: user.email }, config.jwtSecret, {
        expiresIn: '12h',
    });
}

module.exports = { authRequired, signToken };
