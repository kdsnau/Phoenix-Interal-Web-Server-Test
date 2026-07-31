import { useState, useEffect } from 'react';
import api from '../api/client';
import Layout from '../components/Layout';
import PageHelp from '../components/PageHelp';

const isoDay  = d => d.toISOString().slice(0, 10);
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
const csvCell = s => `"${String(s ?? '').replace(/"/g, '""')}"`;

/* Default range = first of this month → today. */
function defaultRange() {
    const now = new Date();
    return { start: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), end: isoDay(now) };
}

function Stat({ label, value, accent }) {
    return (
        <div className="stat-card">
            <div className="stat-label">{label}</div>
            <div className="stat-value" style={accent ? { color: 'var(--accent)' } : undefined}>
                {Number(value || 0).toFixed(2)} h
            </div>
        </div>
    );
}

export default function Timesheets() {
    const [staff, setStaff]     = useState([]);
    const [userId, setUserId]   = useState('');
    const [range, setRange]     = useState(defaultRange());
    const [sheet, setSheet]     = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        api.get('/timesheets/staff')
            .then(r => { setStaff(r.data); if (r.data.length) setUserId(String(r.data[0].id)); })
            .catch(() => {});
    }, []);

    useEffect(() => {
        if (!userId) return;
        setLoading(true);
        api.get('/timesheets', { params: { user_id: userId, start: range.start, end: range.end } })
            .then(r => setSheet(r.data))
            .catch(() => setSheet(null))
            .finally(() => setLoading(false));
    }, [userId, range.start, range.end]);

    function exportCsv() {
        if (!sheet) return;
        const lines = [['Date', 'Ticket', 'Client', 'Location', 'On-site h', 'Travel h', 'Total h'].join(',')];
        for (const r of sheet.rows) {
            lines.push([fmtDate(r.date), csvCell(r.title), csvCell(r.client || ''), csvCell(r.location || ''),
                r.onsite_hours, r.travel_hours ?? '', r.total_hours].join(','));
        }
        lines.push(['', '', '', 'TOTAL', sheet.totals.onsite_hours, sheet.totals.travel_hours, sheet.totals.total_hours].join(','));
        const who = staff.find(s => String(s.id) === String(userId))?.name || 'timesheet';
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
        a.download = `timesheet-${who}-${range.start}_${range.end}.csv`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(a.href);
    }

    return (
        <Layout>
            <div className="timesheets-page">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                    <h1 className="page-title">Timesheets<PageHelp id="timesheets" /></h1>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <select value={userId} onChange={e => setUserId(e.target.value)}>
                            {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        <input type="date" value={range.start} onChange={e => setRange(r => ({ ...r, start: e.target.value }))} />
                        <input type="date" value={range.end}   onChange={e => setRange(r => ({ ...r, end: e.target.value }))} />
                        <button className="btn btn-ghost" onClick={exportCsv} disabled={!sheet || !sheet.rows.length}>Export CSV</button>
                    </div>
                </div>

                {sheet && (
                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-dim)' }}>
                        Travel estimated from the office ({sheet.office}).
                    </div>
                )}

                {loading ? <div className="alarm-empty">Loading…</div> : sheet && (
                    <>
                        <div style={{ display: 'flex', gap: 12, margin: '16px 0', flexWrap: 'wrap' }}>
                            <Stat label="On-site" value={sheet.totals.onsite_hours} />
                            <Stat label="Travel (est, round-trip)" value={sheet.totals.travel_hours} />
                            <Stat label="Total hours" value={sheet.totals.total_hours} accent />
                        </div>

                        <div className="table-card">
                            <table className="data-table card-table">
                                <thead>
                                    <tr>
                                        <th>Date</th><th>Ticket</th><th>Client</th><th>Location</th>
                                        <th style={{ textAlign: 'right' }}>On-site</th>
                                        <th style={{ textAlign: 'right' }}>Travel</th>
                                        <th style={{ textAlign: 'right' }}>Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sheet.rows.length === 0 && (
                                        <tr><td colSpan={7} className="alarm-empty">No completed, scheduled tickets in this range.</td></tr>
                                    )}
                                    {sheet.rows.map(r => (
                                        <tr key={r.id}>
                                            <td data-label="Date" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{fmtDate(r.date)}</td>
                                            <td data-label="Ticket" style={{ color: 'var(--text-hi)' }}>{r.title}</td>
                                            <td data-label="Client">{r.client || '—'}</td>
                                            <td data-label="Location" style={{ fontSize: 12, color: 'var(--text-dim)' }}>{r.location || '—'}</td>
                                            <td data-label="On-site" style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{r.onsite_hours.toFixed(2)}</td>
                                            <td data-label="Travel" style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: r.travel_hours == null ? 'var(--text-dim)' : undefined }}>
                                                {r.travel_hours == null ? '—' : r.travel_hours.toFixed(2)}
                                            </td>
                                            <td data-label="Total" style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{r.total_hours.toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 10 }}>
                            Estimate: <strong>on-site</strong> = ticket entry→departure; <strong>travel</strong> = round-trip
                            straight-line distance between the office and each ticket's location × a road factor ÷ average speed,
                            counted once per ticket. Rough by design; tickets with no usable address show “—”.
                        </div>
                    </>
                )}
            </div>
        </Layout>
    );
}
