const express      = require('express');
const multer       = require('multer');
const { WebClient } = require('@slack/web-api');
const { authenticate, requireRole } = require('../middleware/requireRole');
const pool         = require('../db/pool');

const router     = express.Router();
router.use(authenticate);

const slack      = new WebClient(process.env.SLACK_TOKEN);
const CHANNEL_ID = process.env.PROJECT_SLACK_CHANNEL_ID;

/* Report photos are held in memory just long enough to hand off to Slack. */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 10 } });

/* Ensure the manual-completion override table exists on first start */
pool.query(`
    CREATE TABLE IF NOT EXISTS project_completions (
        name       TEXT      PRIMARY KEY,
        completed  BOOLEAN   NOT NULL DEFAULT TRUE,
        updated_at TIMESTAMP DEFAULT NOW()
    )
`).catch(err => console.error('project_completions table init:', err.message));

/* Manually-entered projects (not from Slack) */
pool.query(`
    CREATE TABLE IF NOT EXISTS manual_projects (
        id         SERIAL    PRIMARY KEY,
        name       TEXT      NOT NULL,
        rfq        TEXT,
        notes      TEXT,
        completed  BOOLEAN   NOT NULL DEFAULT FALSE,
        created_by INT       REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    )
`).catch(err => console.error('manual_projects table init:', err.message));

/* Local record of reports authored in the portal (the report itself lives in the
   project-reports Slack channel; this row lets us flag a ticket "reported" and
   keep an audit trail). No FK constraints — avoids a create-order race with the
   service_tickets table; dangling rows for a deleted ticket are harmless. */
pool.query(`
    CREATE TABLE IF NOT EXISTS ticket_reports (
        id          SERIAL    PRIMARY KEY,
        ticket_id   INTEGER   NOT NULL,
        author_id   INTEGER,
        author_name TEXT,
        work        TEXT,
        parts       TEXT,
        arrival     TEXT,
        return_trip BOOLEAN,
        photo_count INTEGER   DEFAULT 0,
        slack_ts    TEXT,
        created_at  TIMESTAMP DEFAULT NOW()
    )
`).catch(err => console.error('ticket_reports table init:', err.message));
pool.query(`CREATE INDEX IF NOT EXISTS idx_ticket_reports_ticket ON ticket_reports (ticket_id)`).catch(() => {});

/* Normalise a job name for grouping — case-insensitive, collapse whitespace */
const normalizeKey = s => s.trim().replace(/\s+/g, ' ').toLowerCase();

/* Build the report message in the exact shape the mobile app posts (SlackWebhook.kt)
   so the parser above and the client Reports tab pick it up identically. */
function buildReportMessage({ jobName, rfq, technicians, arrival, work, parts, returnTrip }) {
    const field = (label, value) => `*${label}*\n${(value != null && String(value).trim()) || '—'}\n\n`;
    return (
        field('Job name',                          jobName) +
        field('RFQ',                               rfq) +
        field('Technicians',                       technicians) +
        field('Site arrival and departure times',  arrival) +
        field('What work was completed',           work) +
        field('What parts and supplies were used', parts) +
        field('Is a return trip required',         returnTrip ? 'Yes' : 'No')
    ).trimEnd();
}

/* -----------------------------------------------------------------------
   Parse a Slack workflow form message into a field map.
   Bold labels (*Label*) mark field names; following lines are the value
   until the next bold label.
   ----------------------------------------------------------------------- */
function parseFields(text) {
    if (!text || !text.includes('\n')) return null;
    const rawLines = text.split('\n').map(l => l.trim());
    const isBold   = l => /^\*[^*]+\*$/.test(l);
    const destar   = l => l.replace(/\*/g, '').trim();
    const skipLine = l =>
        l.toLowerCase().includes('submission from') ||
        l.toLowerCase().includes('project report');

    if (rawLines.some(isBold)) {
        const fields = {}; let key = null, vals = [];
        for (const raw of rawLines) {
            if (!raw || skipLine(raw)) continue;
            if (isBold(raw)) {
                if (key !== null) { const v = vals.join('\n').trim(); if (v) fields[key] = v; }
                key = destar(raw); vals = [];
            } else if (key !== null) { vals.push(raw); }
        }
        if (key !== null) { const v = vals.join('\n').trim(); if (v) fields[key] = v; }
        return Object.keys(fields).length > 0 ? fields : null;
    }

    /* Pairwise fallback */
    const fields = {};
    for (let i = 0; i + 1 < rawLines.length; i += 2) {
        const k = destar(rawLines[i]);
        const v = rawLines[i + 1];
        if (k && v) fields[k] = v;
    }
    return Object.keys(fields).length > 0 ? fields : null;
}

