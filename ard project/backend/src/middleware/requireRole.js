'use strict';

/** Gate a route to one or more roles. Use after authRequired. */
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
        if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
        next();
    };
}

module.exports = { requireRole };
