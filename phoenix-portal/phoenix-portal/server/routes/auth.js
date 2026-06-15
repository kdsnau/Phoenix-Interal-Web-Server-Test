const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const pool     = require('../db/pool');
const { sendTemplated } = require('../config/mailer');
const { authenticate } = require('../middleware/requireRole');

const router = express.Router();

/* POST /api/auth/register */
router.post('/register', async (req, res) => {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
        return res.status(400).json({ error: 'All fields are required.' });
    }

    const validRoles = ['technician', 'accounting', 'admin'];
    if (!validRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid role.' });
    }

    try {
        const hash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
            [name, email, hash, role]
        );
        const user = result.rows[0];

        /* Welcome email */
        await sendTemplated(
            email,
            'Welcome to Phoenix SecTech Portal',
            'Welcome to the Portal',
            {
                intro: `Hi ${name}, your account has been created.`,
                fields: [
                    { label: 'Email', value: email },
                    { label: 'Role',  value: role, badge: 'badge-orange' },
                ],
                note: 'Log in at your portal URL and change your password.',
            }
        ).catch(err => console.error('Welcome email failed:', err));

        /* Notify admin */
        const admins = await pool.query("SELECT email FROM users WHERE role = 'admin'");
        for (const admin of admins.rows) {
            await sendTemplated(
                admin.email,
                'New User Registered',
                'New User Registered',
                {
                    intro: 'A new user account was just created.',
                    fields: [
                        { label: 'Name',  value: name, hi: true },
                        { label: 'Email', value: email },
                        { label: 'Role',  value: role, badge: 'badge-orange' },
                    ],
                }
            ).catch(err => console.error('Admin notify failed:', err));
        }

        return res.status(201).json({ message: 'User created.', user });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: 'Email already in use.' });
        }
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

/* POST /api/auth/login */
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }

    try {
        const result = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }

        const token = jwt.sign(
            { id: user.id, name: user.name, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        return res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

/* POST /api/auth/change-password — any signed-in user changes their own password */
router.post('/change-password', authenticate, async (req, res) => {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
        return res.status(400).json({ error: 'Current and new password are required.' });
    }
    if (new_password.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }
    if (new_password === current_password) {
        return res.status(400).json({ error: 'New password must be different from the current one.' });
    }

    try {
        const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
        const user = result.rows[0];
        if (!user) return res.status(404).json({ error: 'User not found.' });

        const match = await bcrypt.compare(current_password, user.password_hash);
        if (!match) return res.status(401).json({ error: 'Current password is incorrect.' });

        const hash = await bcrypt.hash(new_password, 10);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);

        /* Security heads-up — best effort */
        sendTemplated(
            req.user.email,
            'Your Phoenix SecTech password was changed',
            'Password Changed',
            {
                intro: `Hi ${req.user.name}, your portal password was just changed.`,
                note: "If this wasn't you, contact an administrator immediately.",
            }
        ).catch(err => console.error('Password-change email failed:', err));

        return res.json({ message: 'Password updated.' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

module.exports = router;
