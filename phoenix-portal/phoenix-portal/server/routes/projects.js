const express      = require('express');
const { WebClient } = require('@slack/web-api');
const { authenticate, requireRole } = require('../middleware/requireRole');
const pool         = require('../db/pool');

const router     = express.Router();
router.use(authenticate);

const slack      = new WebClient(process.env.SLACK_TOKEN);
const CHANNEL_ID = process.env.PROJECT_SLACK_CHANNEL_ID;

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

/* Normalise a job name for grouping — case-insensitive, collapse whitespace */
const normalizeKey = s => s.trim().replace(/\s+/g, ' ').toLowerCase();

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

/* -----------------------------------------------------------------------
   GET /api/projects
   Groups Slack messages by normalised job name into project cards,
   then applies any manual completion overrides from the DB.
   ----------------------------------------------------------------------- */
router.get('/', async (req, res) => {
    try {
        const [slackResult, overrideResult, manualResult] = await Promise.all([
            slack.conversations.history({ channel: CHANNEL_ID, limit: 1000 }),
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

module.exports = router;
