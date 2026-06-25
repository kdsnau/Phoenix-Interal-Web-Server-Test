import { useEffect, useMemo, useState } from 'react';
import { get, post, patch, del } from '../api/client';

// Day bit i = JS getDay() (0=Sun..6=Sat). Display Mon-first for humans.
const DAYS = [
    { label: 'Mon', idx: 1 }, { label: 'Tue', idx: 2 }, { label: 'Wed', idx: 3 },
    { label: 'Thu', idx: 4 }, { label: 'Fri', idx: 5 }, { label: 'Sat', idx: 6 }, { label: 'Sun', idx: 0 },
];
const ALL_MASK = 127;
const maskFromIdxSet = (set) => [...set].reduce((m, i) => m | (1 << i), 0);

function formatDays(mask) {
    if (mask === ALL_MASK || mask == null) return 'every day';
    const on = DAYS.filter((d) => mask & (1 << d.idx)).map((d) => d.label);
    return on.length ? on.join(' ') : 'no days';
}
const hhmm = (t) => (t ? String(t).slice(0, 5) : null);

const blank = {
    name: '', type: 'door_access', scope: 'all', targetId: '', doorId: '',
    effect: 'allow', priority: 0, startTime: '09:00', endTime: '17:00',
};

export default function Rules() {
    const [rules, setRules] = useState([]);
    const [users, setUsers] = useState([]);
    const [groups, setGroups] = useState([]);
    const [doors, setDoors] = useState([]);
    const [days, setDays] = useState(new Set([1, 2, 3, 4, 5]));
    const [form, setForm] = useState(blank);
    const [err, setErr] = useState('');

    const load = () => get('/api/rules').then(setRules).catch((e) => setErr(e.message));
    useEffect(() => {
        load();
        get('/api/users').then(setUsers).catch(() => {});
        get('/api/groups').then(setGroups).catch(() => {});
        get('/api/doors').then(setDoors).catch(() => {});
    }, []);

    const userById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u.name])), [users]);
    const groupById = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g.name])), [groups]);
    const doorById = useMemo(() => Object.fromEntries(doors.map((d) => [d.id, d.name])), [doors]);

    function describe(r) {
        const who = r.scope === 'all' ? 'anyone' : r.scope === 'user' ? `user ${userById[r.target_id] || r.target_id}` : `group ${groupById[r.target_id] || r.target_id}`;
        const where = r.door_id ? `at ${doorById[r.door_id] || `door#${r.door_id}`}` : 'at any door';
        const when = r.type === 'time_window' ? `, ${formatDays(r.days_mask)} ${hhmm(r.start_time)}–${hhmm(r.end_time)}` : '';
        return `${r.effect === 'allow' ? 'Allow' : 'Deny'} ${who} ${where}${when}`;
    }

    function toggleDay(idx) {
        const next = new Set(days);
        next.has(idx) ? next.delete(idx) : next.add(idx);
        setDays(next);
    }

    async function create(e) {
        e.preventDefault(); setErr('');
        try {
            const payload = {
                name: form.name,
                type: form.type,
                scope: form.scope,
                targetId: form.scope === 'all' ? null : Number(form.targetId),
                doorId: form.doorId ? Number(form.doorId) : null,
                effect: form.effect,
                priority: Number(form.priority) || 0,
            };
            if (form.type === 'time_window') {
                payload.daysMask = maskFromIdxSet(days) || ALL_MASK;
                payload.startTime = form.startTime;
                payload.endTime = form.endTime;
            }
            if (form.scope !== 'all' && !payload.targetId) throw new Error('Pick a target user/group.');
            await post('/api/rules', payload);
            setForm(blank); setDays(new Set([1, 2, 3, 4, 5]));
            load();
        } catch (e) { setErr(e.message); }
    }
    async function toggle(r) { await patch(`/api/rules/${r.id}`, { active: !r.active }); load(); }
    async function remove(r) { if (confirm(`Delete rule "${r.name}"?`)) { await del(`/api/rules/${r.id}`); load(); } }

    const targetOptions = form.scope === 'user' ? users.map((u) => [u.id, u.name]) : form.scope === 'group' ? groups.map((g) => [g.id, g.name]) : [];

    return (
        <>
            <div className="topbar"><h1>Rules</h1></div>
            {err && <div className="error" style={{ marginBottom: '1rem' }}>{err}</div>}

            <div className="panel" style={{ marginBottom: '1rem' }}>
                <h2>New rule</h2>
                <p className="muted" style={{ marginTop: '-.3rem', fontSize: '.82rem' }}>
                    Default is deny. A <b>door_access</b> rule says who may use a door; a <b>time_window</b> rule
                    restricts when. Deny always overrides allow.
                </p>
                <form onSubmit={create}>
                    <div className="row">
                        <div style={{ flex: 2 }}><label>Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Staff weekday hours" required /></div>
                        <div><label>Type</label>
                            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                                <option value="door_access">door_access (who)</option>
                                <option value="time_window">time_window (when)</option>
                            </select>
                        </div>
                        <div><label>Effect</label>
                            <select value={form.effect} onChange={(e) => setForm({ ...form, effect: e.target.value })}>
                                <option value="allow">allow</option><option value="deny">deny</option>
                            </select>
                        </div>
                        <div><label>Priority</label><input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} /></div>
                    </div>

                    <div className="row" style={{ marginTop: '.5rem' }}>
                        <div><label>Applies to</label>
                            <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value, targetId: '' })}>
                                <option value="all">everyone</option><option value="user">a user</option><option value="group">a group</option>
                            </select>
                        </div>
                        {form.scope !== 'all' && (
                            <div><label>Target</label>
                                <select value={form.targetId} onChange={(e) => setForm({ ...form, targetId: e.target.value })}>
                                    <option value="">— pick —</option>
                                    {targetOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                                </select>
                            </div>
                        )}
                        <div><label>Door</label>
                            <select value={form.doorId} onChange={(e) => setForm({ ...form, doorId: e.target.value })}>
                                <option value="">all doors</option>
                                {doors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                        </div>
                    </div>

                    {form.type === 'time_window' && (
                        <div className="row" style={{ marginTop: '.5rem', alignItems: 'center' }}>
                            <div style={{ flex: 2 }}>
                                <label>Days</label>
                                <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
                                    {DAYS.map((d) => (
                                        <button type="button" key={d.idx}
                                            className={`btn sm ${days.has(d.idx) ? 'primary' : ''}`}
                                            onClick={() => toggleDay(d.idx)}>{d.label}</button>
                                    ))}
                                </div>
                            </div>
                            <div><label>From</label><input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></div>
                            <div><label>To</label><input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></div>
                        </div>
                    )}

                    <button className="btn primary" style={{ marginTop: '1rem' }}>Create rule</button>
                </form>
            </div>

            <div className="panel">
                <table>
                    <thead><tr><th>Name</th><th>Summary</th><th>Effect</th><th>Prio</th><th>Status</th><th></th></tr></thead>
                    <tbody>
                        {rules.map((r) => (
                            <tr key={r.id}>
                                <td>{r.name}</td>
                                <td className="muted">{describe(r)}</td>
                                <td><span className={`badge ${r.effect === 'allow' ? 'green' : 'red'}`}>{r.effect}</span></td>
                                <td>{r.priority}</td>
                                <td>{r.active ? <span className="badge green">on</span> : <span className="badge grey">off</span>}</td>
                                <td style={{ textAlign: 'right' }}>
                                    <button className="btn sm" onClick={() => toggle(r)}>{r.active ? 'Disable' : 'Enable'}</button>{' '}
                                    <button className="btn sm danger" onClick={() => remove(r)}>Delete</button>
                                </td>
                            </tr>
                        ))}
                        {rules.length === 0 && <tr><td colSpan={6} className="muted">No rules yet — without an allow rule, every tap is denied.</td></tr>}
                    </tbody>
                </table>
            </div>
        </>
    );
}
