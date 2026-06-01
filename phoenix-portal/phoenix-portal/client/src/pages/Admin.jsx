import { useEffect, useState, useRef } from 'react';
import api from '../api/client';
import Layout from '../components/Layout';
import './Dashboard.css';

const ROLE_TAG = { admin: 'tag-red', accounting: 'tag-blue', technician: 'tag-green' };

function NewUserModal({ onClose, onCreated }) {
    const [form, setForm] = useState({ name: '', email: '', password: '', role: 'technician' });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

    const submit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            await api.post('/auth/register', form);
            onCreated();
            onClose();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to create user.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-title">Create User</div>
                {error && <div className="error-msg">{error}</div>}
                <form onSubmit={submit}>
                    <div className="form-group">
                        <label className="form-label">Full Name</label>
                        <input value={form.name} onChange={e => set('name', e.target.value)} required autoFocus />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Email</label>
                        <input type="email" value={form.email} onChange={e => set('email', e.target.value)} required />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Password</label>
                        <input type="password" value={form.password} onChange={e => set('password', e.target.value)} required />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Role</label>
                        <select value={form.role} onChange={e => set('role', e.target.value)}>
                            <option value="technician">Technician</option>
                            <option value="accounting">Accounting</option>
                            <option value="admin">Admin</option>
                        </select>
                    </div>
                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            {loading ? 'Creating...' : 'Create User'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

/* -----------------------------------------------------------------------
   Bulk Billing Tab
   ----------------------------------------------------------------------- */
function BillingTab() {
    const [clients, setClients]   = useState([]);
    const [dirty, setDirty]       = useState({});   /* id → new value */
    const [search, setSearch]     = useState('');
    const [saving, setSaving]     = useState(false);
    const [msg, setMsg]           = useState('');
    const origRef                 = useRef({});

    useEffect(() => {
        api.get('/clients').then(r => {
            setClients(r.data);
            origRef.current = Object.fromEntries(r.data.map(c => [c.id, c.billing_amount ?? '']));
        });
    }, []);

    const onChange = (id, val) => {
        setDirty(prev => ({ ...prev, [id]: val }));
    };

    const getValue = (c) => (c.id in dirty ? dirty[c.id] : (c.billing_amount ?? ''));

    const dirtyIds = clients.filter(c => {
        const cur = getValue(c);
        const orig = origRef.current[c.id] ?? '';
        return String(cur) !== String(orig);
    });

    const save = async () => {
        if (dirtyIds.length === 0) return;
        setSaving(true);
        setMsg('');
        try {
            await api.patch('/clients/billing/bulk', {
                updates: dirtyIds.map(c => ({ id: c.id, billing_amount: getValue(c) })),
            });
            /* Commit dirty values to origRef so they no longer show as dirty */
            dirtyIds.forEach(c => { origRef.current[c.id] = getValue(c); });
            setDirty({});
            setMsg(`Saved ${dirtyIds.length} client${dirtyIds.length !== 1 ? 's' : ''}.`);
            setTimeout(() => setMsg(''), 3000);
        } catch {
            setMsg('Save failed.');
        } finally {
            setSaving(false);
        }
    };

    const visible = clients.filter(c =>
        !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.customer_id.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="billing-table-wrap">
            <div className="billing-save-bar">
                <input
                    className="alarm-search billing-search"
                    placeholder="Search clients…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
                <button
                    className="btn btn-primary"
                    onClick={save}
                    disabled={saving || dirtyIds.length === 0}
                >
                    {saving ? 'Saving…' : `Save Changes${dirtyIds.length > 0 ? ` (${dirtyIds.length})` : ''}`}
                </button>
                {msg && <span style={{ fontSize: 12, color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>{msg}</span>}
            </div>
            <div className="table-card">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Client</th>
                            <th>ID</th>
                            <th>Services</th>
                            <th>Monthly Billing ($)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {visible.map(c => {
                            const val = getValue(c);
                            const isDirty = String(val) !== String(origRef.current[c.id] ?? '');
                            return (
                                <tr key={c.id} className={isDirty ? 'billing-row--dirty' : ''}>
                                    <td style={{ fontWeight: 500, color: 'var(--text-hi)' }}>{c.name}</td>
                                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>{c.customer_id}</td>
                                    <td>
                                        {(c.services || []).map(s => (
                                            <span key={s} className={`tag ${s === 'fire' ? 'tag-red' : s === 'access_control' ? 'tag-blue' : 'tag-yellow'}`} style={{ marginRight: 4 }}>{s}</span>
                                        ))}
                                    </td>
                                    <td>
                                        <input
                                            className="billing-input"
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            placeholder="—"
                                            value={val}
                                            onChange={e => onChange(c.id, e.target.value)}
                                        />
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default function Admin() {
    const [tab, setTab]           = useState('users');
    const [users, setUsers]       = useState([]);
    const [loading, setLoading]   = useState(true);
    const [showModal, setShowModal] = useState(false);

    const load = async () => {
        try {
            const { data } = await api.get('/admin/users');
            setUsers(data);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const changeRole = async (id, role) => {
        try {
            const { data } = await api.patch(`/admin/users/${id}/role`, { role });
            setUsers(prev => prev.map(u => u.id === id ? { ...u, role: data.role } : u));
        } catch (e) { console.error(e); }
    };

    const deleteUser = async (id) => {
        if (!confirm('Delete this user?')) return;
        try {
            await api.delete(`/admin/users/${id}`);
            setUsers(prev => prev.filter(u => u.id !== id));
        } catch (e) { alert(e.response?.data?.error || 'Failed.'); }
    };

    return (
        <Layout>
            <div className="page-header">
                <h1 className="page-title">Admin</h1>
                {tab === 'users' && (
                    <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Create User</button>
                )}
            </div>

            <div className="alarm-service-tabs" style={{ marginBottom: 24 }}>
                <button className={`alarm-tab ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>
                    Users <span className="alarm-tab-count">{users.length}</span>
                </button>
                <button className={`alarm-tab ${tab === 'billing' ? 'active' : ''}`} onClick={() => setTab('billing')}>
                    Billing
                </button>
            </div>

            {tab === 'billing' && <BillingTab />}

            {tab === 'users' && loading && <p style={{ color: 'var(--text-dim)' }}>Loading...</p>}

            {tab === 'users' && !loading && (
                <div className="table-card">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Name</th>
                                <th>Email</th>
                                <th>Role</th>
                                <th>Joined</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(u => (
                                <tr key={u.id}>
                                    <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', fontSize: 12 }}>#{u.id}</td>
                                    <td style={{ fontWeight: 500, color: 'var(--text-hi)' }}>{u.name}</td>
                                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>{u.email}</td>
                                    <td>
                                        <span className={`tag ${ROLE_TAG[u.role]}`}>{u.role}</span>
                                    </td>
                                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>
                                        {new Date(u.created_at).toLocaleDateString()}
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                            <select
                                                value={u.role}
                                                onChange={e => changeRole(u.id, e.target.value)}
                                                style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
                                            >
                                                <option value="technician">Technician</option>
                                                <option value="accounting">Accounting</option>
                                                <option value="admin">Admin</option>
                                            </select>
                                            <button className="btn btn-danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => deleteUser(u.id)}>
                                                Del
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {showModal && (
                <NewUserModal
                    onClose={() => setShowModal(false)}
                    onCreated={load}
                />
            )}
        </Layout>
    );
}
