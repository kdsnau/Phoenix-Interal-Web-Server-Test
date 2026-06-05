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
const { startScheduler } = require('./services/monitoringScheduler');

const app  = express();
const PORT = process.env.PORT || 5000;

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

app.get('/api/health', (_, res) => res.json({ status: 'ok' }));

/* -----------------------------------------------------------------------
   Serve the React production build.
   Run `npm run build` in the client directory first.
   API routes above take priority; everything else falls through to React.
   ----------------------------------------------------------------------- */
/* Serve uploaded files (insurance cards, etc.) */
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

const DIST = path.join(__dirname, '../client/dist');
app.use(express.static(DIST));
app.use((_, res) => res.sendFile(path.join(DIST, 'index.html')));

app.listen(PORT, () => {
    console.log(`Phoenix SecTech API running on port ${PORT}`);
    startScheduler();
});
