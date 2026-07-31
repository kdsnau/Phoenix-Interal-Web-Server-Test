require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const authRoutes       = require('./routes/auth');
const ticketRoutes     = require('./routes/tickets');
const financialRoutes  = require('./routes/financials');
const adminRoutes      = require('./routes/admin');
const fleetRoutes      = require('./routes/fleet');
const importRoutes     = require('./routes/import');
const slackRoutes      = require('./routes/slack');
const clientRoutes     = require('./routes/clients');
const alarmSlackRoutes = require('./routes/alarmSlack');
const inventoryRoutes  = require('./routes/inventory');
const projectRoutes    = require('./routes/projects');
const appSyncRoutes    = require('./routes/appSync');
const aiRoutes         = require('./routes/ai');
const feedbackRoutes   = require('./routes/feedback');
const messageRoutes    = require('./routes/messages');
const calendarRoutes   = require('./routes/calendar');
const postRoutes       = require('./routes/posts');
const nvrRoutes        = require('./routes/nvr');
const dmpRoutes        = require('./routes/dmp');
const complianceRoutes = require('./routes/compliance');
const reminderRoutes   = require('./routes/reminders');
const profileRoutes    = require('./routes/profile');
const callsRoutes      = require('./routes/calls');
const vaultRoutes      = require('./routes/vault');
const technotesRoutes  = require('./routes/technotes');
const dashboardRoutes  = require('./routes/dashboard');
const snapshotRoutes   = require('./routes/snapshot');
const timesheetRoutes  = require('./routes/timesheets');
const licenseRoutes    = require('./routes/licenses');
const scheduleRoutes   = require('./routes/schedule');
const roleRoutes       = require('./routes/roles');
const { startScheduler } = require('./services/monitoringScheduler');

const app  = express();
const PORT = process.env.PORT || 5000;

/* Behind the Caddy reverse proxy on the same host — trust X-Forwarded-* only
   from loopback so req.ip is the real client (needed for login rate limiting). */
app.set('trust proxy', 'loopback');

/* Baseline security response headers (no extra deps). HSTS is intentionally
   left to Caddy, which terminates TLS; the Node origin itself is plain HTTP. */
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    // Content-Security-Policy: the Vite build ships a single self-hosted module
    // script (no inline <script>), so 'self' is enough for scripts. Inline styles
    // are allowed (React style props); images allow data:/blob: for previews.
    res.setHeader('Content-Security-Policy',
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
        "script-src 'self'; connect-src 'self'; font-src 'self' data:; " +
        "object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    next();
});

/* Optional edge password gate for public demo / staging instances. Active only
   when PORTAL_GATE_USER + PORTAL_GATE_PASS are set; a normal internal deploy
   leaves them unset and this is a no-op. Runs before all routes and static
   assets, so nothing is reachable without the gate credentials. */
if (process.env.PORTAL_GATE_USER && process.env.PORTAL_GATE_PASS) {
    const crypto = require('crypto');
    const { rateLimit } = require('./middleware/rateLimit');
    const GATE_SECRET  = process.env.JWT_SECRET || process.env.PORTAL_GATE_PASS;
    const GATE_TOKEN   = crypto.createHmac('sha256', GATE_SECRET)
        .update(`${process.env.PORTAL_GATE_USER}:${process.env.PORTAL_GATE_PASS}`).digest('hex');
    const COOKIE       = 'phx_gate';
    const COOKIE_MAXAGE = 4 * 60 * 60;   // 4 hours (seconds)
    const clientKey    = (req) => `gate:${req.headers['cf-connecting-ip'] || req.ip}`;
    // Brute-force guard: only WRONG password attempts are counted, so benign
    // no-auth popup/asset requests never trip it. Reset on a successful unlock.
    const gateLimiter  = rateLimit({
        windowMs: 15 * 60 * 1000, max: 20, key: clientKey,
        message: 'Too many gate attempts. Please wait a few minutes.',
    });
    const hasGateCookie = (req) => (req.headers.cookie || '').split(';').some(c => {
        const [k, v] = c.trim().split('=');
        return k === COOKIE && v === GATE_TOKEN;
    });
    const challenge = (res) => {
        res.set('WWW-Authenticate', 'Basic realm="Phoenix Portal"');
        return res.status(401).send('Authentication required');
    };

    app.use((req, res, next) => {
        // The API is already protected by the app's JWT login; never gate it
        // (gating it with Basic collides with the app's Authorization: Bearer
        // header and breaks XHR logins).
        if (req.path.startsWith('/api/')) return next();
        // Already passed the gate in this browser -> no popup on refresh.
        if (hasGateCookie(req)) return next();

        const [scheme, encoded] = (req.headers.authorization || '').split(' ');
        if (scheme === 'Basic' && encoded) {
            const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
            if (user === process.env.PORTAL_GATE_USER && pass === process.env.PORTAL_GATE_PASS) {
                gateLimiter.reset(clientKey(req));   // good unlock clears the counter
                // 4h cookie: reloads don't re-prompt; auto-expires so a shared
                // machine can't stay unlocked indefinitely.
                res.setHeader('Set-Cookie',
                    `${COOKIE}=${GATE_TOKEN}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAXAGE}`);
                return next();
            }
            // Wrong credentials -> count this guess; 429s once over the limit.
            return gateLimiter(req, res, () => challenge(res));
        }
        // No credentials yet (browser asking for the popup) -> just challenge.
        return challenge(res);
    });
}