/* Exact match first, then partial key match */
function get(fields, keys) {
    if (!fields) return null;
    for (const k of keys) { if (fields[k]) return fields[k]; }
    for (const [fk, fv] of Object.entries(fields)) {
        for (const k of keys) {
            if (fk.toLowerCase().includes(k.toLowerCase())) return fv;
        }
    }
    return null;
}

/* Demo/self-contained project reports (SLACK_MOCK=1) in the same bold-label
   value shape parseFields() expects, so the Projects page has Slack-style
   cards without a real Slack workspace. */
function mockProjectMessages() {
    const now = Math.floor(Date.now() / 1000);
    const mk = (agoDays, job, rfq, tech, work, ret) => ({
        ts: (now - agoDays * 86400).toString(),
        files: [],
        text: `*Job name*\n${job}\n*RFQ*\n${rfq}\n*Technician*\n${tech}\n` +
              `*What work was completed*\n${work}\n*Is a return trip required*\n${ret}`,
    });
    return [
        mk(1, '[Demo] Verde Auto — camera expansion', 'RFQ-2041', 'Mia Tech',  'Mounted 4 dome cameras in the service bay, tested NVR.', 'No'),
        mk(3, '[Demo] Papago Bistro — NVR service',    'RFQ-2044', 'Alex Field','Replaced failed NVR drive, rebuilt array.',              'No'),
        mk(6, '[Demo] Saguaro Dental — annual service','RFQ-2038', 'Mia Tech',  'Inspected panel + cameras, cleaned lenses.',             'Yes'),
    ];
}

/* -----------------------------------------------------------------------
   GET /api/projects
   Groups Slack messages by normalised job name into project cards,
   then applies any manual completion overrides from the DB.
   ----------------------------------------------------------------------- */
