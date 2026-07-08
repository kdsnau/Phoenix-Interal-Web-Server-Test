import { useState, useEffect, useMemo } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import Layout from '../components/Layout';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = n => String(n).padStart(2, '0');
const keyOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayKey = () => { const t = new Date(); return keyOf(t.getFullYear(), t.getMonth(), t.getDate()); };

const TICKET_CLR = {
    open: 'var(--yellow,#d9a441)', in_progress: 'var(--accent,#4a9eff)',
    resolved: 'var(--green,#3fb950)', closed: 'var(--text-dim,#8a8a8a)', return_necessary: 'var(--red,#f85149)',
};

/* 6-week grid (Sun-first) covering the given month, with leading/trailing days. */
function monthGrid(year, month) {
    const first = new Date(year, month, 1);
    const cur = new Date(first);
    cur.setDate(1 - first.getDay());
    const weeks = [];
    for (let w = 0; w < 6; w++) {
        const row = [];
        for (let d = 0; d < 7; d++) {
            row.push({ key: keyOf(cur.getFullYear(), cur.getMonth(), cur.getDate()), day: cur.getDate(), inMonth: cur.getMonth() === month });
            cur.setDate(cur.getDate() + 1);
        }
        weeks.push(row);
    }
    return { weeks, startKey: weeks[0][0].key, endKey: weeks[5][6].key };
}

const ticketKey = t => { if (!t.event_start) return null; const d = new Date(t.event_start); return keyOf(d.getFullYear(), d.getMonth(), d.getDate()); };
const fmtTime = ts => ts ? new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
const prettyDate = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); };

