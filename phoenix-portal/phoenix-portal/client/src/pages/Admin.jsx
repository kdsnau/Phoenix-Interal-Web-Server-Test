import { useEffect, useState } from 'react';
import api from '../api/client';
import Layout from '../components/Layout';

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

export default function Admin() {
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
                <h1 className="page-title">Admin <span>{users.length} users</span></h1>
                <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Create User</button>
            </div>

            {loading && <p style={{ color: 'var(--text-dim)' }}>Loading...</p>}

            {!loading && (
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
