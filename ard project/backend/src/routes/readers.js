'use strict';
const express = require('express');
const { readerAuth } = require('../middleware/readerHmac');
const { decide, recordOfflineEvent } = require('../services/access');
const { buildSyncBundle } = require('../services/readerSync');
const { ah } = require('../util/async');

// All routes here are authenticated by the per-door HMAC, NOT a JWT.
const router = express.Router();
router.use(readerAuth);

// POST /api/reader/validate  { type:'uid_card'|'phone', uid?, token? }
//   -> { decision, reason, unlock_ms }
router.post(
    '/validate',
    ah(async (req, res) => {
        const { type, uid, token } = req.body || {};
        if (type !== 'uid_card' && type !== 'phone') {
            return res.status(400).json({ error: 'bad_tap_type' });
        }
        if (type === 'uid_card' && !uid) return res.status(400).json({ error: 'missing_uid' });
        if (type === 'phone' && !token) return res.status(400).json({ error: 'missing_token' });

        const result = await decide(req.door, { type, uid, token });
        res.json(result);
    }),
);

// GET /api/reader/sync -> compact offline cache bundle for this door
router.get(
    '/sync',
    ah(async (req, res) => {
        res.json(await buildSyncBundle(req.door));
    }),
);

// POST /api/reader/events  { events:[{uid?, decision, reason, scanned_at?}] }
//   -> backfill decisions the reader made while offline
router.post(
    '/events',
    ah(async (req, res) => {
        const events = Array.isArray(req.body?.events) ? req.body.events : [];
        for (const ev of events) await recordOfflineEvent(req.door, ev);
        res.json({ ok: true, recorded: events.length });
    }),
);

module.exports = router;