export default function TeamCalendar() {
    const { user } = useAuth();
    const now = new Date();
    const [cursor, setCursor]   = useState({ year: now.getFullYear(), month: now.getMonth() });
    const [tickets, setTickets] = useState([]);
    const [timeOff, setTimeOff] = useState([]);
    const [notes, setNotes]     = useState([]);
    const [dayKey, setDayKey]   = useState(null);      // open day modal
    const [ticket, setTicket]   = useState(null);      // open ticket modal

    const { weeks, startKey, endKey } = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);

    function reloadSchedule() {
        api.get('/schedule/time-off', { params: { start: startKey, end: endKey } }).then(r => setTimeOff(r.data)).catch(() => setTimeOff([]));
        api.get('/schedule/notes',    { params: { start: startKey, end: endKey } }).then(r => setNotes(r.data)).catch(() => setNotes([]));
    }
    useEffect(() => {
        api.get('/tickets').then(r => setTickets(r.data.filter(t => t.event_start))).catch(() => setTickets([]));
    }, []);
    useEffect(reloadSchedule, [startKey, endKey]);

    const ticketsByDay = useMemo(() => {
        const m = {};
        for (const t of tickets) { const k = ticketKey(t); if (k) (m[k] ||= []).push(t); }
        return m;
    }, [tickets]);
    const notesByDay = useMemo(() => {
        const m = {};
        for (const n of notes) (m[n.note_date] ||= []).push(n);
        return m;
    }, [notes]);
    const offOn = key => timeOff.filter(t => key >= t.start_date && key <= t.end_date);

    function step(delta) {
        setCursor(c => {
            const d = new Date(c.year, c.month + delta, 1);
            return { year: d.getFullYear(), month: d.getMonth() };
        });
    }

    return (
        <Layout>
            <div className="teamcal-page">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
                    <h1 className="page-title">Team Calendar</h1>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button className="btn btn-ghost" onClick={() => step(-1)}>‹</button>
                        <span style={{ minWidth: 170, textAlign: 'center', fontWeight: 600 }}>{MONTHS[cursor.month]} {cursor.year}</span>
                        <button className="btn btn-ghost" onClick={() => step(1)}>›</button>
                        <button className="btn btn-ghost" onClick={() => setCursor({ year: now.getFullYear(), month: now.getMonth() })}>Today</button>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 1, fontSize: 11, color: 'var(--text-dim)', marginBottom: 1 }}>
                    {WEEKDAYS.map(w => <div key={w} style={{ padding: '4px 6px', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.5 }}>{w}</div>)}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gridAutoRows: 'minmax(96px,auto)', gap: 1, background: 'var(--border,#2a2d34)', border: '1px solid var(--border,#2a2d34)' }}>
                    {weeks.flat().map(cell => {
                        const tks  = ticketsByDay[cell.key] || [];
                        const offs = offOn(cell.key);
                        const nts  = notesByDay[cell.key] || [];
                        const isToday = cell.key === todayKey();
                        return (
                            <div key={cell.key}
                                onClick={() => setDayKey(cell.key)}
                                style={{
                                    background: isToday ? 'rgba(74,158,255,0.10)' : 'rgba(255,255,255,0.015)',
                                    opacity: cell.inMonth ? 1 : 0.4, padding: 4, cursor: 'pointer', overflow: 'hidden',
                                    display: 'flex', flexDirection: 'column', gap: 3,
                                }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: 12, fontWeight: isToday ? 700 : 500, color: isToday ? 'var(--accent,#4a9eff)' : 'var(--text-hi)' }}>{cell.day}</span>
                                    {nts.length > 0 && <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>📝 {nts.length}</span>}
                                </div>
                                {offs.map(o => (
                                    <div key={o.id} title={`${o.user_name} — time off${o.status !== 'approved' ? ' (pending)' : ''}`}
                                        style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                            background: o.status === 'approved' ? 'rgba(63,185,80,0.18)' : 'transparent',
                                            border: o.status === 'approved' ? 'none' : '1px dashed var(--text-dim,#888)',
                                            color: o.status === 'approved' ? 'var(--green,#3fb950)' : 'var(--text-dim,#888)' }}>
                                        🏖 {o.user_name}{o.status !== 'approved' ? ' (pending)' : ''}
                                    </div>
                                ))}
                                {tks.map(t => (
                                    <div key={t.id} onClick={e => { e.stopPropagation(); setTicket(t); }}
                                        title={t.title}
                                        style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                            background: 'rgba(255,255,255,0.06)', borderLeft: `3px solid ${TICKET_CLR[t.status] || 'var(--text-dim)'}`, color: 'var(--text-hi)' }}>
                                        {fmtTime(t.event_start)} {t.title}
                                    </div>
                                ))}
                            </div>
                        );
                    })}
                </div>

                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-dim)' }}>
                    Click any day to request time off or post a note · click a ticket to open it · approved time off shows for everyone.
                </div>

                {dayKey && (
                    <DayModal
                        dateKey={dayKey} user={user}
                        tickets={ticketsByDay[dayKey] || []}
                        offs={offOn(dayKey)}
                        notes={notesByDay[dayKey] || []}
                        onClose={() => setDayKey(null)}
                        onChange={reloadSchedule}
                        onOpenTicket={t => setTicket(t)}
                    />
                )}
                {ticket && <TicketModal ticket={ticket} onClose={() => setTicket(null)} />}
            </div>
        </Layout>
    );
}

