const express = require('express');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const pool    = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/requireRole');
const { sendServiceReminder, sendTagsReminder } = require('../config/mailer');

const router = express.Router();
router.use(authenticate);

/* ── Insurance file upload setup ──────────────────────────────────────── */
const UPLOAD_DIR = path.join(__dirname, '../../uploads/insurance');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
        cb(null, `vehicle-${req.params.id}-insurance${ext}`);
    },
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (_req, file, cb) => {
        const ok = /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype);
        cb(ok ? null : new Error('Only image files are allowed.'), ok);
    },
});

/* Add resolution columns to vehicle_notes if not already present */
pool.query(`ALTER TABLE vehicle_notes ADD COLUMN IF NOT EXISTS resolved    BOOLEAN   NOT NULL DEFAULT FALSE`).catch(() => {});
pool.query(`ALTER TABLE vehicle_notes ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP`).catch(() => {});
pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS driver         VARCHAR(100)`).catch(() => {});
pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS insurance_file VARCHAR(255)`).catch(() => {});
/* Drivers are real user accounts now (driver text kept for legacy display). */
pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS driver_id INTEGER REFERENCES users(id) ON DELETE SET NULL`).catch(() => {});

/* Weekly vehicle reports written by the assigned driver. References vehicles +
   users (both pre-existing), so a single CREATE is safe — no FK-order race. */
pool.query(`
    CREATE TABLE IF NOT EXISTS vehicle_reports (
        id         SERIAL PRIMARY KEY,
        vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        mileage    INTEGER,
        content    TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
    )
