const express = require('express');
const path    = require('path');
const XLSX    = require('xlsx');
const pool    = require('../db/pool');
const { requireRole } = require('../middleware/requireRole');

const router = express.Router();

function excelDateToISO(serial) {
    const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
    return date.toISOString().slice(0, 10);
}

const VEHICLE_MAP = {
    'nv 200-b':             'VH-008',
    '2018 nissan frontier': 'VH-009',
    '2017 nv200':           'VH-007',
    'scissor lift r&m':     'VH-011',
};

const TRANSACTION_TYPES = new Set(['credit card charge', 'bill', 'check', 'invoice']);

function otherSectionVehicle(memo, vendor) {
    const text = `${memo} ${vendor}`.toLowerCase();
    if (text.includes('tesla')) return 'VH-010';
    return null;
}

function parseReport() {
    const filePath = path.join(__dirname, '../reports/report.xlsx');
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    const results = [];
    let currentVehicle = null;
    let inOtherSection = false;

    for (const row of raw) {
        const cells = row.map(c => String(c).trim()).filter(Boolean);
        if (cells.length === 0) continue;

        if (cells.length === 1) {
            const key = cells[0].toLowerCase();
            if (VEHICLE_MAP[key]) {
                currentVehicle = VEHICLE_MAP[key];
                inOtherSection = false;
            } else if (key === 'maintenance & repair - other') {
                currentVehicle = null;
                inOtherSection = true;
            }
            continue;
        }

        const first = cells[0].toLowerCase();
        if (first.startsWith('total') || first === 'type' || !TRANSACTION_TYPES.has(first)) continue;

        const dateRaw   = cells[1];
        const vendor    = cells[3] || '';
        const memo      = cells[4] || '';
        const amountRaw = cells[cells.length - 1];

        const amount = parseFloat(amountRaw);
        if (isNaN(amount) || amount <= 0) continue;

        const date = isNaN(Number(dateRaw))
            ? dateRaw
            : excelDateToISO(Number(dateRaw));

        const description = (memo || vendor).slice(0, 255);

        let vehicleId = currentVehicle;
        if (inOtherSection) {
            vehicleId = otherSectionVehicle(memo, vendor);
            if (!vehicleId) continue;
        }
        if (!vehicleId) continue;

        results.push({ vehicle_id: vehicleId, description, amount, date, vendor });
    }

    return results;
}

router.get('/preview', requireRole('admin'), async (req, res) => {
    try {
        const rows = parseReport();
        return res.json({ count: rows.length, rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
});

router.post('/run', requireRole('admin'), async (req, res) => {
    try {
        const rows = parseReport();
        if (rows.length === 0) return res.json({ imported: 0, skipped: 0 });

        const vids = [...new Set(rows.map(r => r.vehicle_id))];
        const vResult = await pool.query(
            'SELECT id, vehicle_id FROM vehicles WHERE vehicle_id = ANY($1)',
            [vids]
        );
        const vehicleMap = Object.fromEntries(vResult.rows.map(v => [v.vehicle_id, v.id]));

        let imported = 0;
        let skipped  = 0;

        for (const row of rows) {
            const dbId = vehicleMap[row.vehicle_id];
            if (!dbId) { skipped++; continue; }

            const exists = await pool.query(
                `SELECT id FROM vehicle_invoices
                 WHERE vehicle_id = $1 AND description = $2 AND amount = $3 AND invoice_date = $4`,
                [dbId, row.description, row.amount, row.date]
            );
            if (exists.rowCount > 0) { skipped++; continue; }

            await pool.query(
                `INSERT INTO vehicle_invoices (vehicle_id, description, amount, invoice_date)
                 VALUES ($1, $2, $3, $4)`,
                [dbId, row.description, row.amount, row.date]
            );
            imported++;
        }

        return res.json({ imported, skipped });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;