import { useEffect, useState } from 'react';
import { get, post, del } from '../api/client';

export default function Doors() {
    const [doors, setDoors] = useState([]);
    const [err, setErr] = useState('');
    const [form, setForm] = useState({ name: '', location: '', relayUnlockMs: 5000, failPolicy: 'closed' });
    const [reveal, setReveal] = useState(null); // one-time reader_key after create/rotate

    const load = () => get('/api/doors').then(setDoors).catch((e) => setErr(e.message));
    useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, []);

    async function create(e) {
        e.preventDefault(); setErr('');
        try {
            const res = await post('/api/doors', { ...form, relayUnlockMs: Number(form.relayUnlockMs) });
            setReveal({ name: res.name, key: res.reader_key, id: res.id });
            setForm({ name: '', location: '', relayUnlockMs: 5000, failPolicy: 'closed' });
            load();
        } catch (e) { setErr(e.message); }
    }
    async function rotate(d) {
        if (!confirm(`Rotate ${d.name}'s reader key? The door firmware must be reflashed with the new key.`)) return;
        const res = await post(`/api/doors/${d.id}/rotate-key`);
        setReveal({ name: res.name, key: res.reader_key, id: res.id });
    }
    async function remove(d) {
        if (!confirm(`Delete ${d.name}?`)) return;
        await del(`/api/doors/${d.id}`); load();
    }

    return (
        <>
            <div className="topbar"><h1>Doors &amp; Readers</h1></div>
            {err && <div className="error" style={{ marginBottom: '1rem' }}>{err}</div>}

            {reveal && (
                <div className="notice" style={{ marginBottom: '1rem' }}>
                    <b>{reveal.name}</b> — door id <b>{reveal.id}</b>. Flash this reader_key into the firmware now (shown once):<br />
                    {reveal.key}
                    <div style={{ marginTop: '.4rem' }}><button className="btn sm" onClick={() => setReveal(null)}>Dismiss</button></div>
                </div>
            )}

            <div className="panel" style={{ marginBottom: '1rem' }}>
                <h2>Register a door</h2>
                <form className="row" onSubmit={create}>
                    <div><label>Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
                    <div><label>Location</label><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
                    <div><label>Unlock ms</label><input type="number" value={form.relayUnlockMs} onChange={(e) => setForm({ ...form, relayUnlockMs: e.target.value })} /></div>
                    <div><label>Fail policy</label>
                        <select value={form.failPolicy} onChange={(e) => setForm({ ...form, failPolicy: e.target.value })}>
                            <option value="closed">closed (deny if backend unreachable)</option>
                            <option value="open">open (allow if unreachable)</option>
                        </select>
                    </div>
                    <div style={{ flex: '0 0 auto' }}><button className="btn primary">Register</button></div>
                </form>
            </div>

            <div className="panel">
                <table>
                    <thead><tr><th>Status</th><th>Name</th><th>Location</th><th>Unlock</th><th>Fail</th><th>Last seen</th><th></th></tr></thead>
                    <tbody>
                        {doors.map((d) => (
                            <tr key={d.id}>
                                <td><span className={`dot-online ${d.online ? 'on' : 'off'}`} /> {d.online ? 'online' : 'offline'}</td>
                                <td>{d.name} <span className="muted code">#{d.id}</span></td>
                                <td className="muted">{d.location || '—'}</td>
                                <td>{d.relay_unlock_ms} ms</td>
                                <td>{d.fail_policy}</td>
                                <td className="muted">{d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : 'never'}</td>
                                <td style={{ textAlign: 'right' }}>
                                    <button className="btn sm" onClick={() => rotate(d)}>Rotate key</button>{' '}
                                    <button className="btn sm danger" onClick={() => remove(d)}>Delete</button>
                                </td>
                            </tr>
                        ))}
                        {doors.length === 0 && <tr><td colSpan={7} className="muted">No doors yet.</td></tr>}
                    </tbody>
                </table>
            </div>
        </>
    );
}