`).catch(err => console.error('vehicle_reports table init:', err.message));
pool.query(`CREATE INDEX IF NOT EXISTS idx_vehicle_reports ON vehicle_reports (vehicle_id, created_at DESC)`).catch(() => {});

/* GET /api/fleet/drivers — users that can be assigned to a vehicle (defined
   before /:id so it isn't captured as a vehicle id). */
router.get('/drivers', async (req, res) => {
    try {
        const r = await pool.query('SELECT id, name, role FROM users ORDER BY name');
        res.json(r.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to load drivers.' });
    }
});

/* ── Driver's own vehicle (dashboard report widget) ──────────────────────
   Defined before /:id so "my-vehicle" isn't parsed as a vehicle id. */

/* GET /api/fleet/my-vehicle — the vehicle assigned to the signed-in user, with
   its open issues, recent issues, and their weekly-report history. */
router.get('/my-vehicle', async (req, res) => {
    try {
        const v = await pool.query(
            `SELECT v.id, v.name, v.vehicle_id, v.make, v.model, v.year, v.mileage,
                    (SELECT COUNT(*) FROM vehicle_notes WHERE vehicle_id = v.id AND resolved = FALSE) AS open_issues
             FROM vehicles v WHERE v.driver_id = $1 ORDER BY v.id ASC LIMIT 1`,
            [req.user.id]
        );
        if (v.rowCount === 0) return res.json({ vehicle: null });
        const veh = v.rows[0];
        const [notes, reports] = await Promise.all([
            pool.query('SELECT * FROM vehicle_notes WHERE vehicle_id = $1 ORDER BY created_at DESC LIMIT 20', [veh.id]),
            pool.query('SELECT id, mileage, content, created_at FROM vehicle_reports WHERE vehicle_id = $1 ORDER BY created_at DESC LIMIT 10', [veh.id]),
        ]);
        res.json({
            vehicle: veh,
            notes: notes.rows,
            reports: reports.rows,
            last_report_at: reports.rows[0]?.created_at || null,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to load your vehicle.' });
    }
});

/* POST /api/fleet/my-vehicle/report { content, mileage? } — the assigned driver
   files their weekly vehicle report. */
router.post('/my-vehicle/report', async (req, res) => {
    const content = (req.body.content || '').trim();
    if (!content) return res.status(400).json({ error: 'A report is required.' });
    try {
        const v = await pool.query('SELECT id FROM vehicles WHERE driver_id = $1 ORDER BY id ASC LIMIT 1', [req.user.id]);
        if (v.rowCount === 0) return res.status(400).json({ error: 'No vehicle is assigned to you.' });
        const vid = v.rows[0].id;
        const mileageNum = req.body.mileage != null && req.body.mileage !== '' ? Number(req.body.mileage) : null;
        const mileage = Number.isFinite(mileageNum) ? mileageNum : null;
        const r = await pool.query(
            'INSERT INTO vehicle_reports (vehicle_id, user_id, mileage, content) VALUES ($1, $2, $3, $4) RETURNING *',
            [vid, req.user.id, mileage, content]
        );
        /* Keep the odometer current if they reported a higher mileage. */
        if (mileage != null && mileage > 0) {
            await pool.query('UPDATE vehicles SET mileage = GREATEST(COALESCE(mileage, 0), $1) WHERE id = $2', [mileage, vid]).catch(() => {});
        }
        res.status(201).json(r.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to submit report.' });
    }
});

router.get('/', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT v.*,
                    du.name  AS driver_name,
                    du.email AS driver_email,
                    sn.enabled AS service_notify_enabled,
                    sn.last_sent_at,
                    sn.next_due_at,
                    (SELECT COUNT(*) FROM vehicle_notes
                     WHERE vehicle_id = v.id AND resolved = FALSE) AS open_issues
             FROM vehicles v
             LEFT JOIN vehicle_service_notifications sn ON sn.vehicle_id = v.id
             LEFT JOIN users du ON du.id = v.driver_id
             ORDER BY v.id ASC`
        );
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const [vehicle, notes, invoices, inventory] = await Promise.all([
            pool.query(
                `SELECT v.*,
                        du.name  AS driver_name,
                        du.email AS driver_email,
                        sn.enabled AS service_notify_enabled,
                        sn.last_sent_at,
                        sn.next_due_at,
                        sn.id AS sn_id
                 FROM vehicles v
                 LEFT JOIN vehicle_service_notifications sn ON sn.vehicle_id = v.id
                 LEFT JOIN users du ON du.id = v.driver_id
                 WHERE v.id = $1`,
                [req.params.id]
            ),
            pool.query(
                'SELECT * FROM vehicle_notes WHERE vehicle_id = $1 ORDER BY created_at DESC',
                [req.params.id]
            ),
            pool.query(
                'SELECT * FROM vehicle_invoices WHERE vehicle_id = $1 ORDER BY invoice_date DESC',
                [req.params.id]
            ),
            pool.query(
                `SELECT vi.*, ii.name AS item_name, ii.sku, ii.category, ii.unit, ii.min_threshold
                 FROM vehicle_inventory vi
                 JOIN inventory_items ii ON ii.id = vi.inventory_item_id
                 WHERE vi.vehicle_id = $1
                 ORDER BY ii.category, ii.name`,
                [req.params.id]
            ).catch(() => ({ rows: [] })),
        ]);
        if (vehicle.rowCount === 0) return res.status(404).json({ error: 'Vehicle not found.' });
        return res.json({ ...vehicle.rows[0], notes: notes.rows, invoices: invoices.rows, inventory: inventory.rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

/* POST /api/fleet — create a new vehicle (admin only) */
router.post('/', requireRole('admin'), async (req, res) => {
    const { name, vehicle_id, make, model, year, mileage, tags_renewal, slack_name, driver_id } = req.body;
    if (!name || !vehicle_id)
        return res.status(400).json({ error: 'name and vehicle_id are required.' });
    try {
        const result = await pool.query(
            `INSERT INTO vehicles (name, vehicle_id, make, model, year, mileage, tags_renewal, slack_name, driver_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [name.trim(), vehicle_id.trim(),
             make || null, model || null,
             year ? Number(year) : null,
             mileage ? Number(mileage) : 0,
             tags_renewal || null,
             slack_name || null,
             driver_id ? Number(driver_id) : null]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505')
            return res.status(409).json({ error: 'A vehicle with that ID already exists.' });
        console.error(err);
        res.status(500).json({ error: 'Failed to create vehicle.' });
    }
});

router.patch('/:id', requireRole('admin', 'accounting'), async (req, res) => {
    const { mileage, registration, tags_renewal } = req.body;
    /* driver_id present (incl. null) → set it; absent → leave unchanged */
    const setDriver = 'driver_id' in req.body;
    const driverId  = req.body.driver_id ? Number(req.body.driver_id) : null;
    try {
        const result = await pool.query(
            `UPDATE vehicles
             SET mileage      = COALESCE($1, mileage),
                 registration  = COALESCE($2, registration),
                 tags_renewal  = COALESCE($3::date, tags_renewal),
                 driver_id     = CASE WHEN $4::boolean THEN $5::int ELSE driver_id END,
                 /* Assigning a real driver via the dropdown is authoritative: drop
                    the legacy manually-typed name so it can't shadow the new driver
                    through the "driver_name || driver" display fallback. (Only when
                    a real user is assigned — a bare mileage save won't wipe a name.) */
                 driver        = CASE WHEN $4::boolean AND $5::int IS NOT NULL THEN NULL ELSE driver END
             WHERE id = $6
             RETURNING *`,
            [mileage ?? null, registration ?? null, tags_renewal ?? null, setDriver, driverId, req.params.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Vehicle not found.' });
        return res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

router.post('/:id/notes', async (req, res) => {
    const { category, content } = req.body;
    if (!category || !content) return res.status(400).json({ error: 'category and content are required.' });
    if (!['service', 'repair', 'misc'].includes(category)) return res.status(400).json({ error: 'Invalid category.' });
    try {
        const result = await pool.query(
            'INSERT INTO vehicle_notes (vehicle_id, category, content) VALUES ($1, $2, $3) RETURNING *',
            [req.params.id, category, content]
        );
        return res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

router.delete('/:id/notes/:noteId', async (req, res) => {
    try {
        await pool.query('DELETE FROM vehicle_notes WHERE id = $1 AND vehicle_id = $2', [req.params.noteId, req.params.id]);
        return res.json({ message: 'Note deleted.' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

router.patch('/:id/notes/:noteId', async (req, res) => {
    const { resolved } = req.body;
    try {
        const result = await pool.query(
            `UPDATE vehicle_notes
             SET resolved    = $1,
                 resolved_at = CASE WHEN $1 THEN NOW() ELSE NULL END
             WHERE id = $2 AND vehicle_id = $3
             RETURNING *`,
            [!!resolved, req.params.noteId, req.params.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Note not found.' });
        return res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

router.post('/:id/invoices', async (req, res) => {
    const { description, amount, invoice_date } = req.body;
    if (!description || amount == null || !invoice_date) return res.status(400).json({ error: 'description, amount, and invoice_date are required.' });
    try {
        const result = await pool.query(
            'INSERT INTO vehicle_invoices (vehicle_id, description, amount, invoice_date) VALUES ($1, $2, $3, $4) RETURNING *',
            [req.params.id, description, amount, invoice_date]
        );
        return res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

router.delete('/:id/invoices/:invoiceId', async (req, res) => {
    try {
        await pool.query('DELETE FROM vehicle_invoices WHERE id = $1 AND vehicle_id = $2', [req.params.invoiceId, req.params.id]);
        return res.json({ message: 'Invoice deleted.' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

/* ── Vehicle inventory endpoints ──────────────────────────────────────── */
router.post('/:id/inventory', async (req, res) => {
    const { inventory_item_id, quantity, notes } = req.body;
    if (!inventory_item_id) return res.status(400).json({ error: 'inventory_item_id is required.' });
    try {
        const r = await pool.query(
            `INSERT INTO vehicle_inventory (vehicle_id, inventory_item_id, quantity, notes)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (vehicle_id, inventory_item_id)
             DO UPDATE SET quantity = EXCLUDED.quantity,
                           notes    = COALESCE(EXCLUDED.notes, vehicle_inventory.notes)
             RETURNING *`,
            [req.params.id, inventory_item_id, quantity ?? 1, notes ?? null]
        );
        const full = await pool.query(
            `SELECT vi.*, ii.name AS item_name, ii.sku, ii.category, ii.unit, ii.min_threshold
             FROM vehicle_inventory vi
             JOIN inventory_items ii ON ii.id = vi.inventory_item_id
             WHERE vi.id = $1`,
            [r.rows[0].id]
        );
        return res.status(201).json(full.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to add inventory item.' });
    }
});

router.patch('/:id/inventory/:assignId', async (req, res) => {
    const { quantity, notes } = req.body;
    try {
        await pool.query(
            `UPDATE vehicle_inventory
             SET quantity = COALESCE($1, quantity),
                 notes    = COALESCE($2, notes)
             WHERE id = $3 AND vehicle_id = $4`,
            [quantity ?? null, notes !== undefined ? notes : null, req.params.assignId, req.params.id]
        );
        const full = await pool.query(
            `SELECT vi.*, ii.name AS item_name, ii.sku, ii.category, ii.unit, ii.min_threshold
             FROM vehicle_inventory vi
             JOIN inventory_items ii ON ii.id = vi.inventory_item_id
             WHERE vi.id = $1`,
            [req.params.assignId]
        );
        if (full.rowCount === 0) return res.status(404).json({ error: 'Assignment not found.' });
        return res.json(full.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to update inventory item.' });
    }
});

router.delete('/:id/inventory/:assignId', async (req, res) => {
    try {
        const r = await pool.query(
            'DELETE FROM vehicle_inventory WHERE id = $1 AND vehicle_id = $2 RETURNING id',
            [req.params.assignId, req.params.id]
        );
        if (r.rowCount === 0) return res.status(404).json({ error: 'Assignment not found.' });
        return res.json({ success: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to remove inventory item.' });
    }
});

router.post('/:id/send-service-email', async (req, res) => {
    try {
        const vehicle = await pool.query(
            `SELECT v.*, sn.id AS sn_id, du.email AS driver_email FROM vehicles v
             LEFT JOIN vehicle_service_notifications sn ON sn.vehicle_id = v.id
             LEFT JOIN users du ON du.id = v.driver_id
             WHERE v.id = $1`,
            [req.params.id]
        );
        if (vehicle.rowCount === 0) return res.status(404).json({ error: 'Vehicle not found.' });
        const v = vehicle.rows[0];
        const staff = await pool.query("SELECT email FROM users WHERE role = ANY(ARRAY['admin','accounting']::user_role[])");
        const recipients = new Set(staff.rows.map(a => a.email));
        if (v.driver_email) recipients.add(v.driver_email);   // the assigned driver
        for (const email of recipients) {
            try {
                await sendServiceReminder(email, v);
            } catch (e) {
                console.error('Failed to send to', email, e.message);
            }
        }
        await pool.query(
            `UPDATE vehicle_service_notifications
             SET last_sent_at = NOW(), next_due_at = NOW() + INTERVAL '3 months'
             WHERE vehicle_id = $1`,
            [req.params.id]
        );
        return res.json({ message: 'Service reminder sent.' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

/* POST /api/fleet/:id/insurance — upload insurance card image (admin only) */
router.post('/:id/insurance', requireRole('admin'), (req, res) => {
    upload.single('insurance')(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
        const filename = req.file.filename;
        try {
            await pool.query(
                'UPDATE vehicles SET insurance_file = $1 WHERE id = $2',
                [filename, req.params.id]
            );
            return res.json({ insurance_file: filename });
        } catch (e) {
            console.error(e);
            return res.status(500).json({ error: 'Failed to save insurance file.' });
        }
    });
});

router.post('/:id/send-tags-email', async (req, res) => {
    try {
        const vehicle = await pool.query(
            `SELECT v.*, du.email AS driver_email FROM vehicles v
             LEFT JOIN users du ON du.id = v.driver_id WHERE v.id = $1`,
            [req.params.id]
        );
        if (vehicle.rowCount === 0) return res.status(404).json({ error: 'Vehicle not found.' });
        const v = vehicle.rows[0];
        const staff = await pool.query("SELECT email FROM users WHERE role = ANY(ARRAY['admin','accounting']::user_role[])");
        const recipients = new Set(staff.rows.map(a => a.email));
        if (v.driver_email) recipients.add(v.driver_email);
        for (const email of recipients) {
            await sendTagsReminder(email, v);
        }
        return res.json({ message: 'Tags renewal reminder sent.' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

module.exports = router;