router.get('/', async (req, res) => {
    try {
        const [slackResult, overrideResult, manualResult] = await Promise.all([
            // Degrade gracefully when Slack isn't configured (e.g. local dev) or the
            // API call fails — show manual projects instead of 500-ing the whole page.
            // SLACK_MOCK=1 serves fabricated project reports so the page has content
            // without a real Slack workspace.
            (process.env.SLACK_MOCK === '1'
                ? Promise.resolve({ messages: mockProjectMessages() })
                : CHANNEL_ID && process.env.SLACK_TOKEN
                ? slack.conversations.history({ channel: CHANNEL_ID, limit: 1000 })
                : Promise.resolve({ messages: [] })
            ).catch(err => {
                console.warn('Projects: Slack unavailable, showing manual projects only:', err.message);
                return { messages: [] };
            }),
            pool.query('SELECT name, completed, updated_at FROM project_completions').catch(() => ({ rows: [] })),
            pool.query('SELECT * FROM manual_projects ORDER BY created_at DESC').catch(() => ({ rows: [] })),
        ]);

        const msgs = slackResult.messages || [];

        /* Build override lookup: normalised name → boolean */
        const overrideMap = {};
        overrideResult.rows.forEach(r => { overrideMap[r.name] = { completed: r.completed, updatedAt: new Date(r.updated_at).getTime() }; });
        /* override wins when it's newer than the latest Slack visit (ts in seconds). */
        const overrideWins = (name, lastVisitTs) => {
            const ov = overrideMap[normalizeKey(name)];
            return ov && ov.updatedAt >= Number(lastVisitTs) * 1000 ? ov : null;
        };

        const map = {};

        for (const m of msgs) {
            const fields = parseFields(m.text);
            if (!fields) continue;

            const jobName  = get(fields, ['Job name', 'Job Name', 'Project name', 'Project Name', 'Job']) || 'Unknown';
            const rfq      = get(fields, ['RFQ', 'RFQ#', 'RFQ #', 'Work order', 'Work Order', 'Work Order #']) || '';
            const work     = get(fields, ['What work was completed', 'Work completed', 'Work', 'Description']) || '';
            const parts    = get(fields, ['What parts and supplies were used', 'Parts', 'Parts used', 'Supplies']) || '';
            const arrival  = get(fields, ['Site arrival and departure times', 'Arrival', 'Times', 'Time']) || '';
            const techs    = get(fields, ['Technician', 'Technicians', 'Tech', 'Name', 'Who']) || '';
            const doneRaw    = get(fields, ['Is a return trip required', 'Return trip', 'Complete', 'Completed', 'Status']) || '';
            const slackCompleted = doneRaw.toLowerCase().includes('no')
                || doneRaw.toLowerCase().includes('complete')
                || doneRaw.toLowerCase() === 'done';

            const images = (m.files || [])
                .filter(f => f.mimetype && f.mimetype.startsWith('image/'))
                .map(f => ({ fileId: f.id, name: f.name }));

            const visit = {
                ts: m.ts,
                date: new Date(Number(m.ts) * 1000).toISOString(),
                technicians: techs,
                arrival,
                work,
                parts,
                completed: slackCompleted,
                images,
            };

            const key = normalizeKey(jobName);

            if (!map[key]) {
                /* First (most recent) entry for this job — its status is authoritative */
                map[key] = { name: jobName, rfq, slackCompleted, lastVisit: m.ts, visits: [] };
            } else if (Number(m.ts) > Number(map[key].lastVisit)) {
                /* Newer entry found — update status and timestamp */
                map[key].lastVisit = m.ts;
                map[key].slackCompleted = slackCompleted;
            }
            map[key].visits.push(visit);
        }

        const projects = Object.values(map)
            .map(p => ({
                name:      p.name,
                rfq:       p.rfq,
                /* Manual Complete/Reopen wins if newer than the latest Slack visit. */
                completed: overrideWins(p.name, p.lastVisit)?.completed ?? p.slackCompleted,
                lastVisit: p.lastVisit,
                visits:    p.visits.sort((a, b) => b.ts - a.ts),
            }))
            .sort((a, b) => {
                if (a.completed !== b.completed) return a.completed ? 1 : -1;
                return b.lastVisit - a.lastVisit;
            });

        /* Build synthetic project objects from manual entries */
        const manualProjects = manualResult.rows.map(mp => {
            const tsSeconds = String(Math.floor(new Date(mp.created_at).getTime() / 1000));
            return {
                name:      mp.name,
                rfq:       mp.rfq || '',
                completed: overrideWins(mp.name, tsSeconds)?.completed ?? mp.completed,
                lastVisit: tsSeconds,
                visits:    [{
                    ts:          tsSeconds,
                    date:        mp.created_at,
                    technicians: '',
                    arrival:     '',
                    work:        mp.notes || '',
                    parts:       '',
                    completed:   mp.completed,
                    images:      [],
                }],
                _manual:   true,
                _manualId: mp.id,
            };
        });

        const allProjects = [...projects, ...manualProjects].sort((a, b) => {
            if (a.completed !== b.completed) return a.completed ? 1 : -1;
            return Number(b.lastVisit) - Number(a.lastVisit);
        });

        res.json(allProjects);
    } catch (err) {
        console.error('Projects Slack error:', err.message);
        res.status(500).json({ error: 'Failed to fetch project reports.' });
    }
});

/* -----------------------------------------------------------------------
   POST /api/projects — create a manual project (admin only)
   ----------------------------------------------------------------------- */
