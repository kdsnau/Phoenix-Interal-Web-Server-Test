/* Tiny in-memory rate limiter — no external dependencies (the server can't add
   npm packages). Fine for a single-process pm2 app; if you ever cluster, move
   this to a shared store. Returns Express middleware with a .reset(key) helper
   so callers can clear a key on success (e.g. a good login). */

const buckets = new Map();   // key -> { count, resetAt }

function rateLimit({ windowMs = 15 * 60 * 1000, max = 30, key, message = 'Too many requests. Please try again later.' } = {}) {
    const mw = (req, res, next) => {
        const k = key ? key(req) : req.ip;
        if (k == null) return next();

        const now = Date.now();
        let b = buckets.get(k);
        if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + windowMs }; buckets.set(k, b); }
        b.count++;

        if (b.count > max) {
            res.setHeader('Retry-After', String(Math.ceil((b.resetAt - now) / 1000)));
            return res.status(429).json({ error: message });
        }
        next();
    };
    mw.reset = (k) => buckets.delete(k);
    return mw;
}

/* Sweep expired buckets so the Map can't grow unbounded. */
setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}, 10 * 60 * 1000).unref();

module.exports = { rateLimit };
