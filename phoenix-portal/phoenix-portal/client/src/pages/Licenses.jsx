import { useState, useEffect } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import Layout from '../components/Layout';
import PageHelp from '../components/PageHelp';

const daysUntil = d => d ? Math.ceil((new Date(d) - new Date()) / 86400000) : null;

function UsageBar({ used, total, over }) {
    if (total == null) return <span style={{ fontFamily: 'var(--font-mono)' }}>{used} used</span>;
    const pct   = total > 0 ? Math.min(100, (used / total) * 100) : 0;
    const color = over ? 'var(--red)' : pct >= 85 ? 'var(--yellow, #d9a441)' : 'var(--green)';
    return (
        <div style={{ minWidth: 150 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, marginBottom: 3 }}>
                <span style={{ fontFamily: 'var(--font-mono)', color: over ? 'var(--red)' : 'var(--text-hi)' }}>{used} / {total}</span>
                {over
                    ? <span className="tag-red">over by {used - total}</span>
                    : <span style={{ color: 'var(--text-dim)' }}>{total - used} free</span>}
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: color }} />
            </div>
        </div>
    );
}

function LicenseModal({ initial, onClose, onSaved }) {
    const editing = !!initial;
    const [form, setForm] = useState(() => ({
        name: initial?.name || '', vendor: initial?.vendor || '', license_key: initial?.license_key || '',
        seats_total: initial?.seats_total ?? '', seats_used: initial?.seats_used ?? 0,
        category: initial?.category || '', expires_at: initial?.expires_at ? initial.expires_at.slice(0, 10) : '',
        notes: initial?.notes || '',
    }));
    const [error, setError]   = useState('');
    const [saving, setSaving] = useState(false);
    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

    async function submit(e) {
        e.preventDefault(); setError(''); setSaving(true);
        try {
            const { data } = editing
                ? await api.patch(`/licenses/${initial.id}`, form)
                : await api.post('/licenses', form);
            onSaved(data); onClose();
        } catch (err) { setError(err.response?.data?.error || 'Failed to save.'); }
        finally { setSaving(false); }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520, width: '100%' }}>
                <div className="modal-title">{editing ? 'Edit License' : 'Add License'}</div>
                {error && <div className="error-msg">{error}</div>}
                <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Name *</label>
                            <input value={form.name} onChange={e => set('name', e.target.value)} required autoFocus />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Vendor</label>
                            <input value={form.vendor} onChange={e => set('vendor', e.target.value)} placeholder="DW Spectrum, DMP…" />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Seats (total)</label>
                            <input type="number" min="0" value={form.seats_total} onChange={e => set('seats_total', e.target.value)} placeholder="blank = no cap" />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Seats used</label>
                            <input type="number" min="0" value={form.seats_used} onChange={e => set('seats_used', e.target.value)} />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Category</label>
                            <input value={form.category} onChange={e => set('category', e.target.value)} placeholder="Software, Permit…" />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Expires</label>
                            <input type="date" value={form.expires_at} onChange={e => set('expires_at', e.target.value)} />
                        </div>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">License key</label>
                        <input value={form.license_key} onChange={e => set('license_key', e.target.value)} placeholder="optional" />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Notes</label>
                        <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
                    </div>
                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : (editing ? 'Save' : 'Add License')}</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default function Licenses() {
    const { user } = useAuth();
    const isAdmin = user.role === 'admin';
    const [licenses, setLicenses] = useState([]);
    const [loading, setLoading]   = useState(true);
    const [search, setSearch]     = useState('');
    const [modal, setModal]       = useState(null);   // {} = new, license = edit
    const [showKey, setShowKey]   = useState({});
    const [importing, setImporting] = useState(false);
    const [importMsg, setImportMsg] = useState('');

    function load() {
        setLoading(true);
        api.get('/licenses').then(r => setLicenses(r.data)).catch(() => setLicenses([])).finally(() => setLoading(false));
    }
    useEffect(() => { load(); }, []);

    async function bump(l, delta) {
        try {
            const { data } = await api.post(`/licenses/${l.id}/usage`, { delta });
            setLicenses(list => list.map(x => x.id === data.id ? data : x));
        } catch (e) { alert(e.response?.data?.error || 'Failed to update usage.'); }
    }
    async function del(l) {
        if (!confirm(`Delete “${l.name}”?`)) return;
        await api.delete(`/licenses/${l.id}`);
        setLicenses(list => list.filter(x => x.id !== l.id));
    }
    function onSaved(saved) {
        setLicenses(list => list.some(x => x.id === saved.id)
            ? list.map(x => x.id === saved.id ? saved : x)
            : [...list, saved].sort((a, b) => a.name.localeCompare(b.name)));
    }
    async function importDW() {
        setImporting(true); setImportMsg('');
        try {
            const { data } = await api.post('/nvr/import-licenses');
            const errs = (data.errors || []).length
                ? ` · ${data.errors.length} server error(s): ${data.errors.map(e => `${e.server} (${e.error})`).join('; ')}`
                : '';
            setImportMsg(data.servers === 0
                ? 'No NVR systems are linked yet.'
                : `${data.imported} added, ${data.updated} updated from ${data.servers} system(s)${errs}`);
            load();
        } catch (e) {
            setImportMsg(e.response?.data?.error || 'Import failed.');
        } finally { setImporting(false); }
    }

    const s = search.trim().toLowerCase();
    const filtered = s
        ? licenses.filter(l => l.name.toLowerCase().includes(s) || (l.vendor || '').toLowerCase().includes(s) || (l.category || '').toLowerCase().includes(s))
        : licenses;

    return (
        <Layout>
            <div className="licenses-page">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                    <h1 className="page-title">Licenses<PageHelp id="licenses" /></h1>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
                        {isAdmin && <button className="btn btn-ghost" onClick={importDW} disabled={importing}>{importing ? 'Pulling…' : '⤓ Pull from DW Spectrum'}</button>}
                        {isAdmin && <button className="btn btn-primary" onClick={() => setModal({})}>+ Add License</button>}
                    </div>
                </div>
                {importMsg && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-dim)' }}>{importMsg}</div>}

                {loading ? <div className="alarm-empty">Loading…</div> : (
                    <div className="table-card" style={{ marginTop: 16 }}>
                        <table className="data-table card-table">
                            <thead>
                                <tr><th>Name</th><th>Vendor</th><th>Usage</th><th>Expiry</th><th>Key</th>{isAdmin && <th></th>}</tr>
                            </thead>
                            <tbody>
                                {filtered.length === 0 && <tr><td colSpan={isAdmin ? 6 : 5} className="alarm-empty">No licenses yet.</td></tr>}
                                {filtered.map(l => {
                                    const du = daysUntil(l.expires_at);
                                    return (
                                        <tr key={l.id}>
                                            <td data-label="Name" style={{ color: 'var(--text-hi)', fontWeight: 500 }}>
                                                {l.name}
                                                {l.category && <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{l.category}</div>}
                                            </td>
                                            <td data-label="Vendor">{l.vendor || '—'}</td>
                                            <td data-label="Usage">
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    {isAdmin && <button className="btn btn-ghost" style={{ padding: '0 9px' }} onClick={() => bump(l, -1)}>−</button>}
                                                    <UsageBar used={l.seats_used} total={l.seats_total} over={l.over} />
                                                    {isAdmin && <button className="btn btn-ghost" style={{ padding: '0 9px' }} onClick={() => bump(l, +1)}>+</button>}
                                                </div>
                                            </td>
                                            <td data-label="Expiry" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                                                {l.expires_at
                                                    ? <span className={du < 0 ? 'tag-red' : du <= 30 ? 'tag-yellow' : ''}>
                                                        {new Date(l.expires_at).toLocaleDateString()}{du < 0 ? ' (expired)' : du <= 30 ? ` (${du}d)` : ''}
                                                      </span>
                                                    : '—'}
                                            </td>
                                            <td data-label="Key" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                                                {!l.has_key ? <span style={{ color: 'var(--text-dim)' }}>—</span>
                                                    : isAdmin
                                                        ? (showKey[l.id] ? l.license_key : '••••••')
                                                        : <span style={{ color: 'var(--text-dim)' }}>on file</span>}
                                                {isAdmin && l.has_key && (
                                                    <button className="btn btn-ghost" style={{ padding: '0 6px', marginLeft: 6, fontSize: 11 }}
                                                        onClick={() => setShowKey(k => ({ ...k, [l.id]: !k[l.id] }))}>
                                                        {showKey[l.id] ? 'hide' : 'show'}
                                                    </button>
                                                )}
                                            </td>
                                            {isAdmin && (
                                                <td data-label="" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                    <button className="btn btn-ghost"  style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => setModal(l)}>Edit</button>
                                                    <button className="btn btn-danger" style={{ padding: '2px 10px', fontSize: 12, marginLeft: 6 }} onClick={() => del(l)}>✕</button>
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {modal && (
                    <LicenseModal
                        initial={modal.id ? modal : null}
                        onClose={() => setModal(null)}
                        onSaved={onSaved}
                    />
                )}
            </div>
        </Layout>
    );
}
