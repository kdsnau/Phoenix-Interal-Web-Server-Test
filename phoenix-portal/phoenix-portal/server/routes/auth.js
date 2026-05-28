const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const pool     = require('../db/pool');
const { sendMail } = require('../config/mailer');

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
        await sendMail(
            email,
            'Welcome to Phoenix SecTech Portal',
            `Hi ${name},\n\nYour account has been created with role: ${role}.\n\nPhoenix Security & Technology`
        ).catch(err => console.error('Welcome email failed:', err));

        /* Notify admin */
        const admins = await pool.query("SELECT email FROM users WHERE role = 'admin'");
        for (const admin of admins.rows) {
            await sendMail(
                admin.email,
                'New User Registered',
                `A new user registered:\nName: ${name}\nEmail: ${email}\nRole: ${role}`
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
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
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

module.exports = router;
