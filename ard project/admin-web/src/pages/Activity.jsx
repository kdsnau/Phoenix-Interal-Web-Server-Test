import { useEffect, useState } from 'react';
import { get } from '../api/client';

function fmt(ts) {
    return new Date(ts).toLocaleString();
}

export default function Activity() {
    const [summary, setSummary] = useState(null);
    const [events, setEvents] = useState([]);
    const [err, setErr] = useState('');

    async function load() {
        try {
            const [s, e] = await Promise.all([get('/api/scans/summary'), get('/api/scans?limit=25')]);
            setSummary(s);
            setEvents(e);
        } catch (e) { setErr(e.message); }
    }
    useEffect(() => {
        load();
        const t = setInterval(load, 5000); // live-ish refresh
        return () => clearInterval(t);
    }, []);

    if (err) return <div className="error">{err}</div>;
    if (!summary) return <div>Loading…</div>;

    const maxDoor = Math.max(1, ...summary.perDoor.map((d) => Number(d.scans)));
    const maxDay = Math.max(1, ...summary.daily.map((d) => Number(d.granted) + Number(d.denied)));

    return (
        <>
            <div className="topbar">
                <h1>Activity</h1>
                <span className="muted">auto-refreshing every 5s</span>
            </div>

            <div className="grid cols-4">
                <div className="panel stat"><div className="label">Granted</div><div className="big" style={{ color: 'var(--green)' }}>{summary.totals.granted}</div></div>
                <div className="panel stat"><div className="label">Denied</div><div className="big" style={{ color: 'var(--red)' }}>{summary.totals.denied}</div></div>
                <div className="panel stat"><div className="label">Last 24h</div><div className="big">{summary.totals.last_24h}</div></div>
                <div className="panel stat"><div className="label">Doors</div><div className="big">{summary.perDoor.length}</div></div>
            </div>

            <div className="grid cols-2" style={{ marginTop: '1rem' }}>
                <div className="panel">
                    <h2>Scans by door</h2>
                    {summary.perDoor.length === 0 && <span className="muted">No doors yet.</span>}
                    {summary.perDoor.map((d) => (
                        <div key={d.id} style={{ margin: '.6rem 0' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>{d.name}</span><span className="muted">{d.scans}</span>
                            </div>
                            <div className="bar"><span style={{ width: `${(Number(d.scans) / maxDoor) * 100}%` }} /></div>
                        </div>
                    ))}
                </div>

                <div className="panel">
                    <h2>Last 14 days</h2>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120, marginTop: '.5rem' }}>
                        {summary.daily.length === 0 && <span className="muted">No activity yet.</span>}
                        {summary.daily.map((d) => {
                            const g = Number(d.granted), de = Number(d.denied);
                            return (
                                <div key={d.day} title={`${new Date(d.day).toLocaleDateString()}: ${g} granted / ${de} denied`}
                                     style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                                    <div style={{ height: `${(de / maxDay) * 100}%`, background: 'var(--red)' }} />
                                    <div style={{ height: `${(g / maxDay) * 100}%`, background: 'var(--green)' }} />
                                </div>
                            );
                        })}
                    </div>
                    <div className="muted" style={{ marginTop: '.4rem', fontSize: '.78rem' }}>
                        <span className="badge green">granted</span> <span className="badge red">denied</span>
                    </div>
                </div>
            </div>

            <div className="panel" style={{ marginTop: '1rem' }}>
                <h2>Recent scans</h2>
                <table>
                    <thead><tr><th>Time</th><th>Decision</th><th>Reason</th><th>Door</th><th>User</th><th>Mode</th></tr></thead>
                    <tbody>
                        {events.map((e) => (
                            <tr key={e.id}>
                                <td className="muted">{fmt(e.scanned_at)}</td>
                                <td><span className={`badge ${e.decision === 'granted' ? 'green' : 'red'}`}>{e.decision}</span></td>
                                <td className="code muted">{e.reason}</td>
                                <td>{e.door_name || '—'}</td>
                                <td>{e.user_name || <span className="muted">{e.raw_uid || 'unknown'}</span>}</td>
                                <td>{e.was_offline ? <span className="badge grey">offline</span> : <span className="badge blue">online</span>}</td>
                            </tr>
                        ))}
                        {events.length === 0 && <tr><td colSpan={6} className="muted">No scans yet — tap a card to see it here.</td></tr>}
                    </tbody>
                </table>
            </div>
        </>
    );
}