function DayModal({ dateKey, user, tickets, offs, notes, onClose, onChange, onOpenTicket }) {
    const [body, setBody]   = useState('');
    const [busy, setBusy]   = useState(false);
    const mine = offs.find(o => o.user_id === user.id);

    async function requestOff() {
        setBusy(true);
        try { await api.post('/schedule/time-off', { start_date: dateKey }); onChange(); }
        catch (e) { alert(e.response?.data?.error || 'Failed.'); } finally { setBusy(false); }
    }
    async function cancelOff() {
        setBusy(true);
        try { await api.delete(`/schedule/time-off/${mine.id}`); onChange(); }
        catch (e) { alert(e.response?.data?.error || 'Failed.'); } finally { setBusy(false); }
    }
    async function postNote(e) {
        e.preventDefault();
        if (!body.trim()) return;
        setBusy(true);
        try { await api.post('/schedule/notes', { note_date: dateKey, body }); setBody(''); onChange(); }
        catch (e) { alert(e.response?.data?.error || 'Failed.'); } finally { setBusy(false); }
    }
    async function delNote(id) {
        await api.delete(`/schedule/notes/${id}`).then(onChange).catch(() => {});
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560, width: '100%' }}>
                <div className="modal-title">{prettyDate(dateKey)}</div>

                {/* Time off */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                    {mine
                        ? <>
                            <span className={mine.status === 'approved' ? 'tag-green' : 'tag-yellow'}>Your time off: {mine.status}</span>
                            <button className="btn btn-ghost" disabled={busy} onClick={cancelOff}>Cancel request</button>
                          </>
                        : <button className="btn btn-primary" disabled={busy} onClick={requestOff}>Request time off</button>}
                    {offs.filter(o => o.status === 'approved' && o.user_id !== user.id).map(o =>
                        <span key={o.id} className="tag-green">🏖 {o.user_name}</span>)}
                </div>

                {/* Tickets */}
                {tickets.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                        <div className="alarm-label" style={{ marginBottom: 6, fontWeight: 600 }}>Tickets</div>
                        {tickets.map(t => (
                            <div key={t.id} onClick={() => onOpenTicket(t)}
                                style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 8px', borderRadius: 4, cursor: 'pointer', background: 'rgba(255,255,255,0.03)', marginBottom: 4 }}>
                                <span style={{ width: 8, height: 8, borderRadius: 8, background: TICKET_CLR[t.status] || 'var(--text-dim)', flexShrink: 0 }} />
                                <span style={{ flex: 1, color: 'var(--text-hi)', fontSize: 13 }}>{t.title}</span>
                                <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{fmtTime(t.event_start)}</span>
                            </div>
                        ))}
                    </div>
                )}

                {/* Notes board */}
                <div className="alarm-label" style={{ marginBottom: 6, fontWeight: 600 }}>Notes</div>
                <div style={{ maxHeight: 220, overflowY: 'auto', marginBottom: 8 }}>
                    {notes.length === 0 && <div style={{ color: 'var(--text-dim)', fontSize: 13, padding: '4px 0' }}>No notes for this day yet.</div>}
                    {notes.map(n => (
                        <div key={n.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border,#2a2d34)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                <span style={{ fontSize: 12, color: 'var(--text-hi)', fontWeight: 500 }}>{n.author || 'Unknown'}</span>
                                <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                                    {new Date(n.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                                    {(n.user_id === user.id || user.role === 'admin') &&
                                        <button className="btn btn-ghost" style={{ padding: '0 6px', marginLeft: 6, fontSize: 11 }} onClick={() => delNote(n.id)}>✕</button>}
                                </span>
                            </div>
                            <div style={{ fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{n.body}</div>
                        </div>
                    ))}
                </div>
                <form onSubmit={postNote} style={{ display: 'flex', gap: 8 }}>
                    <input value={body} onChange={e => setBody(e.target.value)} placeholder="Add a note for this day…" style={{ flex: 1 }} />
                    <button className="btn btn-primary" type="submit" disabled={busy || !body.trim()}>Post</button>
                </form>

                <div className="modal-actions"><button className="btn btn-ghost" onClick={onClose}>Close</button></div>
            </div>
        </div>
    );
}

function TicketModal({ ticket: t, onClose }) {
    const row = (label, val) => val ? (
        <div style={{ display: 'flex', gap: 10, padding: '4px 0' }}>
            <span style={{ width: 90, color: 'var(--text-dim)', fontSize: 12, flexShrink: 0 }}>{label}</span>
            <span style={{ fontSize: 13, color: 'var(--text-hi)' }}>{val}</span>
        </div>
    ) : null;
    const sched = t.event_start
        ? `${new Date(t.event_start).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${t.event_end ? ` – ${new Date(t.event_end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}`
        : null;
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480, width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                    <div className="modal-title" style={{ marginBottom: 4 }}>{t.title}</div>
                    <span className={t.status === 'resolved' ? 'tag-green' : t.status === 'closed' ? 'tag-dim' : t.status === 'return_necessary' ? 'tag-red' : 'tag-yellow'}>{t.status}</span>
                </div>
                {row('When', sched)}
                {row('Client', t.client_name)}
                {row('Location', t.event_location)}
                {row('Type', t.ticket_type)}
                {row('POC', t.poc_name || t.poc_phone ? `${t.poc_name || ''}${t.poc_phone ? ` · ${t.poc_phone}` : ''}` : null)}
                {row('Assigned', (t.assignee_names || []).join(', ') || null)}
                {t.description && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border,#2a2d34)', fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{t.description}</div>
                )}
                <div className="modal-actions"><button className="btn btn-ghost" onClick={onClose}>Close</button></div>
            </div>
        </div>
    );
}
