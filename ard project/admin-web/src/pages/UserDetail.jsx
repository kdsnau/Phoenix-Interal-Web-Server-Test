import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, get, post, patch } from '../api/client';

export default function UserDetail() {
    const { id } = useParams();
    const [user, setUser] = useState(null);
    const [groups, setGroups] = useState([]);
    const [err, setErr] = useState('');
    const [cardUid, setCardUid] = useState('');
    const [cardLabel, setCardLabel] = useState('');
    const [phoneLabel, setPhoneLabel] = useState('');
    const [secret, setSecret] = useState(null); // one-time phone token_key display

    const load = () => get(`/api/users/${id}`).then(setUser).catch((e) => setErr(e.message));
    useEffect(() => { load(); get('/api/groups').then(setGroups).catch(() => {}); }, [id]);

    async function addCard(e) {
        e.preventDefault(); setErr('');
        try {
            await post('/api/credentials/card', { userId: Number(id), uid: cardUid, label: cardLabel });
            setCardUid(''); setCardLabel(''); load();
        } catch (e) { setErr(e.message); }
    }
    async function issuePhone(e) {
        e.preventDefault(); setErr('');
        try {
            const res = await post('/api/credentials/phone', { userId: Number(id), label: phoneLabel });
            setSecret(res); setPhoneLabel(''); load();
        } catch (e) { setErr(e.message); }
    }
    async function revoke(c) {
        if (!confirm('Revoke this credential? It stops working immediately.')) return;
        await post(`/api/credentials/${c.id}/revoke`); load();
    }
    async function toggleGroup(g, on) {
        const current = new Set(user.groups.map((x) => x.id));
        if (on) current.add(g.id); else current.delete(g.id);
        await api('PUT', `/api/users/${id}/groups`, { groupIds: [...current] });
        load();
    }
    async function toggleActive() {
        await patch(`/api/users/${id}`, { active: !user.active });
        load();
    }

    if (err) return <div className="error">{err}</div>;
    if (!user) return <div>Loading…</div>;
    const memberOf = new Set(user.groups.map((g) => g.id));

    return (
        <>
            <div className="topbar">
                <h1><Link to="/users" className="muted">Users</Link> / {user.name}</h1>
                <button className="btn sm" onClick={toggleActive}>{user.active ? 'Deactivate' : 'Activate'}</button>
            </div>
            {err && <div className="error">{err}</div>}

            <div className="grid cols-2">
                <div className="panel">
                    <h2>Credentials</h2>
                    <table>
                        <thead><tr><th>Type</th><th>ID</th><th>Label</th><th>Status</th><th></th></tr></thead>
                        <tbody>
                            {user.credentials.map((c) => (
                                <tr key={c.id}>
                                    <td>{c.type === 'phone' ? <span className="badge blue">phone</span> : <span className="badge">card</span>}</td>
                                    <td className="code muted">{c.uid || c.public_id}</td>
                                    <td>{c.label || '—'}</td>
                                    <td>{c.revoked_at ? <span className="badge red">revoked</span> : c.active ? <span className="badge green">active</span> : <span className="badge grey">off</span>}</td>
                                    <td style={{ textAlign: 'right' }}>{!c.revoked_at && <button className="btn sm danger" onClick={() => revoke(c)}>Revoke</button>}</td>
                                </tr>
                            ))}
                            {user.credentials.length === 0 && <tr><td colSpan={5} className="muted">No credentials.</td></tr>}
                        </tbody>
                    </table>

                    {secret && (
                        <div className="notice" style={{ marginTop: '.75rem' }}>
                            Phone provisioned. Store now (shown once):<br />
                            public_id: {secret.public_id}<br />
                            token_key: {secret.token_key}
                        </div>
                    )}

                    <form className="row" onSubmit={addCard} style={{ marginTop: '1rem' }}>
                        <div><label>Card UID (hex)</label><input value={cardUid} onChange={(e) => setCardUid(e.target.value)} placeholder="04A1B2C3D4" required /></div>
                        <div><label>Label</label><input value={cardLabel} onChange={(e) => setCardLabel(e.target.value)} placeholder="Blue fob" /></div>
                        <div style={{ flex: '0 0 auto' }}><button className="btn">Assign card</button></div>
                    </form>
                    <form className="row" onSubmit={issuePhone} style={{ marginTop: '.5rem' }}>
                        <div><label>Phone label</label><input value={phoneLabel} onChange={(e) => setPhoneLabel(e.target.value)} placeholder="Dana's Pixel" /></div>
                        <div style={{ flex: '0 0 auto' }}><button className="btn">Issue phone</button></div>
                    </form>
                </div>

                <div className="panel">
                    <h2>Groups</h2>
                    {groups.length === 0 && <span className="muted">No groups yet — create some on the Groups page.</span>}
                    {groups.map((g) => (
                        <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', color: 'var(--text)', margin: '.3rem 0' }}>
                            <input type="checkbox" style={{ width: 'auto' }} checked={memberOf.has(g.id)}
                                   onChange={(e) => toggleGroup(g, e.target.checked)} />
                            {g.name}
                        </label>
                    ))}
                </div>
            </div>
        </>
    );
}
