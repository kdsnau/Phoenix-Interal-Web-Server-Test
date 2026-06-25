import { useEffect, useState } from 'react';
import { get, post, del } from '../api/client';

export default function Groups() {
    const [groups, setGroups] = useState([]);
    const [name, setName] = useState('');
    const [err, setErr] = useState('');

    const load = () => get('/api/groups').then(setGroups).catch((e) => setErr(e.message));
    useEffect(() => { load(); }, []);

    async function create(e) {
        e.preventDefault(); setErr('');
        try { await post('/api/groups', { name }); setName(''); load(); }
        catch (e) { setErr(e.message); }
    }
    async function remove(g) {
        if (!confirm(`Delete group "${g.name}"? Membership and its rules are removed.`)) return;
        await del(`/api/groups/${g.id}`); load();
    }

    return (
        <>
            <div className="topbar"><h1>Groups</h1></div>
            {err && <div className="error" style={{ marginBottom: '1rem' }}>{err}</div>}

            <div className="panel" style={{ marginBottom: '1rem', maxWidth: 520 }}>
                <h2>New group</h2>
                <form className="row" onSubmit={create}>
                    <div><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Night shift" required /></div>
                    <div style={{ flex: '0 0 auto' }}><button className="btn primary">Create</button></div>
                </form>
                <p className="muted" style={{ marginTop: '.5rem', fontSize: '.82rem' }}>
                    Groups let a single rule apply to many people. Assign members on each user's page;
                    target a group from the Rules page.
                </p>
            </div>

            <div className="panel" style={{ maxWidth: 520 }}>
                <table>
                    <thead><tr><th>Group</th><th>Members</th><th></th></tr></thead>
                    <tbody>
                        {groups.map((g) => (
                            <tr key={g.id}>
                                <td>{g.name}</td>
                                <td>{g.member_count}</td>
                                <td style={{ textAlign: 'right' }}><button className="btn sm danger" onClick={() => remove(g)}>Delete</button></td>
                            </tr>
                        ))}
                        {groups.length === 0 && <tr><td colSpan={3} className="muted">No groups yet.</td></tr>}
                    </tbody>
                </table>
            </div>
        </>
    );
}
