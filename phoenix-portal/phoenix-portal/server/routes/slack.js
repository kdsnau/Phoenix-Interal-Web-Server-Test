const express    = require('express');
const { WebClient } = require('@slack/web-api');
const { authenticate } = require('../middleware/requireRole');

const router = express.Router();
router.use(authenticate);

const slack = new WebClient(process.env.SLACK_TOKEN);
const CHANNEL_ID = process.env.SLACK_CHANNEL_ID;

router.get('/vehicle/:vehicleId', async (req, res) => {
    const { vehicleId } = req.params;
    const { name, unit } = req.query;

    try {
        const result = await slack.conversations.history({
            channel: CHANNEL_ID,
            limit: 200,
        });

        const terms = [vehicleId];
        if (name) terms.push(...name.toLowerCase().split(' '));
        if (unit) terms.push(unit.toLowerCase());

        const filtered = result.messages.filter(m => {
            const text = (m.text || '').toLowerCase();
            return terms.some(t => t.length > 2 && text.includes(t));
        });

        const userIds = [...new Set(filtered.map(m => m.user).filter(Boolean))];
        const userMap = {};
        for (const uid of userIds) {
            try {
                const info = await slack.users.info({ user: uid });
                userMap[uid] = info.user?.real_name || info.user?.name || uid;
            } catch {
                userMap[uid] = uid;
            }
        }

        const messages = filtered.map(m => ({
            ts:     m.ts,
            date:   new Date(Number(m.ts) * 1000).toISOString(),
            text:   m.text,
            user:   userMap[m.user] || 'Unknown',
            userId: m.user,
        }));

        return res.json({ count: messages.length, messages });
    } catch (err) {
        console.error('Slack error:', err.message);
        return res.status(500).json({ error: 'Failed to fetch Slack messages.' });
    }
});

module.exports = router;
