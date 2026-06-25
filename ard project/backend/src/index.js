'use strict';
const express = require('express');
const cors = require('cors');
const config = require('./config');

const app = express();
app.use(cors());

// Capture the raw body so the reader HMAC middleware can verify the exact bytes
// the Arduino signed. (express.json still parses req.body as usual.)
app.use(
    express.json({
        limit: '256kb',
        verify: (req, _res, buf) => {
            req.rawBody = buf;
        },
    }),
);

app.get('/health', (req, res) => res.json({ ok: true, service: 'phx-door-backend' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/credentials', require('./routes/credentials'));
app.use('/api/doors', require('./routes/doors'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/rules', require('./routes/rules'));
app.use('/api/scans', require('./routes/scans'));
app.use('/api/me', require('./routes/me'));
app.use('/api/reader', require('./routes/readers'));

// 404
app.use((req, res) => res.status(404).json({ error: 'not_found' }));

// Central error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error('[error]', err);
    res.status(err.status || 500).json({ error: 'server_error' });
});

if (require.main === module) {
    app.listen(config.port, () => {
        console.log(`phx-door-backend listening on http://localhost:${config.port}`);
    });
}

module.exports = app;
