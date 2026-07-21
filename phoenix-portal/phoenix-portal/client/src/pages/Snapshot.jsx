import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import Layout from '../components/Layout';
import PageHelp from '../components/PageHelp';
import './Financials.css';

const SNAP_TYPES = [
    { key: 'in_progress', label: 'In Progress' },
    { key: 'complete',    label: 'Complete' },
    { key: 'deadbeat',    label: 'Deadbeat' },
];

function SnapshotModal({ type, onClose, onCreated }) {
    const inProgress = type === 'in_progress';
    const typeLabel  = SNAP_TYPES.find(t => t.key === type)?.label || type;
    const [form, setForm]     = useState({ customer: '', rfq: '', hours: '', scheduled_date: '', invoice_num: '', email_date: '', notes: '' });
    const [error, setError]   = useState('');
    const [saving, setSaving] = useState(false);
    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

    async function submit(e) {
        e.preventDefault();
        if (!form.customer.trim()) { setError('Customer is required.'); return; }
        setSaving(true); setError('');
        try {
            const { data } = await api.post('/snapshot', { type, ...form });
            onCreated(data);
            onClose();
        } catch (err) { setError(err.response?.data?.error || 'Failed to add entry.'); }
        finally { setSaving(false); }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-title">Add {typeLabel} Entry</div>
                {error && <div className="error-msg">{error}</div>}
                <form onSubmit={submit}>
                    <div className="form-group">
                        <label className="form-label">Customer</label>
                        <input value={form.customer} onChange={e => set('customer', e.target.value)} required autoFocus />
                    </div>
                    {inProgress ? (
                        <>
                            <div className="form-group"><label className="form-label">RFQ</label><input value={form.rfq} onChange={e => set('rfq', e.target.value)} /></div>
                            <div className="form-group"><label className="form-label">Hours</label><input type="number" min="0" step="0.5" value={form.hours} onChange={e => set('hours', e.target.value)} /></div>
                            <div className="form-group"><label className="form-label">Scheduled Date</label><input value={form.scheduled_date} onChange={e => set('scheduled_date', e.target.value)} placeholder="TBD or M/D/YY" /></div>
                        </>
                    ) : (
                        <>
                            <div className="form-group"><label className="form-label">Invoice #</label><input value={form.invoice_num} onChange={e => set('invoice_num', e.target.value)} /></div>
                            <div className="form-group"><label className="form-label">Email Date</label><input value={form.email_date} onChange={e => set('email_date', e.target.value)} placeholder="M/D/YY" /></div>
                            <div className="form-group"><label className="form-label">RFQ</label><input value={form.rfq} onChange={e => set('rfq', e.target.value)} /></div>
                        </>
                    )}
                    <div className="form-group"><label className="form-label">Notes</label><textarea rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} /></div>
                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Adding…' : 'Add Entry'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default function Snapshot() {
    const { user }    = useAuth();
    const canManage   = user.role === 'admin' || user.role === 'accounting';
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [subTab,  setSubTab]  = useState('in_progress');
    const [showAdd, setShowAdd] = useState(false);

    useEffect(() => {
        api.get('/snapshot').then(r => setEntries(r.data)).catch(() => setEntries([])).finally(() => setLoading(false));
    }, []);

    const onCreated = (e) => setEntries(prev => [e, ...prev]);
    async function deleteEntry(id) {
        if (!confirm('Delete this snapshot entry?')) return;
        try { await api.delete(`/snapshot/${id}`); setEntries(prev => prev.filter(s => s.id !== id)); }
        catch (err) { console.error(err); }
    }

    const inProgress = subTab === 'in_progress';
    const rows   = entries.filter(e => e.type === subTab);
    const counts = Object.fromEntries(SNAP_TYPES.map(t => [t.key, entries.filter(e => e.type === t.key).length]));

    return (
        <Layout>
            <div className="page-header">
                <h1 className="page-title">Snapshot<PageHelp id="snapshot" /></h1>
            </div>

            <div className="fin-section-tabs" style={{ marginBottom: 12, alignItems: 'center' }}>
                {SNAP_TYPES.map(t => (
                    <button key={t.key} className={`fin-tab ${subTab === t.key ? 'active' : ''}`} onClick={() => setSubTab(t.key)}>
                        {t.label}<span className="fin-tab-count">{counts[t.key]}</span>
                    </button>
                ))}
                {canManage && (
                    <button className="btn btn-primary" style={{ marginLeft: 'auto', fontSize: 12 }} onClick={() => setShowAdd(true)}>+ Add Entry</button>
                )}
            </div>

            {loading ? (
                <div className="fin-empty">Loading…</div>
            ) : (
                <div className="fin-table-wrap">
                    <table className="fin-table">
                        <thead>
                            {inProgress ? (
                                <tr><th>Customer</th><th>RFQ</th><th>Hours</th><th>Scheduled</th><th>Notes</th>{canManage && <th></th>}</tr>
                            ) : (
                                <tr><th>Customer</th><th>Invoice #</th><th>Email Date</th><th>RFQ</th><th>Notes</th>{canManage && <th></th>}</tr>
                            )}
                        </thead>
                        <tbody>
                            {rows.length === 0 ? (
                                <tr><td colSpan={canManage ? 6 : 5} className="fin-empty">No entries.</td></tr>
                            ) : rows.map(e => (
                                <tr key={e.id}>
                                    <td style={{ fontWeight: 500, color: 'var(--text-hi)' }}>{e.customer}</td>
                                    {inProgress ? (
                                        <>
                                            <td className="fin-mono">{e.rfq || '—'}</td>
                                            <td className="fin-mono">{e.hours != null ? e.hours : '—'}</td>
                                            <td className="fin-mono">{e.scheduled_date || '—'}</td>
                                        </>
                                    ) : (
                                        <>
                                            <td className="fin-mono">{e.invoice_num || '—'}</td>
                                            <td className="fin-mono">{e.email_date || '—'}</td>
                                            <td className="fin-mono">{e.rfq || '—'}</td>
                                        </>
                                    )}
                                    <td style={{ color: '#c9d4e0', whiteSpace: 'pre-wrap' }}>{e.notes}</td>
                                    {canManage && (
                                        <td style={{ textAlign: 'right' }}>
                                            <button className="btn btn-ghost" style={{ fontSize: 11, color: 'var(--red)' }} onClick={() => deleteEntry(e.id)}>Delete</button>
                                        </td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {showAdd && <SnapshotModal type={subTab} onClose={() => setShowAdd(false)} onCreated={onCreated} />}
        </Layout>
    );
}
