/**
 * One-time export script.
 * Run from the server/ directory:
 *
 *   node scripts/export_app_data.js
 *
 * Writes seed_data.json to the current working directory.
 * Copy that file into PhxFieldReports/app/src/main/assets/ and rebuild the app.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { WebClient } = require('@slack/web-api');
const pool          = require('../db/pool');
const fs            = require('fs');
const path          = require('path');

const slack      = new WebClient(process.env.SLACK_TOKEN);
const CHANNEL_ID = process.env.PROJECT_SLACK_CHANNEL_ID;

/* ── Slack helpers (same as appSync.js / projects.js) ─────────────────────── */
function parseFields(text) {
    if (!text || !text.includes('\n')) return null;
    const lines  = text.split('\n').map(l => l.trim());
    const isBold = l => /^\*[^*]+\*$/.test(l);
    const destar = l => l.replace(/\*/g, '').trim();
    const skip   = l => l.toLowerCase().includes('submission from') ||
                        l.toLowerCase().includes('project report');

    if (lines.some(isBold)) {
        const fields = {}; let key = null, vals = [];
        for (const raw of lines) {
            if (!raw || skip(raw)) continue;
            if (isBold(raw)) {
                if (key !== null) { const v = vals.join('\n').trim(); if (v) fields[key] = v; }
                key = destar(raw); vals = [];
            } else if (key !== null) { vals.push(raw); }
        }
        if (key !== null) { const v = vals.join('\n').trim(); if (v) fields[key] = v; }
        return Object.keys(fields).length ? fields : null;
    }
    return null;
}

function getJobName(fields) {
    if (!fields) return null;
    const keys = ['Job name', 'Job Name', 'Project name', 'Project Name', 'Job'];
    for (const k of keys) if (fields[k]) return fields[k];
    for (const [fk, fv] of Object.entries(fields))
        if (['job', 'project'].some(t => fk.toLowerCase().includes(t))) return fv;
    return null;
}

/* ── Main ─────────────────────────────────────────────────────────────────── */
async function main() {
    // ── Clients from DB (non-fatal if it fails) ────────────────────────────
    let clients = [];
    try {
        console.log('Fetching clients from database...');
        const clientRows = await pool.query('SELECT name FROM clients ORDER BY name ASC');
        clients = clientRows.rows.map(r => r.name).filter(Boolean);
        console.log(`  Found ${clients.length} clients.`);
    } catch (err) {
        console.warn(`  DB skipped (${err.message}) — clients will be empty.`);
        console.warn('  Fix DB_PASSWORD in .env if you want clients included.');
    }

    // ── Job names from Slack ───────────────────────────────────────────────
    let jobs = [];
    try {
        console.log('Fetching job names from Slack...');
        const slackResult = await slack.conversations.history({ channel: CHANNEL_ID, limit: 200 });
        const jobSet = new Set();
        for (const msg of slackResult.messages || []) {
            const name = getJobName(parseFields(msg.text));
            if (name && name.trim().length > 2) jobSet.add(name.trim());
        }
        jobs = [...jobSet].sort();
        console.log(`  Found ${jobs.length} unique job names.`);
    } catch (err) {
        console.warn(`  Slack skipped (${err.message}) — jobs will be empty.`);
    }

    // ── Write output ───────────────────────────────────────────────────────
    const output  = JSON.stringify({ clients, jobs }, null, 2);
    const outPath = path.join(process.cwd(), 'seed_data.json');
    fs.writeFileSync(outPath, output, 'utf8');

    console.log(`\nWritten to: ${outPath}`);
    console.log('Copy it to: PhxFieldReports/app/src/main/assets/seed_data.json');
    console.log('Then rebuild the app.');
    process.exit(0);
}

main();