const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(o => o.trim());
// Only echo an allow-origin for known origins. A missing Origin (same-origin
// requests, curl) simply gets no CORS header — same-origin isn't CORS-checked
// by the browser anyway — while a `null` origin (sandboxed iframe / data: URL)
// is now rejected instead of allowed.
app.use(cors({ origin: (origin, cb) => cb(null, !!origin && allowedOrigins.includes(origin)) }));
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
    console.log(`${req.method} ${req.path} [${req.ip}]`);
    next();
});
app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
});

app.use('/api/auth',        authRoutes);
app.use('/api/tickets',     ticketRoutes);
app.use('/api/financials',  financialRoutes);
app.use('/api/admin',       adminRoutes);
app.use('/api/fleet',       fleetRoutes);
app.use('/api/import',      importRoutes);
app.use('/api/slack',       slackRoutes);
app.use('/api/clients',     clientRoutes);
app.use('/api/alarm-slack', alarmSlackRoutes);
app.use('/api/inventory',   inventoryRoutes);
app.use('/api/projects',    projectRoutes);
app.use('/api/app/sync',    appSyncRoutes);
app.use('/api/ai',          aiRoutes);
app.use('/api/feedback',    feedbackRoutes);
app.use('/api/messages',    messageRoutes);
app.use('/api/calendar',    calendarRoutes);
app.use('/api/posts',       postRoutes);
app.use('/api/nvr',         nvrRoutes);
app.use('/api/dmp',         dmpRoutes);
app.use('/api/compliance',  complianceRoutes);
app.use('/api/reminders',   reminderRoutes);
app.use('/api/profile',     profileRoutes);
app.use('/api/calls',       callsRoutes);
app.use('/api/vault',       vaultRoutes);
app.use('/api/tech-notes',  technotesRoutes);
app.use('/api/dashboard',   dashboardRoutes);
app.use('/api/snapshot',    snapshotRoutes);
app.use('/api/timesheets',  timesheetRoutes);
app.use('/api/licenses',    licenseRoutes);
app.use('/api/schedule',    scheduleRoutes);
app.use('/api/roles',       roleRoutes);

app.get('/api/health', (_, res) => res.json({ status: 'ok' }));

/* Unknown /api/* paths return JSON 404 instead of falling through to the SPA
   catch-all (which would answer a REST call with index.html + HTTP 200). */
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

/* -----------------------------------------------------------------------
   Serve the React production build.
   Run `npm run build` in the client directory first.
   API routes above take priority; everything else falls through to React.
   ----------------------------------------------------------------------- */
/* Serve uploaded files (insurance cards, etc.) */
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

const DIST = path.join(__dirname, '../client/dist');

/* Vite content-hashes everything under /assets, so a given URL's contents can
   never change — cache it hard and skip the revalidation round trip, which is
   what makes the first paint slow on a phone.

   fallthrough:false is the important part: without it a request for an asset
   that no longer exists (a phone holding a stale index.html after a deploy)
   falls through to the catch-all below and gets index.html — i.e. HTML with a
   200 in reply to a .js request, which fails the module MIME check and leaves
   a white screen. A real 404 makes that a hard reload instead. */
app.use('/assets', express.static(path.join(DIST, 'assets'), {
    immutable: true,
    maxAge: '1y',
    fallthrough: false,
}));

/* index.html, sw.js, the manifest and icons must revalidate, so a deploy is
   picked up on the next load. no-cache means "ask first", not "don't store" —
   unchanged files still come back as a cheap 304. */
app.use(express.static(DIST, {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

app.use((_, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(DIST, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Phoenix SecTech API running on port ${PORT}`);
    startScheduler();
});
