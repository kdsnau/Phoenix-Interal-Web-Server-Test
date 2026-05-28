const jwt = require('jsonwebtoken');

/**
 * Verify JWT and attach user payload to req.user.
 */
function authenticate(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; /* Bearer <token> */

    if (!token) {
        return res.status(401).json({ error: 'No token provided.' });
    }

    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid or expired token.' });
    }
}

/**
 * Factory: restrict route to one or more roles.
 * Usage: requireRole('admin') or requireRole('admin', 'accounting')
 */
function requireRole(...roles) {
    return [
        authenticate,
        (req, res, next) => {
            if (!roles.includes(req.user.role)) {
                return res.status(403).json({ error: 'Access denied.' });
            }
            next();
        },
    ];
}

module.exports = { authenticate, requireRole };
