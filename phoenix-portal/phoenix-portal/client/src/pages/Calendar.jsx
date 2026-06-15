import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import Layout from '../components/Layout';
import PageHelp from '../components/PageHelp';
import './Calendar.css';

const STATUS_TAG = {
    open:        'tag-yellow',
    in_progress: 'tag-blue',
    resolved:    'tag-green',
    closed:      'tag-dim',
};

function formatEventDate(ts) {
    if (!ts) return null;
    return new Date(ts).toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
    });
}

function daysUntil(ts) {
    if (!ts) return null;
    const diff = Math.ceil((new Date(ts) - new Date()) / 86400000);
    if (diff < 0)  return { label: 'Past',       cls: 'tag-dim'    };
    if (diff === 0) return { label: 'Today',      cls: 'tag-red'    };
    if (diff === 1) return { label: 'Tomorrow',   cls: 'tag-yellow' };
    return           { label: `${diff}d away`,    cls: 'tag-blue'   };
}

export default function Calendar() {
    const { user }                          = useAuth();
    const [tab,          setTab]            = useState('tickets');
    const [tickets,      setTickets]        = useState([]);
    const [loading,      setLoading]        = useState(true);
    const [syncing,      setSyncing]        = useState(false);
    const [syncResult,   setSyncResult]     = useState(null);
    const [syncError,    setSyncError]      = useState('');
    const [statusFilter, setStatusFilter]   = useState('active'); /* active | all */
    const [cals,         setCals]           = useState(null);     /* diagnostic list */
    const [calsError,    setCalsError]      = useState('');
    const [icsUrl,       setIcsUrl]         = useState('');
    const [icsMsg,       setIcsMsg]         = useState('');
    const [auth,         setAuth]           = useState(null);    /* { ok, error } */
    const [refreshTok,   setRefreshTok]     = useState('');
    const [tokMsg,       setTokMsg]         = useState('');

    useEffect(() => {
        loadTickets();
        if (user.role === 'admin') {
            api.get('/calendar/ics-url').then(r => setIcsUrl(r.data.url || '')).catch(() => {});
            api.get('/calendar/auth-status').then(r => setAuth(r.data)).catch(() => setAuth({ ok: false, error: 'Unknown' }));
        }
    }, []);

    const saveRefreshToken = async () => {
        setTokMsg('Testing…');
        try {
            const { data } = await api.put('/calendar/refresh-token', { token: refreshTok });
            setAuth(data);
            setRefreshTok('');
            setTokMsg(data.ok ? 'Connected ✓' : (data.error || 'Rejected.'));
        } catch (e) {
            setTokMsg(e.response?.data?.error || 'Could not save.');
        }
    };

    const saveIcsUrl = async () => {
        setIcsMsg('');
        try {
            const { data } = await api.put('/calendar/ics-url', { url: icsUrl });
            setIcsUrl(data.url || '');
            setIcsMsg('Saved ✓');
            setTimeout(() => setIcsMsg(''), 2500);
        } catch (e) {
            setIcsMsg(e.response?.data?.error || 'Could not save.');
        }
    };

    const loadTickets = async () => {
        setLoading(true);
        try {
            const { data } = await api.get('/tickets');
            /* Show any ticket that has a scheduled date, regardless of source */
            setTickets(Array.isArray(data) ? data.filter(t => t.event_start) : []);
        } catch {
            setTickets([]);
        } finally {
            setLoading(false);
        }
    };

    const sync = async (source) => {
        setSyncing(true);
        setSyncResult(null);
        setSyncError('');
        try {
            const { data } = await api.post('/calendar/sync', source ? { source } : {});
            setSyncResult(data);
            await loadTickets();
        } catch (e) {
            const msg = e.response?.data?.error || 'Sync failed.';
            setSyncError(msg);
        } finally {
            setSyncing(false);
        }
    };

    const connectGoogle = async () => {
        setCalsError('');
        try {
            const { data } = await api.get('/calendar/oauth/url');
            window.location.href = data.url;   /* off to Google's consent screen */
        } catch (e) {
            setCalsError(e.response?.data?.error || 'Could not start the Google connection.');
        }
    };

    const listCals = async () => {
        setCals(null);
        setCalsError('');
        try {
            const { data } = await api.get('/calendar/list');
            setCals(data);
        } catch (e) {
            setCalsError(e.response?.data?.error || 'Could not list calendars.');
        }
    };

    const updateStatus = async (id, status) => {
        try {
            const { data } = await api.patch(`/tickets/${id}`, { status });
            setTickets(prev => prev.map(t => t.id === id ? data : t));
        } catch (e) { console.error(e); }
    };

    const visible = tickets.filter(t =>
        statusFilter === 'all' || !['resolved', 'closed'].includes(t.status)
    ).sort((a, b) => {
        /* Sort by event_start ascending; nulls last */
        if (!a.event_start) return 1;
        if (!b.event_start) return -1;
        return new Date(a.event_start) - new Date(b.event_start);
    });

    return (
        <Layout>
            <div className="page-header">
                <h1 className="page-title">Calendar<PageHelp id="calendar" /></h1>
                {tab === 'tickets' && (
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button
                            className="btn btn-ghost"
                            onClick={() => sync('official')}
                            disabled={syncing}
                            title="Import events from the Official Calendar as tickets"
                        >
                            {syncing ? '…' : '⤓ Pull from Official Calendar'}
                        </button>
                        <button
                            className="btn btn-primary"
                            onClick={() => sync()}
                            disabled={syncing}
                        >
                            {syncing ? 'Syncing…' : '↻ Sync from Google'}
                        </button>
                        {user.role === 'admin' && (
                            <button className="btn btn-ghost" onClick={connectGoogle} title="Authorize a Google account so the portal can read private calendars and write tickets">
                                🔗 Connect Google
                            </button>
                        )}
                        {user.role === 'admin' && (
                            <button className="btn btn-ghost" onClick={listCals} title="Show which calendars the portal's Google account can read">
                                ⚙ Diagnose access
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Tabs */}
            <div className="alarm-service-tabs" style={{ marginBottom: 20 }}>
                <button className={`alarm-tab ${tab === 'tickets' ? 'active' : ''}`} onClick={() => setTab('tickets')}>
                    Scheduled Tickets
                    {tickets.length > 0 && <span className="alarm-tab-count">{tickets.filter(t => !['resolved','closed'].includes(t.status)).length}</span>}
                </button>
                <button className={`alarm-tab ${tab === 'ticket-cal' ? 'active' : ''}`} onClick={() => setTab('ticket-cal')}>
                    Ticket Calendar
                </button>
                <button className={`alarm-tab ${tab === 'embed' ? 'active' : ''}`} onClick={() => setTab('embed')}>
                    Official Calendar
                </button>
            </div>

            {/* ── Sync status bar ─────────────────────────────────────── */}
            {syncResult && (
                <div className="cal-sync-banner">
                    ✓ {syncResult.source === 'official' ? 'Official Calendar' : 'Google'} sync complete — <strong>{syncResult.created}</strong> new ticket{syncResult.created !== 1 ? 's' : ''}, <strong>{syncResult.updated}</strong> updated.
                </div>
            )}
            {syncError && (
                <div className="ai-error" style={{ marginBottom: 16 }}>{syncError}</div>
            )}

            {/* ── Admin: Google connection + Official iCal source ─────── */}
            {tab === 'tickets' && user.role === 'admin' && (
                <div style={{ border: '1px solid var(--border)', borderRadius: 4, padding: 12, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {/* Google write/token connection */}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>Google calendar writes:</span>
                        {auth && (
                            <span className={`tag ${auth.ok ? 'tag-green' : 'tag-red'}`}>{auth.ok ? 'Connected' : 'Not connected'}</span>
                        )}
                        {auth && !auth.ok && auth.error && (
                            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{auth.error}</span>
                        )}
                    </div>
                    {auth && !auth.ok && (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <input
                                value={refreshTok}
                                onChange={e => setRefreshTok(e.target.value)}
                                placeholder="Paste a fresh OAuth refresh token…"
                                style={{ flex: 1, minWidth: 260, fontSize: 12, fontFamily: 'var(--font-mono)' }}
                            />
                            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={saveRefreshToken} disabled={!refreshTok.trim()}>Save &amp; test</button>
                            {tokMsg && <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{tokMsg}</span>}
                        </div>
                    )}
                    {/* Official calendar iCal feed */}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>Official iCal URL:</span>
                        <input
                            value={icsUrl}
                            onChange={e => setIcsUrl(e.target.value)}
                            placeholder="https://calendar.google.com/calendar/ical/…/private-…/basic.ics"
                            style={{ flex: 1, minWidth: 260, fontSize: 12, fontFamily: 'var(--font-mono)' }}
                        />
                        <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={saveIcsUrl}>Save</button>
                        {icsMsg && <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{icsMsg}</span>}
                    </div>
                </div>
            )}

            {/* ── Calendar-access diagnostic ──────────────────────────── */}
            {calsError && <div className="ai-error" style={{ marginBottom: 16 }}>{calsError}</div>}
            {cals && (
                <div className="table-card" style={{ marginBottom: 16 }}>
                    <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-dim)', borderBottom: '1px solid var(--border)' }}>
                        Calendars the portal's Google account can read ({cals.length}). To pull from a calendar it must appear
                        here with access <strong>reader / writer / owner</strong> (not "freeBusyReader").
                    </div>
                    <table className="data-table">
                        <thead><tr><th>Calendar</th><th>ID</th><th>Access</th></tr></thead>
                        <tbody>
                            {cals.length === 0 && <tr><td colSpan={3} style={{ color: 'var(--text-dim)' }}>None — the account can't see any calendars.</td></tr>}
                            {cals.map(c => (
                                <tr key={c.id}>
                                    <td>{c.summary}{c.primary ? ' (primary)' : ''}</td>
                                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, wordBreak: 'break-all' }}>{c.id}</td>
                                    <td><span className={`tag ${['owner','writer','reader'].includes(c.accessRole) ? 'tag-green' : 'tag-yellow'}`}>{c.accessRole}</span></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* ── Scheduled Tickets tab ───────────────────────────────── */}
            {tab === 'tickets' && (
                <>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
                        <button className={`btn btn-ghost ${statusFilter === 'active' ? 'btn-ghost-active' : ''}`} style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => setStatusFilter('active')}>Active only</button>
                        <button className={`btn btn-ghost ${statusFilter === 'all'    ? 'btn-ghost-active' : ''}`} style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => setStatusFilter('all')}>All</button>
                        <span style={{ fontSize: 12, color: 'var(--text-dim)', marginLeft: 8 }}>{visible.length} event{visible.length !== 1 ? 's' : ''}</span>
                    </div>

                    {loading ? (
                        <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>Loading…</p>
                    ) : visible.length === 0 ? (
                        <div className="cal-empty">
                            <div className="cal-empty-icon">📅</div>
                            <div>No scheduled events yet.</div>
                            <div style={{ fontSize: 12, marginTop: 6 }}>Press <strong>↻ Sync from Google</strong> to import your calendar events as tickets.</div>
                        </div>
                    ) : (
                        <div className="table-card">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Event</th>
                                        <th>Scheduled</th>
                                        <th>Location</th>
                                        <th>Status</th>
                                        {user.role === 'admin' && <th>Actions</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {visible.map(t => {
                                        const due = daysUntil(t.event_start);
                                        return (
                                            <tr key={t.id}>
                                                <td>
                                                    <div style={{ fontWeight: 500, color: 'var(--text-hi)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                                        <span>📅</span>{t.title}
                                                    </div>
                                                    {t.description && (
                                                        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                                                            {t.description.split('\n').slice(-1)[0]?.slice(0, 80)}
                                                        </div>
                                                    )}
                                                </td>
                                                <td>
                                                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.7 }}>
                                                        <div style={{ color: 'var(--accent)' }}>
                                                            ▶ {formatEventDate(t.event_start) || '—'}
                                                        </div>
                                                        {t.event_end && (
                                                            <div style={{ color: 'var(--text-dim)' }}>
                                                                ■ {new Date(t.event_end).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' })}
                                                            </div>
                                                        )}
                                                    </div>
                                                    {due && <span className={`tag ${due.cls}`} style={{ marginTop: 4, display: 'inline-block' }}>{due.label}</span>}
                                                </td>
                                                <td style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                                                    {t.event_location || '—'}
                                                </td>
                                                <td>
                                                    <span className={`tag ${STATUS_TAG[t.status]}`}>{t.status.replace('_', ' ')}</span>
                                                </td>
                                                {user.role === 'admin' && (
                                                    <td>
                                                        <select
                                                            value={t.status}
                                                            onChange={e => updateStatus(t.id, e.target.value)}
                                                            style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
                                                        >
                                                            <option value="open">Open</option>
                                                            <option value="in_progress">In Progress</option>
                                                            <option value="resolved">Resolved</option>
                                                            <option value="closed">Closed</option>
                                                        </select>
                                                    </td>
                                                )}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}

            {/* ── Ticket Calendar tab ─────────────────────────────────── */}
            {tab === 'ticket-cal' && (
                <>
                    <div className="cal-embed-header">
                        <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                            Live view of the calendar tickets are synced to.
                        </span>
                        <a
                            href="https://calendar.google.com/calendar/r"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-primary"
                            style={{ textDecoration: 'none', fontSize: 13 }}
                        >
                            ↗ Open in Google Calendar
                        </a>
                    </div>
                    <div className="cal-embed-wrap">
                        <iframe
                            src="https://calendar.google.com/calendar/embed?src=373788a8166fa961d12c98fa0de8c524aca490728f9bfe4d8161928702ed5dc2%40group.calendar.google.com&ctz=America%2FPhoenix"
                            className="cal-embed-frame"
                            frameBorder="0"
                            scrolling="no"
                            title="Ticket Calendar"
                        />
                    </div>
                </>
            )}

            {/* ── Official Calendar embed tab ──────────────────────────── */}
            {tab === 'embed' && (
                <>
                    <div className="cal-embed-header">
                        <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                            Read-only preview — click events to view details.
                        </span>
                        <a
                            href="https://calendar.google.com/calendar/embed?src=phxcalender%40gmail.com&ctz=America%2FPhoenix"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-primary"
                            style={{ textDecoration: 'none', fontSize: 13 }}
                        >
                            ↗ Open &amp; Edit in Google Calendar
                        </a>
                    </div>
                    <div className="cal-embed-wrap">
                        <iframe
                            src="https://calendar.google.com/calendar/embed?src=phxcalender%40gmail.com&ctz=America%2FPhoenix"
                            className="cal-embed-frame"
                            frameBorder="0"
                            scrolling="no"
                            title="Official Phoenix SecTech Calendar"
                        />
                    </div>
                </>
            )}
        </Layout>
    );
}
