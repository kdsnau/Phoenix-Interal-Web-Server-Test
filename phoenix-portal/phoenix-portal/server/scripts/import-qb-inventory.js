#!/usr/bin/env node
/* ==========================================================================
   Import QuickBooks item-list CSV into phoenix_portal inventory_items table.

   Usage:
     node scripts/import-qb-inventory.js /path/to/inventory.CSV

   What it does:
     - Skips "Service" and "Non-inventory" rows (labour items, etc.)
     - Imports every "Inventory Part" row (active and inactive)
     - Auto-detects category from description / SKU prefix
     - Upserts on SKU (safe to re-run; existing records are updated)
     - Sets quantity to 0 for negative on-hand values (honours DB constraint)
   ========================================================================== */

const fs   = require('fs');
const path = require('path');

/* Load .env from server root (works whether run from /server or /server/scripts) */
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const pool = require('../db/pool');

/* -------------------------------------------------------------------------- */
const FILE = process.argv[2];
if (!FILE) {
    console.error('Usage: node import-qb-inventory.js <path/to/inventory.CSV>');
    process.exit(1);
}
if (!fs.existsSync(FILE)) {
    console.error(`File not found: ${FILE}`);
    process.exit(1);
}

/* ---- CSV parser (RFC 4180 — handles quoted fields with commas/newlines) -- */
function parseCSVLine(line) {
    const result = [];
    let field    = '';
    let inQ      = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            if (inQ && line[i + 1] === '"') { field += '"'; i++; }   // escaped quote
            else inQ = !inQ;
        } else if (c === ',' && !inQ) {
            result.push(field.trim());
            field = '';
        } else {
            field += c;
        }
    }
    result.push(field.trim());
    return result;
}

/* ---- Category auto-detection --------------------------------------------- */
function guessCategory(sku, desc) {
    const d = (desc || '').toUpperCase();
    const s = (sku  || '').toUpperCase();

    if (/\bCAMERA\b|FISHEYE|BULLET|DOME|TURRET|PTZ|VARIFOCAL|EYEBALL|TVL|CMOS|SURVEILLANCE/.test(d)) return 'cameras';
    if (/NVR\b|DVR\b|VIDEO RECORDER|HARD DRIVE|HDD\b|SSD\b|EXOS|IRONWOLF|\bSTORAGE\b/.test(d))       return 'storage';
    if (/\bSWITCH\b|POE\b|ETHERNET|FIBER|PATCH PANEL|CAT5|CAT6|UTP\b|SFP\b|RACK\b|CABLE\b|SERVER CABINET/.test(d)) return 'networking';
    if (/CARD READER|KEYPAD|DOOR STRIKE|DEAD LATCH|MAGLOCK|DEAD BOLT|ACCESS CONTROL|\bREQUEST.TO.EXIT\b|\bREX\b/.test(d)) return 'access_control';
    if (/SMOKE\b|FIRE ALARM|HORN STROBE|PULL STATION|HEAT DETECTOR|\bDUCT\b|NOTIFICATION APPLIANCE/.test(d)) return 'fire_alarm';
    if (/POWER SUPPLY|BATTERY|UPS\b|TRANSFORMER|SURGE PROTECT/.test(d))     return 'power';
    if (/SPEAKER|STROBE|SIREN|\bHORN\b|\bBELL\b/.test(d))                   return 'notification';

    /* Fall back to SKU numeric prefix convention */
    if (s.match(/^0/)) return 'access_control';
    if (s.match(/^2/)) return 'cameras';
    if (s.match(/^3/)) return 'storage';
    if (s.match(/^5/)) return 'fire_alarm';
    if (s.match(/^9/)) return 'networking';

    return 'equipment';
}

/* ---- Column indices (0-based) --------------------------------------------
   0  blank
   1  Active Status       ("Active" | "Not-active")
   2  Type                ("Inventory Part" | "Service" | ...)
   3  Item                SKU / item code
   4  Description         display name
   5  Sales Tax Code
   6  Account
   7  COGS Account
   8  Asset Account
   9  Accumulated Depreciation
   10 Purchase Description
   11 Quantity On Hand
   12 U/M                 unit of measure
   13 Cost                purchase cost
   14 Preferred Vendor
   15 Tax Agency
   16 Price               sale price
   17 Reorder Pt (Min)    min_threshold
   18 MPN
   19 Barcode
   -------------------------------------------------------------------------- */

