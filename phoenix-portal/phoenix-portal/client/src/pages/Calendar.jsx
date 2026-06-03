import { useState, useEffect } from 'react';
import api from '../api/client';
import Layout from '../components/Layout';
import './Calendar.css';

const DAY_LABELS  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
];

/* ── Helpers ──────────────────────────────────────────────────────────── */
function eventStart(e) {
    const raw = e.start?.dateTime || e.start?.date;
    return raw ? new Date(raw) : null;
}

function eventEnd(e) {
    const raw = e.end?.dateTime || e.end?.date;
    return raw ? new Date(raw) : null;
}

function formatTime(e) {
    if (e.start?.date) return 'All day';
    const s = new Date(e.start.dateTime);
    const en = new Date(e.end.dateTime);
    const fmt = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `${fmt(s)} – ${fmt(en)}`;
}

function dateKey(d) {
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/* ── Event row component ─────────────────────────────────────────────── */
function EventRow({ event, showDate = false }) {
    const [open, setOpen] = useState(false);
    const start = eventStart(event);
    const time  = formatTime(event);

    return (
        <div className="cal-event-row" onClick={() => setOpen(x => !x)}>
            <div className="cal-event-bar" />
            <div className="cal-event-content">
                <div className="cal-event-top">
                    <span className="cal-event-title">{event.summary || '(No title)'}</span>
                    <span className="cal-event-time">{time}</span>
                </div>
                {showDate && start && (
                    <div className="cal-event-meta">
                        {start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                )}
                {open && (
                    <div className="cal-event-detail">
                        {event.location    && <div className="cal-event-loc">📍 {event.location}</div>}
                        {event.description && <div className="cal-event-desc">{event.description}</div>}
                        {event.htmlLink    && (
                            <a className="cal-event-link" href={event.htmlLink} target="_blank" rel="noopener noreferrer">
                                Open in Google Calendar ↗
                            </a>
                        )}
                        {!event.location && !event.description && (
                            <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>No additional details.</span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

/* ── Setup guide shown when credentials are missing ─────────────────── */
function SetupGuide() {
    return (
        <div className="cal-setup">
            <div className="cal-setup-title">Google Calendar Setup Required</div>
            <p className="cal-setup-text">
                Add two values to the server <code>.env</code> file, then restart PM2.
            </p>
            <ol className="cal-setup-steps">
                <li>Go to <strong>console.cloud.google.com</strong> → select or create a project.</li>
                <li>Enable the <strong>Google Calendar API</strong> (APIs &amp; Services → Library).</li>
                <li>Create an <strong>API Key</strong> (APIs &amp; Services → Credentials). Optionally restrict it to the Calendar API.</li>
                <li>Open <strong>Google Calendar</strong> → Settings (gear) → click your calendar → <em>Integrate calendar</em>. Copy the <strong>Calendar ID</strong>.</li>
                <li>In Calendar Settings → <em>Access permissions</em>, tick <strong>"Make available to public"</strong> (or share it with specific people).</li>
                <li>
                    Add to <code>server/.env</code>:
                    <pre className="cal-setup-pre">{`GOOGLE_CALENDAR_ID=your-calendar-id@gmail.com\nGOOGLE_API_KEY=AIza...`}</pre>
                </li>
                <li>Run <code>pm2 restart phoenix-portal</code> on the server.</li>
            </ol>
        </div>
    );
}

/* ── Main Calendar page ──────────────────────────────────────────────── */
export default function Calendar() {
    const today   = new Date();
    const [year,  setYear]    = useState(today.getFullYear());
    const [month, setMonth]   = useState(today.getMonth());
    const [events,   setEvents]   = useState([]);
    const [loading,  setLoading]  = useState(true);
    const [error,    setError]    = useState('');
    const [unconfigured, setUnconfigured] = useState(false);
    const [view,     setView]     = useState('month');  /* 'month' | 'list' | 'embed' */
    const [selected, setSelected] = useState(null);     /* Date object */

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError('');
        api.get('/calendar/events', { params: { year, month } })
            .then(r => {
                if (!cancelled) setEvents(Array.isArray(r.data) ? r.data : []);
            })
            .catch(e => {
                if (cancelled) return;
                const data = e.response?.data;
                if (data?.unconfigured) { setUnconfigured(true); setEvents([]); }
                else setError(data?.error || 'Failed to load calendar.');
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [year, month]);

    /* Navigation */
    const prevMonth = () => month === 0  ? (setMonth(11), setYear(y => y - 1)) : setMonth(m => m - 1);
    const nextMonth = () => month === 11 ? (setMonth(0),  setYear(y => y + 1)) : setMonth(m => m + 1);
    const goToday   = () => { setYear(today.getFullYear()); setMonth(today.getMonth()); setSelected(today); };

    /* Build grid */
    const firstDow    = new Date(year, month, 1).getDay();  /* 0=Sun */
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    /* Events by day-key for the grid */
    const byDay = {};
    events.forEach(e => {
        const s = eventStart(e);
        if (!s) return;
        const k = dateKey(s);
        (byDay[k] = byDay[k] || []).push(e);
    });

    /* Upcoming events for list view */
    const upcoming = [...events]
        .filter(e => { const s = eventStart(e); return s && s >= today; })
        .sort((a, b) => eventStart(a) - eventStart(b))
        .slice(0, 30);

    const selectedKey    = selected ? dateKey(selected) : null;
    const selectedEvents = selectedKey ? (byDay[selectedKey] || []) : [];

    return (
        <Layout>
            <div className="page-header">
                <h1 className="page-title">Calendar</h1>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className={`alarm-tab ${view === 'month' ? 'active' : ''}`} onClick={() => setView('month')}>Month</button>
                    <button className={`alarm-tab ${view === 'list'  ? 'active' : ''}`} onClick={() => setView('list')}>Upcoming</button>
                    <button className={`alarm-tab ${view === 'embed' ? 'active' : ''}`} onClick={() => setView('embed')}>Google View</button>
                </div>
            </div>

            {/* Google embed never needs an API key — always available */}
            {view === 'embed' && (
                <div className="cal-embed-wrap">
                    <iframe
                        src="https://calendar.google.com/calendar/embed?src=phxcalender%40gmail.com&ctz=America%2FPhoenix"
                        className="cal-embed-frame"
                        frameBorder="0"
                        scrolling="no"
                        title="Phoenix SecTech Calendar"
                    />
                </div>
            )}

            {unconfigured && view !== 'embed' && <SetupGuide />}

            {!unconfigured && view !== 'embed' && (
                <>
                    {/* Month navigation bar */}
                    <div className="cal-nav">
                        <button className="btn btn-ghost cal-nav-arrow" onClick={prevMonth}>‹</button>
                        <span className="cal-nav-label">{MONTH_NAMES[month]} {year}</span>
                        <button className="btn btn-ghost cal-nav-arrow" onClick={nextMonth}>›</button>
                        <button className="btn btn-ghost cal-today-btn" onClick={goToday}>Today</button>
                    </div>

                    {error && <div className="ai-error" style={{ marginBottom: 16 }}>{error}</div>}

                    {loading ? (
                        <div className="cal-loading">Loading…</div>
                    ) : view === 'month' ? (
                        <>
                            {/* ── Month grid ─────────────────────────────── */}
                            <div className="cal-grid">
                                {DAY_LABELS.map(d => (
                                    <div key={d} className="cal-col-header">{d}</div>
                                ))}

                                {/* Leading empty cells */}
                                {Array.from({ length: firstDow }).map((_, i) => (
                                    <div key={`pad-${i}`} className="cal-cell cal-cell-empty" />
                                ))}

                                {/* Day cells */}
                                {Array.from({ length: daysInMonth }).map((_, i) => {
                                    const day  = i + 1;
                                    const date = new Date(year, month, day);
                                    const key  = dateKey(date);
                                    const isToday    = date.toDateString() === today.toDateString();
                                    const isSel      = selectedKey === key;
                                    const dayEvents  = byDay[key] || [];

                                    return (
                                        <div
                                            key={day}
                                            className={[
                                                'cal-cell',
                                                isToday ? 'cal-cell-today'    : '',
                                                isSel   ? 'cal-cell-selected' : '',
                                            ].join(' ')}
                                            onClick={() => setSelected(isSel ? null : date)}
                                        >
                                            <span className="cal-day-num">{day}</span>
                                            {dayEvents.length > 0 && (
                                                <div className="cal-dots">
                                                    {dayEvents.slice(0, 3).map((_, di) => (
                                                        <span key={di} className="cal-dot" />
                                                    ))}
                                                    {dayEvents.length > 3 && (
                                                        <span className="cal-dot-extra">+{dayEvents.length - 3}</span>
                                                    )}
                                                </div>
                                            )}
                                            {/* Show event titles inline on larger cells */}
                                            <div className="cal-cell-events">
                                                {dayEvents.slice(0, 2).map(e => (
                                                    <div key={e.id} className="cal-cell-event-pill">
                                                        {e.summary || '(No title)'}
                                                    </div>
                                                ))}
                                                {dayEvents.length > 2 && (
                                                    <div className="cal-cell-event-more">+{dayEvents.length - 2} more</div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Selected day detail panel */}
                            {selected && (
                                <div className="cal-day-panel">
                                    <div className="cal-day-panel-title">
                                        {selected.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                                        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => setSelected(null)}>✕</button>
                                    </div>
                                    {selectedEvents.length === 0 ? (
                                        <div className="cal-empty-day">No events scheduled.</div>
                                    ) : (
                                        selectedEvents.map(e => <EventRow key={e.id} event={e} />)
                                    )}
                                </div>
                            )}
                        </>
                    ) : (
                        /* ── Upcoming list ─────────────────────────────── */
                        <div className="cal-list">
                            {upcoming.length === 0 ? (
                                <div className="cal-loading">No upcoming events this month.</div>
                            ) : (
                                upcoming.map(e => <EventRow key={e.id} event={e} showDate />)
                            )}
                        </div>
                    )}
                </>
            )}
        </Layout>
    );
}