router.post('/', requireRole('admin'), async (req, res) => {
    const { name, rfq, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required.' });
    try {
        const result = await pool.query(
            `INSERT INTO manual_projects (name, rfq, notes, created_by)
             VALUES ($1,$2,$3,$4) RETURNING *`,
            [name.trim(), rfq || null, notes || null, req.user.id]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Create manual project error:', err.message);
        res.status(500).json({ error: 'Failed to create project.' });
    }
});

/* -----------------------------------------------------------------------
   DELETE /api/projects/manual/:id — admin only
   ----------------------------------------------------------------------- */
router.delete('/manual/:id', requireRole('admin'), async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM manual_projects WHERE id = $1 RETURNING id',
            [req.params.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Project not found.' });
        res.json({ success: true });
    } catch (err) {
        console.error('Delete manual project error:', err.message);
        res.status(500).json({ error: 'Failed to delete project.' });
    }
});

/* -----------------------------------------------------------------------
   PATCH /api/projects/:name/complete
   Stores a manual completion override for a project.
   Body: { completed: boolean }
   ----------------------------------------------------------------------- */
router.patch('/:name/complete', async (req, res) => {
    try {
        const name      = decodeURIComponent(req.params.name);
        const completed = !!req.body.completed;

        await pool.query(`
            INSERT INTO project_completions (name, completed, updated_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (name) DO UPDATE
                SET completed  = EXCLUDED.completed,
                    updated_at = NOW()
        `, [normalizeKey(name), completed]);

        return res.json({ ok: true });
    } catch (err) {
        console.error('Projects complete error:', err.message);
        return res.status(500).json({ error: 'Failed to update project.' });
    }
});

/* -----------------------------------------------------------------------
   GET /api/projects/image/:fileId
   Proxies a private Slack image so the browser can display it without
   needing to send an Authorization header via <img src>.
   ----------------------------------------------------------------------- */
router.get('/image/:fileId', async (req, res) => {
    try {
        const info = await slack.files.info({ file: req.params.fileId });
        const url  = info.file?.url_private;
        if (!url) return res.status(404).json({ error: 'Image not found.' });

        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${process.env.SLACK_TOKEN}` },
        });
        if (!response.ok) return res.status(response.status).json({ error: 'Failed to fetch image.' });

        res.setHeader('Content-Type',  response.headers.get('content-type') || 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=3600');

        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));
    } catch (err) {
        console.error('Image proxy error:', err.message);
        res.status(500).json({ error: 'Failed to proxy image.' });
    }
});

/* -----------------------------------------------------------------------
   GET /api/projects/my-done-tickets
   The "tickets done" pipeline: resolved/closed tickets the tech is on (or all,
   for admin/accounting), each with how many reports it already has and a parts
   suggestion pulled from the ticket's inventory items.
   ----------------------------------------------------------------------- */
router.get('/my-done-tickets', async (req, res) => {
    try {
        const isPriv = ['admin', 'accounting'].includes(req.user.role);
        const params = [];
        let scope = '';
        if (!isPriv) { params.push(req.user.id); scope = ` AND (t.created_by = $1 OR $1 = ANY(t.assignee_ids))`; }
        const r = await pool.query(
            `SELECT t.id, t.title, t.status::text AS status, t.client_id, t.event_start, t.created_at,
                    c.name AS client_name,
                    (SELECT count(*) FROM ticket_reports tr WHERE tr.ticket_id = t.id) AS report_count,
                    (SELECT string_agg(u.name, ', ') FROM users u WHERE u.id = ANY(t.assignee_ids)) AS technicians,
                    (SELECT string_agg(ti.quantity || 'x ' || ii.name, E'\n')
                       FROM ticket_items ti JOIN inventory_items ii ON ii.id = ti.inventory_item_id
                       WHERE ti.ticket_id = t.id) AS parts_suggestion
             FROM service_tickets t
             LEFT JOIN clients c ON c.id = t.client_id
             WHERE t.status::text IN ('resolved', 'closed')${scope}
             ORDER BY COALESCE(t.event_start, t.created_at) DESC
             LIMIT 100`,
            params
        );
        res.json(r.rows.map(row => ({ ...row, report_count: Number(row.report_count) })));
    } catch (err) {
        console.error('my-done-tickets error:', err.message);
        res.status(500).json({ error: 'Failed to load tickets.' });
    }
});

/* -----------------------------------------------------------------------
   POST /api/projects/report  (multipart: photos[])
   Post a technician's field report to the project-reports Slack channel in the
   mobile-app format (Job name = client, so it also matches the client's Reports
   tab), attaching photos, then record it locally.
   ----------------------------------------------------------------------- */
router.post('/report', (req, res) => {
    upload.array('photos', 10)(req, res, async (uErr) => {
        if (uErr) return res.status(400).json({ error: uErr.message || 'Photo upload failed.' });
        try {
            const ticketId = Number(req.body.ticket_id);
            if (!ticketId) return res.status(400).json({ error: 'ticket_id is required.' });
            const work = (req.body.work || '').trim();
            if (!work)   return res.status(400).json({ error: 'Work completed is required.' });
            if (!CHANNEL_ID) return res.status(500).json({ error: 'Project reports channel is not configured.' });

            const arrival    = (req.body.arrival || '').trim();
            const parts      = (req.body.parts || '').trim();
            const returnTrip = ['true', 'yes', 'on', '1'].includes(String(req.body.return_trip).toLowerCase());

            /* Inventory items the tech linked → pending stock-change requests (deducted
               only when admin/accounting approve). Also appended to the parts text so
               they appear in the Slack report. */
            let lineItems = [];
            try { lineItems = JSON.parse(req.body.line_items || '[]'); } catch { lineItems = []; }
            lineItems = (Array.isArray(lineItems) ? lineItems : [])
                .map(li => ({ id: Number(li.inventory_item_id), qty: Number(li.qty), name: String(li.name || '').trim(), sku: String(li.sku || '').trim() }))
                .filter(li => Number.isInteger(li.id) && li.id > 0 && Number.isFinite(li.qty) && li.qty > 0);
            const linkedText = lineItems.map(li => `${li.qty}x ${li.name}${li.sku ? ` (${li.sku})` : ''}`).join('\n');
            const partsText  = [parts, linkedText].filter(Boolean).join('\n');

            const tq = await pool.query(
                `SELECT t.id, t.title, t.client_id, t.created_by, t.assignee_ids, c.name AS client_name
                 FROM service_tickets t LEFT JOIN clients c ON c.id = t.client_id WHERE t.id = $1`,
                [ticketId]
            );
            if (tq.rowCount === 0) return res.status(404).json({ error: 'Ticket not found.' });
            const t = tq.rows[0];

            /* Only an admin/accounting user or someone on the ticket may report it. */
            const isPriv   = ['admin', 'accounting'].includes(req.user.role);
            const assigned = Array.isArray(t.assignee_ids) && t.assignee_ids.includes(req.user.id);
            if (!isPriv && !assigned && t.created_by !== req.user.id)
                return res.status(403).json({ error: 'You can only report on tickets assigned to you.' });

            /* Technicians: the form value if given, else the ticket's assignees
               (falling back to the author). */
            let technicians = (req.body.technicians || '').trim();
            if (!technicians) {
                technicians = req.user.name;
                if (Array.isArray(t.assignee_ids) && t.assignee_ids.length) {
                    const uq = await pool.query('SELECT name FROM users WHERE id = ANY($1)', [t.assignee_ids]);
                    if (uq.rows.length) technicians = uq.rows.map(u => u.name).join(', ');
                }
            }

            /* Job name: the form value if given, else the client name — which also
               makes the report match this client on their Reports tab. */
            const jobName = (req.body.job_name || '').trim() || (t.client_name || t.title || 'Unknown').trim();
            const text = buildReportMessage({ jobName, rfq: (req.body.rfq || '').trim(), technicians, arrival, work, parts: partsText, returnTrip });

            const photos = (req.files || []).filter(f => f.mimetype && f.mimetype.startsWith('image/'));

            let slackTs = null;
            if (photos.length) {
                /* One message carrying the report text + all photos, so the parser
                   reads both the fields and the images off the same message. */
                const up = await slack.files.uploadV2({
                    channel_id:      CHANNEL_ID,
                    initial_comment: text,
                    file_uploads:    photos.map((f, i) => ({ file: f.buffer, filename: f.originalname || `photo-${i + 1}.jpg` })),
                });
                slackTs = up?.files?.[0]?.ts || null;
            } else {
                const msg = await slack.chat.postMessage({ channel: CHANNEL_ID, text });
                slackTs = msg?.ts || null;
            }

            const ins = await pool.query(
                `INSERT INTO ticket_reports (ticket_id, author_id, author_name, work, parts, arrival, return_trip, photo_count, slack_ts)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
                [ticketId, req.user.id, req.user.name, work, partsText, arrival, returnTrip, photos.length, slackTs]
            );
            /* Queue linked items as pending stock changes for admin/accounting to approve. */
            for (const li of lineItems) {
                await pool.query(
                    `INSERT INTO stock_change_requests (inventory_item_id, qty, requested_by, requester_name, source, source_id, note)
                     VALUES ($1,$2,$3,$4,'report',$5,$6)`,
                    [li.id, li.qty, req.user.id, req.user.name, ticketId, li.name || null]
                ).catch(e => console.error('stock request insert:', e.message));
            }
            res.status(201).json({ ...ins.rows[0], pending_changes: lineItems.length });
        } catch (err) {
            console.error('Report post error:', err.message);
            res.status(500).json({ error: 'Failed to submit report.' });
        }
    });
});

module.exports = router;
