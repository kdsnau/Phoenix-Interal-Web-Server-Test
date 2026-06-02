const express  = require('express');
const router   = express.Router();
const { authenticate } = require('../middleware/requireRole');
const { sendFeedback } = require('../config/mailer');

/* -----------------------------------------------------------------------
   POST /api/feedback
   Accepts feedback from any authenticated user and emails it to the
   address configured in FEEDBACK_EMAIL (falls back to SMTP_USER).
   ----------------------------------------------------------------------- */
router.post('/', authenticate, async (req, res) => {
    const { category, subject, message } = req.body;

    if (!subject?.trim()) return res.status(400).json({ error: 'Subject is required.' });
    if (!message?.trim()) return res.status(400).json({ error: 'Message is required.' });

    const validCategories = ['bug', 'feature', 'improvement', 'general'];
    const cat = validCategories.includes(category) ? category : 'general';

    const to = process.env.FEEDBACK_EMAIL || process.env.SMTP_USER;
    if (!to) return res.status(503).json({ error: 'Feedback email not configured on server.' });

    try {
        await sendFeedback(to, {
            category:  cat,
            subject:   subject.trim(),
            message:   message.trim(),
            fromName:  req.user.name,
            fromEmail: req.user.email,
            fromRole:  req.user.role,
        });
        res.json({ ok: true });
    } catch (err) {
        console.error('Feedback email error:', err.message);
        res.status(500).json({ error: 'Failed to send feedback. Check SMTP configuration.' });
    }
});

module.exports = router;