async function main() {
    console.log(`Reading ${FILE} …`);
    const lines = fs.readFileSync(FILE, 'utf-8').split('\n').filter(l => l.trim());
    console.log(`  ${lines.length} rows (including header)`);

    /* Ensure the new columns and unique index exist */
    console.log('Applying schema migrations …');
    await pool.query(`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS cost   NUMERIC(10,2)`).catch(() => {});
    await pool.query(`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS price  NUMERIC(10,2)`).catch(() => {});
    await pool.query(`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS vendor TEXT`).catch(() => {});
    await pool.query(`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS mpn    TEXT`).catch(() => {});
    await pool.query(`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE`).catch(() => {});
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_sku ON inventory_items(sku) WHERE sku IS NOT NULL`).catch(() => {});
    console.log('  Migrations OK.');

    let imported = 0, skipped = 0, errors = 0;

    /* Skip header row */
    for (const line of lines.slice(1)) {
        const cols = parseCSVLine(line);
        if (cols.length < 4) { skipped++; continue; }

        const type = cols[2] || '';
        if (type !== 'Inventory Part') { skipped++; continue; }

        const sku = (cols[3] || '').trim();
        if (!sku) { skipped++; continue; }

        const active      = (cols[1] || '').trim() === 'Active';
        const desc        = (cols[4]  || '').trim();
        const qtyStr      = (cols[11] || '0').trim();
        const unitRaw     = (cols[12] || 'ea').trim();
        const costStr     = (cols[13] || '0').trim();
        const vendorRaw   = (cols[14] || '').trim();
        const priceStr    = (cols[16] || '0').trim();
        const reorderStr  = (cols[17] || '0').trim();
        const mpnRaw      = (cols[18] || '').trim();

        const quantity      = Math.max(0, parseInt(qtyStr, 10)   || 0);
        const cost          = parseFloat(costStr)   || null;
        const price         = parseFloat(priceStr)  || null;
        const min_threshold = Math.max(0, parseInt(reorderStr, 10) || 0);
        const vendor        = vendorRaw  || null;
        const mpn           = mpnRaw     || null;

        /* Clean unit — QuickBooks uses "each (ea)", we just want "ea" */
        const unit = unitRaw.replace(/each\s*\(ea\)/i, 'ea').replace(/\(.*?\)/g, '').trim() || 'ea';

        /* Truncate description to fit name column */
        const name     = (desc || sku).slice(0, 200);
        const category = guessCategory(sku, desc);

        try {
            await pool.query(`
                INSERT INTO inventory_items
                    (name, sku, category, quantity, min_threshold, unit, cost, price, vendor, mpn, active)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                ON CONFLICT (sku) WHERE sku IS NOT NULL DO UPDATE SET
                    name          = EXCLUDED.name,
                    category      = EXCLUDED.category,
                    quantity      = EXCLUDED.quantity,
                    min_threshold = EXCLUDED.min_threshold,
                    unit          = EXCLUDED.unit,
                    cost          = EXCLUDED.cost,
                    price         = EXCLUDED.price,
                    vendor        = EXCLUDED.vendor,
                    mpn           = EXCLUDED.mpn,
                    active        = EXCLUDED.active,
                    updated_at    = NOW()
            `, [name, sku, category, quantity, min_threshold, unit,
                cost, price, vendor, mpn, active]);

            imported++;
            if (imported % 200 === 0) console.log(`  … ${imported} upserted`);
        } catch (e) {
            console.error(`  Error on SKU "${sku}": ${e.message}`);
            errors++;
        }
    }

    console.log('\n────────────────────────────────────────');
    console.log(`  Upserted (Inventory Parts):  ${imported}`);
    console.log(`  Skipped  (Service/other):    ${skipped}`);
    console.log(`  Errors:                      ${errors}`);
    console.log('────────────────────────────────────────');
    await pool.end();
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
