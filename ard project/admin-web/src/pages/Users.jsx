import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post, del } from '../api/client';

export default function Users() {
    const [users, setUsers] = useState([]);
    const [err, setErr] = useState('');
    const [form, setForm] = useState({ name: '', email: '', role: 'user', password: '' });
    const [busy, setBusy] = useState(false);

    const load = () => get('/api/users').then(setUsers).catch((e) => setErr(e.message));
    useEffect(() => { load(); }, []);

    async function create(e) {
        e.preventDefault();
        setErr(''); setBusy(true);
        try {
            const payload = { ...form };
            if (!payload.password) delete payload.password;
            await post('/api/users', payload);
            setForm({ name: '', email: '', role: 'user', password: '' });
            load();
        } catch (e) { setErr(e.message); } finally { setBusy(false); }
    }

    async function remove(u) {
        if (!confirm(`Delete ${u.name}? Their credentials are removed; scan history is kept.`)) return;
        await del(`/api/users/${u.id}`);
        load();
    }

    return (
        <>
            <div className="topbar"><h1>Users</h1></div>
            {err && <div className="error" style={{ marginBottom: '1rem' }}>{err}</div>}

            <div className="panel" style={{ marginBottom: '1rem' }}>
                <h2>Add user</h2>
                <form className="row" onSubmit={create}>
                    <div><label>Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
                    <div><label>Email</label><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
                    <div><label>Role</label>
                        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                            <option value="user">user</option><option value="admin">admin</option>
                        </select>
                    </div>
                    <div><label>Password <small>(optional)</small></label><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="card-only if blank" /></div>
                    <div style={{ flex: '0 0 auto' }}><button className="btn primary" disabled={busy}>Add</button></div>
                </form>
            </div>

            <div className="panel">
                <table>
                    <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Cards</th><th>Groups</th><th></th></tr></thead>
                    <tbody>
                        {users.map((u) => (
                            <tr key={u.id}>
                                <td><Link to={`/users/${u.id}`}>{u.name}</Link></td>
                                <td className="muted">{u.email}</td>
                                <td>{u.role === 'admin' ? <span className="badge blue">admin</span> : 'user'}</td>
                                <td>{u.active ? <span className="badge green">active</span> : <span className="badge grey">inactive</span>}</td>
                                <td>{u.credential_count}</td>
                                <td>{u.group_count}</td>
                                <td style={{ textAlign: 'right' }}>
                                    <Link className="btn sm" to={`/users/${u.id}`}>Manage</Link>{' '}
                                    <button className="btn sm danger" onClick={() => remove(u)}>Delete</button>
                                </td>
                            </tr>
                        ))}
                        {users.length === 0 && <tr><td colSpan={7} className="muted">No users yet.</td></tr>}
                    </tbody>
                </table>
            </div>
        </>
    );
}
