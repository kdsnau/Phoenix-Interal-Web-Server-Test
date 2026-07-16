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
    next();
});

const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(o => o.trim());
app.use(cors({ origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)) }));
app.use(express.json());
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
