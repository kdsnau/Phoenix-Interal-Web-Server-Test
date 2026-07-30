import { useState, useEffect } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import Layout from '../components/Layout';
import PageHelp from '../components/PageHelp';
import { CameraCard } from './Cameras';
import { NewTicketModal } from './Tickets';
import './Alarms.css';
import './Cameras.css';

/* -----------------------------------------------------------------------
   Helpers
   ----------------------------------------------------------------------- */
function timeAgo(dateStr) {
    if (!dateStr) return '—';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return days === 1 ? 'yesterday' : `${days}d ago`;
}

const ARM_STATE = {
    armed_away: { label: 'Armed Away', cls: 'tag-red'    },
    armed_stay: { label: 'Armed Stay', cls: 'tag-yellow' },
    disarmed:   { label: 'Disarmed',   cls: 'tag-green'  },
};

const EVENT_TYPE = {
    armed_away:  { label: 'Armed Away',  cls: 'tag-red'    },
    armed_stay:  { label: 'Armed Stay',  cls: 'tag-yellow' },
    disarmed:    { label: 'Disarmed',    cls: 'tag-green'  },
    alarm:       { label: 'ALARM',       cls: 'tag-red'    },
    trouble:     { label: 'Trouble',     cls: 'tag-yellow' },
    zone_bypass: { label: 'Bypass',      cls: 'tag-yellow' },
    system:      { label: 'System',      cls: 'tag-dim'    },
};


/* -----------------------------------------------------------------------
   Panel tab — DMP alarm panel status, zones, events
   ----------------------------------------------------------------------- */
function PanelTab({ clientId, isAdmin }) {
    const [accounts,  setAccounts]  = useState([]);
    const [selected,  setSelected]  = useState(null); // active dmp account id
    const [status,    setStatus]    = useState(null);
    const [zones,     setZones]     = useState([]);
    const [events,    setEvents]    = useState([]);
    const [tab,       setTab]       = useState('status');
    const [loading,   setLoading]   = useState(true);
    const [dataLoading, setDataLoading] = useState(false);
    const [showLink,  setShowLink]  = useState(false);

    /* Load DMP accounts for this client */
    useEffect(() => {
        api.get('/dmp/accounts', { params: { client_id: clientId } })
            .then(r => {
                setAccounts(r.data);
                if (r.data.length > 0) setSelected(r.data[0].id);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [clientId]);

    /* Load panel data when account selected */
    useEffect(() => {
        if (!selected) return;
        setDataLoading(true);
        Promise.all([
            api.get(`/dmp/accounts/${selected}/status`),
            api.get(`/dmp/accounts/${selected}/zones`),
            api.get(`/dmp/accounts/${selected}/events`),
        ]).then(([s, z, e]) => {
            setStatus(s.data);
            setZones(Array.isArray(z.data) ? z.data : []);
            setEvents(Array.isArray(e.data) ? e.data : []);
        }).catch(() => {
            setStatus(null);
        }).finally(() => setDataLoading(false));
    }, [selected]);

    async function unlinkAccount(id) {
        if (!confirm('Remove this panel link?')) return;
        await api.delete(`/dmp/accounts/${id}`);
        setAccounts(a => a.filter(x => x.id !== id));
        if (selected === id) setSelected(accounts.find(x => x.id !== id)?.id || null);
    }

    if (loading) return <div className="alarm-empty">Loading…</div>;

    /* No accounts linked yet */
    if (accounts.length === 0) {
        return (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-dim)' }}>
                <div style={{ fontSize: 14, marginBottom: 4 }}>No alarm panel linked to this client.</div>
                {isAdmin && (
                    <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => setShowLink(true)}>
                        + Link Panel
                    </button>
                )}
                {showLink && (
                    <LinkPanelModal
                        clientId={clientId}
                        onClose={() => setShowLink(false)}
                        onSaved={acc => { setAccounts([acc]); setSelected(acc.id); setShowLink(false); }}
                    />
                )}
            </div>
        );
    }

    const arm  = status ? (ARM_STATE[status.armState] || { label: status.armState, cls: 'tag-dim' }) : null;
    const faultZones = zones.filter(z => z.state === 'open' || z.state === 'alarm');
    const bypassed   = zones.filter(z => z.bypassed);

    return (
        <div className="alarm-section">
            {/* Account selector (if multiple panels) */}
            {accounts.length > 1 && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                    {accounts.map(a => (
                        <button
                            key={a.id}
                            className={`btn ${selected === a.id ? 'btn-primary' : 'btn-ghost'}`}
                            style={{ fontSize: 12, padding: '4px 12px' }}
                            onClick={() => setSelected(a.id)}
                        >
                            {a.name}
                            {a.mock && <span style={{ marginLeft: 6, opacity: 0.6, fontSize: 10 }}>MOCK</span>}
                        </button>
                    ))}
                </div>
            )}

            {dataLoading && <div className="alarm-empty">Loading panel data…</div>}

            {!dataLoading && status && (
                <>
                    {/* Status bar */}
                    <div className="dmp-status-bar">
                        <div className="dmp-status-item">
                            <span className={`tag ${status.online ? 'tag-green' : 'tag-red'}`}>
                                {status.online ? '● Online' : '● Offline'}
                            </span>
                        </div>
                        {arm && (
                            <div className="dmp-status-item">
                                <span className={`tag ${arm.cls}`}>{arm.label}</span>
                            </div>
                        )}
                        {!status.acPower && <span className="tag tag-red">AC Loss</span>}
                        {!status.batteryOk && <span className="tag tag-red">Low Battery</span>}
                        {status.trouble && <span className="tag tag-yellow">Trouble</span>}
                        {faultZones.length > 0 && (
                            <span className="tag tag-red">{faultZones.length} Zone Fault{faultZones.length !== 1 ? 's' : ''}</span>
                        )}
                        {bypassed.length > 0 && (
                            <span className="tag tag-yellow">{bypassed.length} Bypassed</span>
                        )}
                        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                            Updated {timeAgo(status.lastUpdate)}
                        </span>
                    </div>

                    {/* Sub-tabs */}
                    <div className="dmp-tabs">
                        {['status', 'zones', 'events'].map(t => (
                            <button
                                key={t}
                                className={`nvr-tab ${tab === t ? 'nvr-tab--active' : ''}`}
                                onClick={() => setTab(t)}
                            >
                                {t.charAt(0).toUpperCase() + t.slice(1)}
                                {t === 'zones' && faultZones.length > 0 && (
                                    <span className="tag tag-red" style={{ fontSize: 9, marginLeft: 6 }}>{faultZones.length}</span>
                                )}
                            </button>
                        ))}
                    </div>

                    {/* Status tab */}
                    {tab === 'status' && (
                        <div className="dmp-info-grid">
                            <div className="dmp-info-item"><span className="alarm-label">Panel ID</span><span>{status.panelId || '—'}</span></div>
                            <div className="dmp-info-item"><span className="alarm-label">Arm State</span><span className={`tag ${arm?.cls}`}>{arm?.label || '—'}</span></div>
                            <div className="dmp-info-item"><span className="alarm-label">AC Power</span><span className={`tag ${status.acPower ? 'tag-green' : 'tag-red'}`}>{status.acPower ? 'OK' : 'LOSS'}</span></div>
                            <div className="dmp-info-item"><span className="alarm-label">Battery</span><span className={`tag ${status.batteryOk ? 'tag-green' : 'tag-red'}`}>{status.batteryOk ? 'OK' : 'LOW'}</span></div>
                            <div className="dmp-info-item"><span className="alarm-label">Zones</span><span>{zones.length}</span></div>
                            <div className="dmp-info-item"><span className="alarm-label">Faults</span><span>{faultZones.length > 0 ? <span className="tag tag-red">{faultZones.length}</span> : <span className="tag tag-green">None</span>}</span></div>
                        </div>
                    )}

                    {/* Zones tab */}
                    {tab === 'zones' && (
                        <div className="table-card" style={{ marginTop: 8 }}>
                            <table className="data-table">
                                <thead>
                                    <tr><th>Zone</th><th>Type</th><th>State</th><th>Bypassed</th></tr>
                                </thead>
                                <tbody>
                                    {zones.map(z => (
                                        <tr key={z.id} style={{ opacity: z.bypassed ? 0.5 : 1 }}>
                                            <td style={{ fontWeight: 500, color: 'var(--text-hi)' }}>
                                                {z.name}
                                            </td>
                                            <td><span className="tag tag-dim" style={{ fontSize: 10 }}>{z.type}</span></td>
                                            <td>
                                                <span className={`tag ${z.state === 'open' || z.state === 'alarm' ? 'tag-red' : z.state === 'inactive' || z.state === 'closed' ? 'tag-green' : 'tag-dim'}`} style={{ fontSize: 10 }}>
                                                    {z.state}
                                                </span>
                                            </td>
                                            <td>{z.bypassed ? <span className="tag tag-yellow" style={{ fontSize: 10 }}>Bypassed</span> : '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Events tab */}
                    {tab === 'events' && (
                        <div style={{ marginTop: 8 }}>
                            {events.map((ev, i) => {
                                const et = EVENT_TYPE[ev.type] || { label: ev.type, cls: 'tag-dim' };
                                return (
                                    <div key={ev.id || i} className="event-row">
                                        <span className={`tag ${et.cls}`} style={{ fontSize: 10, flexShrink: 0 }}>{et.label}</span>
                                        <span className="event-camera">{ev.description}</span>
                                        {ev.user && <span className="event-desc">{ev.user}</span>}
                                        <span className="event-time">{timeAgo(ev.timestamp)}</span>
                                    </div>
                                );
                            })}
                            {events.length === 0 && <div className="alarm-empty">No events.</div>}
                        </div>
                    )}
                </>
            )}

            {/* Admin controls */}
            {isAdmin && (
                <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
                    <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowLink(true)}>+ Add Panel</button>
                    {selected && (
                        <button className="btn btn-danger" style={{ fontSize: 12 }} onClick={() => unlinkAccount(selected)}>Remove Panel</button>
                    )}
                </div>
            )}

            {showLink && (
                <LinkPanelModal
                    clientId={clientId}
                    onClose={() => setShowLink(false)}
                    onSaved={acc => { setAccounts(a => [...a, acc]); setSelected(acc.id); setShowLink(false); }}
                />
            )}
        </div>
    );
}

/* -----------------------------------------------------------------------
   Link panel modal
   ----------------------------------------------------------------------- */
function LinkPanelModal({ clientId, onClose, onSaved }) {
    const [form, setForm] = useState({ name: '', site_id: '', api_key: '', api_url: 'https://api.wadmp.com', mock: false });
    const [error, setError]   = useState('');
    const [saving, setSaving] = useState(false);

    function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

    async function submit(e) {
        e.preventDefault();
        setError('');
        setSaving(true);
        try {
            const { data } = await api.post('/dmp/accounts', { ...form, client_id: clientId });
            onSaved(data);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to link panel.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440, width: '100%' }}>
                <div className="modal-title">Link DMP Panel</div>
                {error && <div className="error-msg">{error}</div>}
                <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Display Name *</label>
                        <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Main Panel" required autoFocus />
                    </div>
                    {!form.mock && (
                        <>
                            <div className="form-group" style={{ margin: 0 }}>
                                <label className="form-label">Site ID *</label>
                                <input value={form.site_id} onChange={e => set('site_id', e.target.value)} placeholder="DMP site identifier" required />
                            </div>
                            <div className="form-group" style={{ margin: 0 }}>
                                <label className="form-label">API Key</label>
                                <input type="password" value={form.api_key} onChange={e => set('api_key', e.target.value)} placeholder="WA DMP API key" />
                            </div>
                            <div className="form-group" style={{ margin: 0 }}>
                                <label className="form-label">API URL</label>
                                <input value={form.api_url} onChange={e => set('api_url', e.target.value)} />
                            </div>
                        </>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                        <input type="checkbox" id="dmp-mock-cb" checked={form.mock} onChange={e => set('mock', e.target.checked)} />
                        <label htmlFor="dmp-mock-cb" style={{ cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' }}>Demo / Mock mode</label>
                    </div>
                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Linking…' : 'Link Panel'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

const STATUS_CLASS = {
    open:             'tag-yellow',
    in_progress:      'tag-blue',
    resolved:         'tag-green',
    closed:           'tag-dim',
    return_necessary: 'tag-red',
};

const SERVICE_TABS = ['all', 'alarm', 'fire', 'access_control', 'maintenance', 'tnm', 'cctv', 'projects', 'unmonitored'];

/* Canonical service types + their display labels, reused by the tag list, the
   filter tabs, the "add client" form, and the admin service-type editor.
   ('maintenance' is a service type; distinct from the monitoring_enabled flag.)
   Must stay in step with the `allowed` list in server/routes/clients.js. */
const SERVICE_TYPES = ['fire', 'alarm', 'access_control', 'maintenance', 'tnm', 'cctv'];
const SERVICE_LABEL = {
    fire: 'Fire', alarm: 'Alarm', access_control: 'Access Control', maintenance: 'Maintenance',
    tnm: 'TNM', cctv: 'CCTV',
};
/* Tag color class per service type. */
const svcClass = s => s === 'fire' ? 'tag-red'
    : s === 'access_control' ? 'tag-blue'
    : s === 'maintenance' ? 'tag-green'
    : s === 'tnm' ? 'tag-purple'
    : s === 'cctv' ? 'tag-cyan'
    : 'tag-yellow';

/* -----------------------------------------------------------------------
   Per-client notes board — a running discussion any staff member can post to
   (mirrors the dashboard Notice Board; technicians can post here too).
   ----------------------------------------------------------------------- */
function ClientBoard({ clientId, user }) {
    const [posts,   setPosts]   = useState([]);
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(true);
    const [posting, setPosting] = useState(false);

    useEffect(() => {
        setLoading(true);
        api.get(`/clients/${clientId}/posts`)
            .then(r => setPosts(r.data))
            .catch(() => setPosts([]))
            .finally(() => setLoading(false));
    }, [clientId]);

    async function submit(e) {
        e.preventDefault();
        if (!content.trim()) return;
        setPosting(true);
        try {
            const { data } = await api.post(`/clients/${clientId}/posts`, { content });
            setPosts(prev => [data, ...prev]);
            setContent('');
        } catch { /* keep the draft so nothing is lost */ }
        finally { setPosting(false); }
    }

    async function deletePost(id) {
        if (!confirm('Delete this note?')) return;
        try {
            await api.delete(`/clients/${clientId}/posts/${id}`);
            setPosts(prev => prev.filter(p => p.id !== id));
        } catch (e) { alert(e.response?.data?.error || 'Delete failed.'); }
    }

    return (
        <div className="alarm-section">
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', marginBottom: 14 }}>
                <textarea
                    className="alarm-notes-input"
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    placeholder="Add a note about this client…"
                    rows={3}
                    style={{ width: '100%' }}
                />
                <button type="submit" className="btn btn-primary" disabled={posting || !content.trim()}
                    style={{ alignSelf: 'flex-end', marginTop: 6 }}>
                    {posting ? 'Posting…' : 'Post Note'}
                </button>
            </form>

            {loading ? (
                <div className="alarm-empty">Loading…</div>
            ) : posts.length === 0 ? (
                <div className="alarm-empty">No notes yet. Be the first to post.</div>
            ) : (
                <div className="board-posts">
                    {posts.map(post => (
                        <div key={post.id} className="board-post">
                            <div className="board-post-meta">
                                <span className="board-post-author">{post.author_name || 'Unknown'}</span>
                                <span className="board-post-time">{timeAgo(post.created_at)}</span>
                                {(user.role === 'admin' || post.author_id === user.id) && (
                                    <button className="board-delete" onClick={() => deletePost(post.id)} title="Delete">✕</button>
                                )}
                            </div>
                            <div className="board-post-content">{post.content}</div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/* -----------------------------------------------------------------------
   Cameras for one client. NVR servers carry the link (nvr_servers.client_id),
   so a client's cameras are every device on every server pointed at them.
   Cards are the Cameras page's own CameraCard, so snapshots and the live view
   behave identically (an <img src> can't send the JWT — CameraCard fetches the
   snapshot as an authed blob).
   ----------------------------------------------------------------------- */
function ClientCamerasTab({ clientId }) {
    const [servers, setServers] = useState([]);   // [{ server, devices, error }]
    const [loading, setLoading] = useState(true);
    const [error,   setError]   = useState('');

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            setError('');
            try {
                const { data } = await api.get('/nvr/servers');
                const mine = (Array.isArray(data) ? data : []).filter(s => s.client_id === clientId);
                const withDevices = await Promise.all(mine.map(async (server) => {
                    try {
                        const r = await api.get(`/nvr/servers/${server.id}/devices`);
                        const devices = Array.isArray(r.data) ? r.data : (r.data?.data || []);
                        return { server, devices, error: '' };
                    } catch (err) {
                        return { server, devices: [], error: err.response?.data?.error || 'Could not load cameras.' };
                    }
                }));
                if (!cancelled) setServers(withDevices);
            } catch (err) {
                if (!cancelled) setError(err.response?.data?.error || 'Could not load NVR servers.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [clientId]);

    if (loading) return <div className="alarm-empty">Loading cameras…</div>;
    if (error)   return <div style={{ color: 'var(--red)', fontSize: 13 }}>{error}</div>;
    if (servers.length === 0) {
        return (
            <div className="alarm-empty">
                No NVR server is linked to this client. Link one on the Cameras page
                by setting its Client field.
            </div>
        );
    }

    return (
        <div className="alarm-section">
            {servers.map(({ server, devices, error: devErr }) => (
                <div key={server.id} style={{ marginBottom: 20 }}>
                    <div className="alarm-label" style={{ marginBottom: 8, fontWeight: 600 }}>
                        {server.name}
                    </div>
                    {devErr && <div style={{ color: 'var(--red)', fontSize: 13 }}>{devErr}</div>}
                    {!devErr && devices.length === 0 && <div className="alarm-empty">No cameras found.</div>}
                    {devices.length > 0 && (
                        <div className="cam-grid">
                            {devices.map(cam => <CameraCard key={cam.id} camera={cam} serverId={server.id} />)}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

/* -----------------------------------------------------------------------
   Slack activity for one client — merged from the alarm-signal channel and the
   project-reports channel, filtered to this client by name on the server
   (/alarm-slack/client/:id). Each message carries a `source` ("Alarm" or
   "Project") so a project client (e.g. Terros Health) sees its project posts
   here too.
   ----------------------------------------------------------------------- */
function ClientSlackTab({ clientId }) {
    const [messages, setMessages] = useState([]);
    const [loading,  setLoading]  = useState(true);
    const [error,    setError]    = useState('');

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError('');
        api.get(`/alarm-slack/client/${clientId}`)
            .then(r => { if (!cancelled) setMessages(r.data.messages || []); })
            .catch(err => { if (!cancelled) setError(err.response?.data?.error || 'Could not load Slack messages.'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [clientId]);

    if (loading) return <div className="alarm-empty">Loading Slack activity…</div>;
    if (error)   return <div style={{ color: 'var(--red)', fontSize: 13 }}>{error}</div>;

    return (
        <div className="alarm-slack-feed">
            {messages.length === 0 && (
                <div className="alarm-slack-empty">No Slack messages matched to this client.</div>
            )}
            {messages.map(m => (
                <div key={`${m.source || ''}-${m.ts}`} className="alarm-slack-msg">
                    <div className="alarm-slack-date" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {m.source && <span className={m.source === 'Project' ? 'tag-purple' : 'tag-yellow'}>{m.source}</span>}
                        {new Date(m.date).toLocaleString('en-US', {
                            month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
                        })}
                    </div>
                    {m.fields
                        ? Object.entries(m.fields).map(([label, val]) => (
                            <div key={label} className="alarm-slack-field">
                                <div className="alarm-slack-label">{label}</div>
                                <div className="alarm-slack-val">{val}</div>
                            </div>
                        ))
                        : <div className="alarm-slack-raw">{m.text}</div>}
                </div>
            ))}
        </div>
    );
}

/* -----------------------------------------------------------------------
   Locations in a rollup — tick several clients into the selected rollup at
   once, instead of opening each client and setting its dropdown. A client
   still belongs to at most one rollup (clients.rollup_id), so ticking a row
   that already sits in another rollup moves it.
   ----------------------------------------------------------------------- */
function RollupLocations({ rollupId, currentClientId, onChanged }) {
    const [all,     setAll]     = useState([]);
    const [loading, setLoading] = useState(true);
    const [search,  setSearch]  = useState('');
    const [busy,    setBusy]    = useState(null);   // id being written

    const load = () => {
        setLoading(true);
        /* all: 1 so a project client can be grouped into a multi-location rollup too. */
        api.get('/clients', { params: { all: 1 } })
            .then(r => setAll(r.data))
            .catch(() => setAll([]))
            .finally(() => setLoading(false));
    };
    useEffect(load, []);

    async function toggle(c) {
        const inRollup = c.rollup_id === rollupId;
        setBusy(c.id);
        try {
            await api.put(`/clients/${c.id}/rollup`, { rollup_id: inRollup ? null : rollupId });
            setAll(list => list.map(x => x.id === c.id ? { ...x, rollup_id: inRollup ? null : rollupId } : x));
            onChanged?.();
        } catch (e) {
            alert(e.response?.data?.error || 'Failed to update rollup.');
        } finally {
            setBusy(null);
        }
    }

    const q = search.trim().toLowerCase();
    const rows = all
        .filter(c => c.id !== currentClientId)
        .filter(c => !q || String(c.name || '').toLowerCase().includes(q)
                        || String(c.customer_id || '').toLowerCase().includes(q))
        /* Members first, so what's already in the rollup is visible without hunting. */
        .sort((a, b) => (Number(b.rollup_id === rollupId) - Number(a.rollup_id === rollupId))
                        || String(a.name || '').localeCompare(String(b.name || '')));

    const memberCount = all.filter(c => c.rollup_id === rollupId).length;

    return (
        <div style={{ marginBottom: 16 }}>
            <div className="alarm-label" style={{ marginBottom: 6 }}>
                Locations in this group ({memberCount})
            </div>
            <input
                className="alarm-input"
                style={{ maxWidth: 280, marginBottom: 8 }}
                placeholder="Search locations…"
                value={search}
                onChange={e => setSearch(e.target.value)}
            />
            {loading ? (
                <div className="alarm-empty">Loading…</div>
            ) : (
                <div className="alarm-rollup-list">
                    {rows.length === 0 && <div className="alarm-empty">No other clients match.</div>}
                    {rows.map(c => {
                        const inRollup = c.rollup_id === rollupId;
                        const elsewhere = !inRollup && c.rollup_id != null;
                        return (
                            <label key={c.id} className="alarm-rollup-row">
                                <input
                                    type="checkbox"
                                    checked={inRollup}
                                    disabled={busy === c.id}
                                    onChange={() => toggle(c)}
                                />
                                <span className="alarm-rollup-name">{c.name}</span>
                                <span className="tag-dim">{c.customer_id}</span>
                                {elsewhere && <span className="tag-yellow">in {c.rollup_name || 'another rollup'}</span>}
                            </label>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

/* -----------------------------------------------------------------------
   Client detail panel
   ----------------------------------------------------------------------- */
function ClientDetail({ client, onClose, onRefresh, technicians, rollups = [], reloadRollups }) {
    const { user } = useAuth();
    const canBilling = user.role === 'admin' || user.role === 'accounting';
    const isAdmin    = user.role === 'admin';
    /* Technicians are read-only on the client record (site/contact/notes/maintenance).
       They keep the collaborative Notes Board, ticket creation, and their own reports. */
    const canEdit    = canBilling;

    const [tab, setTab]           = useState('system');
    const [notes, setNotes]         = useState(client.notes || '');
    const [savingNotes, setSavingNotes] = useState(false);

    /* Inline rename (admin only) */
    const [editingName, setEditingName] = useState(false);
    const [nameVal,     setNameVal]     = useState(client.name);
    const [savingName,  setSavingName]  = useState(false);

    /* Site & contact */
    const [savingContact, setSavingContact] = useState(false);
    const [contactMsg,    setContactMsg]    = useState('');
    const [siteAddress,   setSiteAddress]   = useState(client.site_address   || '');
    const [contactName,   setContactName]   = useState(client.contact_name   || '');
    const [contactPhone,  setContactPhone]  = useState(client.contact_phone  || '');
    const [contactEmail,  setContactEmail]  = useState(client.contact_email  || '');
    /* Service types (admin-reassignable): fire / alarm / access control / maintenance */
    const [services,    setServices]    = useState(client.services || []);
    const [savingSvc,   setSavingSvc]   = useState(false);
    /* Manual rollup grouping (admin) */
    const [rollupId,       setRollupId]       = useState(client.rollup_id || '');
    const [savingRollup,   setSavingRollup]   = useState(false);
    const [newRollup,      setNewRollup]      = useState('');
    const [creatingRollup, setCreatingRollup] = useState(false);
    /* Scheduled maintenance — auto-creates a ticket when due (lives on the Tickets tab) */
    const [maintEnabled,  setMaintEnabled]  = useState(client.maintenance_enabled || false);
    const [maintFreq,     setMaintFreq]     = useState(client.maintenance_frequency || 'quarterly');
    const [maintNext,     setMaintNext]     = useState(client.maintenance_next ? client.maintenance_next.slice(0, 10) : '');
    const [maintAssignee, setMaintAssignee] = useState(client.maintenance_assignee_id || '');
    const [maintRunMsg,   setMaintRunMsg]   = useState('');
    const [savingMaint,   setSavingMaint]   = useState(false);
    const [transactions, setTransactions] = useState([]);
    const [txLoading, setTxLoading]       = useState(false);
    const [txForm, setTxForm]     = useState({ description: '', amount: '', type: 'invoice', date: '' });
    const [showNewTicket, setShowNewTicket] = useState(false);
    const [togglingMon, setTogglingMon] = useState(false);
    const [monEnabled, setMonEnabled] = useState(client.monitoring_enabled);
    /* Site maps — pulled from Slack (default) or a mounted network drive */
    const [siteMaps,        setSiteMaps]        = useState(null);   // { source, files, ... } | { error }
    const [siteMapsLoading, setSiteMapsLoading] = useState(false);
    const [smSearch,        setSmSearch]        = useState('');     // slack: live filter
    const [smCfg,           setSmCfg]           = useState(null);   // admin: { source, root, slack_channel }
    const [smMsg,           setSmMsg]           = useState('');

    useEffect(() => {
        if (tab === 'transactions' && canBilling) {
            setTxLoading(true);
            api.get(`/clients/${client.id}/transactions`)
                .then(r => setTransactions(r.data))
                .catch(() => setTransactions([]))
                .finally(() => setTxLoading(false));
        }
    }, [tab, client.id, canBilling]);

    useEffect(() => {
        if (tab !== 'sitemap') return;
        setSiteMapsLoading(true);
        setSmSearch(client.name || '');
        api.get(`/clients/${client.id}/site-maps`)
            .then(r => setSiteMaps(r.data))
            .catch(e => setSiteMaps({ source: e.response?.data?.source, error: e.response?.data?.error || 'Failed to load site maps.' }))
            .finally(() => setSiteMapsLoading(false));
        if (user.role === 'admin') {
            api.get('/clients/site-map-config').then(r => setSmCfg(r.data)).catch(() => {});
        }
    }, [tab, client.id, client.name, user.role]);

    async function saveName() {
        const next = nameVal.trim();
        if (!next || next === client.name) {   /* nothing to do — revert and close */
            setNameVal(client.name);
            setEditingName(false);
            return;
        }
        setSavingName(true);
        try {
            await api.patch(`/clients/${client.id}`, { name: next });
            setEditingName(false);
            onRefresh();
        } catch (e) {
            alert(e.response?.data?.error || 'Failed to rename client.');
            setNameVal(client.name);
            setEditingName(false);
        } finally {
            setSavingName(false);
        }
    }

    async function saveContact() {
        setSavingContact(true);
        setContactMsg('');
        try {
            await api.patch(`/clients/${client.id}`, {
                site_address:   siteAddress   || null,
                contact_name:   contactName   || null,
                contact_phone:  contactPhone  || null,
                contact_email:  contactEmail  || null,
            });
            setContactMsg('Saved.');
            onRefresh();
            setTimeout(() => setContactMsg(''), 2000);
        } catch (e) {
            setContactMsg(e.response?.data?.error || 'Failed to save.');
        } finally {
            setSavingContact(false);
        }
    }

    async function saveNotes() {
        setSavingNotes(true);
        try {
            await api.patch(`/clients/${client.id}`, {
                notes,
                /* billing_amount / billing_frequency are intentionally not sent:
                   billing is set on the Admin page now, so re-sending stale values
                   from here would clobber a concurrent admin edit. permit_* are
                   likewise omitted (columns kept, UI removed). */
                /* Site & contact are still sent so that someone who edits them and
                   reaches for this button doesn't lose the change; they also have
                   their own Save now. */
                site_address:   siteAddress   || null,
                contact_name:   contactName   || null,
                contact_phone:  contactPhone  || null,
                contact_email:  contactEmail  || null,
            });
            onRefresh();
        } catch (e) {
            /* Previously unguarded: a failed PATCH left the button stuck on
               "Saving…" and dropped the edit without telling anyone. */
            alert(e.response?.data?.error || 'Failed to save.');
        } finally {
            setSavingNotes(false);
        }
    }

    async function saveMaintenance() {
        setSavingMaint(true);
        await api.patch(`/clients/${client.id}`, {
            maintenance_enabled:   maintEnabled,
            maintenance_frequency: maintFreq,
            maintenance_next:      maintNext || null,
            maintenance_assignee_id: maintAssignee || null,
        });
        setSavingMaint(false);
        onRefresh();
    }

    function toggleService(s) {
        setServices(cur => cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s]);
    }

    async function saveServices() {
        setSavingSvc(true);
        try {
            await api.patch(`/clients/${client.id}`, { services });
            onRefresh();
        } finally {
            setSavingSvc(false);
        }
    }

    async function assignRollup(id) {
        setRollupId(id);
        setSavingRollup(true);
        try {
            await api.put(`/clients/${client.id}/rollup`, { rollup_id: id === '' ? null : Number(id) });
            onRefresh();
            reloadRollups && reloadRollups();
        } catch (e) {
            alert(e.response?.data?.error || 'Failed to update rollup.');
        } finally {
            setSavingRollup(false);
        }
    }

    async function createAndAssignRollup() {
        const name = newRollup.trim();
        if (!name) return;
        setCreatingRollup(true);
        try {
            const { data } = await api.post('/clients/rollups', { name });
            setNewRollup('');
            reloadRollups && reloadRollups();
            await assignRollup(String(data.id));
        } catch (e) {
            alert(e.response?.data?.error || 'Failed to create rollup.');
        } finally {
            setCreatingRollup(false);
        }
    }

    async function runMaintenanceNow() {
        setMaintRunMsg('Running…');
        try {
            const { data } = await api.post('/clients/run-maintenance');
            setMaintRunMsg(data.created > 0
                ? `Created ${data.created} ticket(s): ${data.names.join(', ')}`
                : 'No maintenance due right now.');
        } catch (e) {
            setMaintRunMsg(e.response?.data?.error || 'Run failed.');
        }
    }

    async function toggleMonitoring() {
        const newVal = !monEnabled;
        setMonEnabled(newVal);          // optimistic — button flips instantly
        setTogglingMon(true);
        try {
            await api.post(`/clients/${client.id}/monitoring`);
            onRefresh();                // sync card list in background
        } catch {
            setMonEnabled(!newVal);     // revert if the request fails
        } finally {
            setTogglingMon(false);
        }
    }

    async function addTransaction(e) {
        e.preventDefault();
        await api.post(`/clients/${client.id}/transactions`, txForm);
        setTxForm({ description: '', amount: '', type: 'invoice', date: '' });
        const r = await api.get(`/clients/${client.id}/transactions`);
        setTransactions(r.data);
    }

    async function deleteTransaction(txId) {
        if (!confirm('Delete this transaction?')) return;
        await api.delete(`/clients/${client.id}/transactions/${txId}`);
        setTransactions(t => t.filter(x => x.id !== txId));
    }


    /* Site-map files (DWG, or whatever's posted in Slack) can't render inline —
       fetch as a blob (sends the auth header) and trigger a download. */
    async function downloadSiteMap(file) {
        try {
            const res = await api.get(`/clients/${client.id}/site-maps/download?${file.dl}`, { responseType: 'blob' });
            const url = URL.createObjectURL(res.data);
            const a = document.createElement('a');
            a.href = url; a.download = file.name;
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);
        } catch (e) {
            alert(e.response?.data?.error || 'Download failed.');
        }
    }

    async function saveSmCfg() {
        setSmMsg('Saving…');
        try {
            await api.put('/clients/site-map-config', {
                source:        smCfg.source,
                root:          smCfg.root,
                slack_channel: smCfg.slack_channel,
            });
            setSiteMapsLoading(true);
            const r = await api.get(`/clients/${client.id}/site-maps`);
            setSiteMaps(r.data);
            setSmMsg('Saved.');
        } catch (e) {
            setSmMsg(e.response?.data?.error || 'Save failed.');
        } finally {
            setSiteMapsLoading(false);
        }
    }

    const fmtSize = b => b == null ? '' : (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);


    return (
        <>
        <div className="alarm-detail-overlay" onClick={onClose}>
            <div className="alarm-detail" onClick={e => e.stopPropagation()}>
                <div className="alarm-detail-header">
                    <div style={{ minWidth: 0, flex: 1 }}>
                        {editingName ? (
                            <input
                                className="alarm-input alarm-detail-name-input"
                                value={nameVal}
                                autoFocus
                                disabled={savingName}
                                onChange={e => setNameVal(e.target.value)}
                                onBlur={saveName}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
                                    if (e.key === 'Escape') { setNameVal(client.name); setEditingName(false); }
                                }}
                            />
                        ) : (
                            <div
                                className={`alarm-detail-name${isAdmin ? ' alarm-detail-name--editable' : ''}`}
                                onClick={() => { if (isAdmin) { setNameVal(client.name); setEditingName(true); } }}
                                title={isAdmin ? 'Click to rename' : undefined}
                            >
                                {client.name}
                            </div>
                        )}
                        <div className="alarm-detail-meta">
                            <span>{client.customer_id}</span>
                            {services.map(s => <span key={s} className={`${svcClass(s)} alarm-svc-tag`}>{SERVICE_LABEL[s] || s}</span>)}
                        </div>
                    </div>
                    <button className="alarm-close-btn" onClick={onClose}>✕</button>
                </div>

                <div className="alarm-tabs">
                    {['system', 'panel', 'tickets', 'cameras', 'slack', 'sitemap', ...(canBilling ? ['transactions'] : [])].map(t => (
                        <button key={t} className={`alarm-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                            {t === 'sitemap' ? 'Site Map' : t === 'slack' ? 'Reports' : t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                    ))}
                </div>

                <div className="alarm-detail-body">
                    {/* SYSTEM TAB */}
                    {tab === 'system' && (
                        <div className="alarm-section">
                            {/* Site & Contact */}
                            <div className="alarm-label" style={{ marginBottom: 8, fontWeight: 600 }}>Site & Contact</div>
                            <div className="alarm-grid" style={{ marginBottom: 12 }}>
                                <div className="alarm-field" style={{ gridColumn: 'span 2' }}>
                                    <div className="alarm-label">Site Address</div>
                                    <input className="alarm-input" value={siteAddress} onChange={e => setSiteAddress(e.target.value)} readOnly={!canEdit} placeholder="123 Main St, Phoenix AZ 85001" />
                                </div>
                                <div className="alarm-field">
                                    <div className="alarm-label">Contact Name</div>
                                    <input className="alarm-input" value={contactName} onChange={e => setContactName(e.target.value)} readOnly={!canEdit} placeholder="John Smith" />
                                </div>
                                <div className="alarm-field">
                                    <div className="alarm-label">Contact Phone</div>
                                    <input className="alarm-input" value={contactPhone} onChange={e => setContactPhone(e.target.value)} readOnly={!canEdit} placeholder="(602) 555-0100" />
                                </div>
                                <div className="alarm-field">
                                    <div className="alarm-label">Contact Email</div>
                                    <input className="alarm-input" value={contactEmail} onChange={e => setContactEmail(e.target.value)} readOnly={!canEdit} placeholder="owner@example.com" />
                                </div>
                            </div>
                            {/* These fields used to have no save control of their own — the only
                               one was the "Save" under Notes at the bottom of the tab, which
                               also PATCHed them. Edits made here were routinely lost.
                               Technicians see the values read-only (no Save). */}
                            {canEdit && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                                    <button className="btn btn-primary" onClick={saveContact} disabled={savingContact}>
                                        {savingContact ? 'Saving…' : 'Save Site & Contact'}
                                    </button>
                                    {contactMsg && <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{contactMsg}</span>}
                                </div>
                            )}

                            {/* System type / vendor / serial # / connection / carrier were removed
                               from the UI; their columns are kept and still populated by the
                               importers, so the values are recoverable from the DB. */}
                            <div className="alarm-grid" style={{ marginBottom: 12 }}>
                                <div className="alarm-field">
                                    <div className="alarm-label">Monitoring</div>
                                    <div className="alarm-value">
                                        {canBilling ? (
                                            <button
                                                className={`btn btn-${monEnabled ? 'danger' : 'primary'}`}
                                                onClick={toggleMonitoring}
                                                disabled={togglingMon}
                                                style={{ fontSize: '12px', padding: '4px 12px' }}
                                            >
                                                {monEnabled ? 'Disable' : 'Enable'}
                                            </button>
                                        ) : (
                                            <span className={monEnabled ? 'tag-green' : 'tag-dim'}>
                                                {monEnabled ? 'Active' : 'Inactive'}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Service Types — admin-reassignable (Fire / Alarm / Access Control / Maintenance) */}
                            <div className="alarm-label" style={{ marginBottom: 8, fontWeight: 600 }}>Service Types</div>
                            {user.role === 'admin' ? (
                                <div style={{ marginBottom: 16 }}>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 10 }}>
                                        {SERVICE_TYPES.map(s => (
                                            <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                                                <input type="checkbox" checked={services.includes(s)} onChange={() => toggleService(s)} />
                                                <span className={`${svcClass(s)} alarm-svc-tag`}>{SERVICE_LABEL[s]}</span>
                                            </label>
                                        ))}
                                    </div>
                                    <button className="btn btn-primary" onClick={saveServices} disabled={savingSvc}>
                                        {savingSvc ? 'Saving…' : 'Save Service Types'}
                                    </button>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                                    {services.length === 0
                                        ? <span className="alarm-value">—</span>
                                        : services.map(s => <span key={s} className={`${svcClass(s)} alarm-svc-tag`}>{SERVICE_LABEL[s] || s}</span>)}
                                </div>
                            )}

                            {/* Multi-Location Client — manual grouping (admin); overrides the automatic customer-number grouping */}
                            {user.role === 'admin' && (
                                <>
                                    <div className="alarm-label" style={{ marginBottom: 8, fontWeight: 600 }}>Multi-Location Client</div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                                        <select className="alarm-input" style={{ maxWidth: 280 }} value={rollupId}
                                            onChange={e => assignRollup(e.target.value)} disabled={savingRollup}>
                                            <option value="">— None (auto-group by customer #) —</option>
                                            {rollups.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                        </select>
                                        {savingRollup && <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Saving…</span>}
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
                                        <input className="alarm-input" style={{ maxWidth: 220 }} placeholder="New group name…"
                                            value={newRollup} onChange={e => setNewRollup(e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); createAndAssignRollup(); } }} />
                                        <button type="button" className="btn btn-ghost" onClick={createAndAssignRollup}
                                            disabled={creatingRollup || !newRollup.trim()}>
                                            {creatingRollup ? 'Creating…' : '＋ Create & assign'}
                                        </button>
                                    </div>
                                    {rollupId ? (
                                        <RollupLocations
                                            key={rollupId}
                                            rollupId={Number(rollupId)}
                                            currentClientId={client.id}
                                            onChanged={onRefresh}
                                        />
                                    ) : (
                                        <div className="alarm-label" style={{ marginBottom: 16 }}>
                                            Assign this client to a multi-location group to tick other locations into it.
                                        </div>
                                    )}
                                </>
                            )}

                            <div className="alarm-notes-section">
                                <div className="alarm-label">Notes</div>
                                <textarea
                                    className="alarm-notes-input"
                                    value={notes}
                                    onChange={e => setNotes(e.target.value)}
                                    rows={4}
                                    readOnly={!canEdit}
                                    placeholder="Internal notes…"
                                />
                                {canEdit && (
                                    <button className="btn btn-primary" onClick={saveNotes} disabled={savingNotes}>
                                        {savingNotes ? 'Saving…' : 'Save'}
                                    </button>
                                )}
                            </div>

                            {/* Notes board (moved here from its own tab) — a running
                               discussion any staff member can post to, below the
                               single-field internal-notes box above. */}
                            <div style={{ borderTop: '1px solid var(--border)', marginTop: 20, paddingTop: 16 }}>
                                <div className="alarm-label" style={{ marginBottom: 8, fontWeight: 600 }}>Notes Board</div>
                                <ClientBoard clientId={client.id} user={user} />
                            </div>
                        </div>
                    )}

                    {/* TICKETS TAB */}
                    {tab === 'tickets' && (
                        <div className="alarm-section">
                            {/* The full ticket interface (same modal as the Tickets page),
                               pre-filled with this client. */}
                            {isAdmin && (
                                <div style={{ marginBottom: 16 }}>
                                    <button className="btn btn-primary" onClick={() => setShowNewTicket(true)}>
                                        ＋ New Ticket
                                    </button>
                                </div>
                            )}
                            <div className="alarm-ticket-list">
                                {(client.tickets || []).length === 0 && <div className="alarm-empty">No tickets.</div>}
                                {(client.tickets || []).map(tk => (
                                    <div key={tk.id} className="alarm-ticket-row">
                                        <div className="alarm-ticket-title">{tk.title}</div>
                                        <div className="alarm-ticket-meta">
                                            <span className={STATUS_CLASS[tk.status] || 'tag-dim'}>{tk.status}</span>
                                            {(tk.assignee_names || []).length > 0 && <span className="tag-dim">{tk.assignee_names.join(', ')}</span>}
                                            <span className="tag-dim">{new Date(tk.created_at).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Scheduled maintenance — auto-creates a service ticket when due */}
                            <div style={{ borderTop: '1px solid var(--border)', marginTop: 20, paddingTop: 16 }}>
                                <div className="alarm-label" style={{ marginBottom: 8, fontWeight: 600 }}>Scheduled Maintenance</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                                    <input type="checkbox" id={`maint-${client.id}`} checked={maintEnabled} onChange={e => setMaintEnabled(e.target.checked)} disabled={!canEdit} />
                                    <label htmlFor={`maint-${client.id}`} style={{ fontSize: 13, cursor: 'pointer' }}>
                                        Auto-create a maintenance ticket on the calendar when due
                                    </label>
                                </div>
                                {maintEnabled && (
                                    <>
                                        <div className="alarm-grid" style={{ marginBottom: 16 }}>
                                            <div className="alarm-field">
                                                <div className="alarm-label">Frequency</div>
                                                <select className="alarm-input" value={maintFreq} onChange={e => setMaintFreq(e.target.value)} disabled={!canEdit}>
                                                    <option value="monthly">Monthly</option>
                                                    <option value="quarterly">Quarterly</option>
                                                    <option value="semiannual">Semi-Annual</option>
                                                    <option value="yearly">Yearly</option>
                                                </select>
                                            </div>
                                            <div className="alarm-field">
                                                <div className="alarm-label">Next Maintenance Due</div>
                                                <input className="alarm-input" type="date" value={maintNext} onChange={e => setMaintNext(e.target.value)} readOnly={!canEdit} />
                                            </div>
                                        </div>
                                        <div className="alarm-field" style={{ marginBottom: 16 }}>
                                            <div className="alarm-label">Assign maintenance ticket to</div>
                                            <select className="alarm-input" value={maintAssignee} onChange={e => setMaintAssignee(e.target.value)} disabled={!canEdit}>
                                                <option value="">Unassigned</option>
                                                {technicians.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                            </select>
                                        </div>
                                        {maintNext && (() => {
                                            const days = Math.ceil((new Date(maintNext) - new Date()) / 86400000);
                                            if (days < 0)   return <div style={{ marginBottom: 12 }}><span className="tag tag-red">Maintenance OVERDUE by {Math.abs(days)}d</span></div>;
                                            if (days <= 30) return <div style={{ marginBottom: 12 }}><span className="tag tag-yellow">Maintenance due in {days}d</span></div>;
                                            return <div style={{ marginBottom: 12 }}><span className="tag tag-green">Next visit in {days}d</span></div>;
                                        })()}
                                    </>
                                )}
                                {canEdit && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                        <button className="btn btn-primary" onClick={saveMaintenance} disabled={savingMaint}>
                                            {savingMaint ? 'Saving…' : 'Save Maintenance'}
                                        </button>
                                        {maintEnabled && (
                                            <button type="button" className="btn btn-ghost" onClick={runMaintenanceNow}
                                                title="Generate tickets now for any client whose maintenance is due">
                                                Run maintenance check now
                                            </button>
                                        )}
                                    </div>
                                )}
                                {maintRunMsg && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8 }}>{maintRunMsg}</div>}
                            </div>
                        </div>
                    )}

                    {/* PANEL TAB */}
                    {tab === 'panel' && (
                        <PanelTab clientId={client.id} isAdmin={user.role === 'admin'} />
                    )}

                    {/* CAMERAS TAB — devices from any NVR server linked to this client */}
                    {tab === 'cameras' && (
                        <ClientCamerasTab clientId={client.id} />
                    )}

                    {/* SLACK TAB — alarm-signal Slack messages matched to this client */}
                    {tab === 'slack' && (
                        <ClientSlackTab clientId={client.id} />
                    )}

                    {/* TRANSACTIONS TAB */}
                    {tab === 'transactions' && canBilling && (
                        <div className="alarm-section">
                            <form className="alarm-tx-form" onSubmit={addTransaction}>
                                <input
                                    className="alarm-input"
                                    placeholder="Description"
                                    value={txForm.description}
                                    onChange={e => setTxForm(f => ({ ...f, description: e.target.value }))}
                                    required
                                />
                                <input
                                    className="alarm-input"
                                    type="number" step="0.01"
                                    placeholder="Amount"
                                    value={txForm.amount}
                                    onChange={e => setTxForm(f => ({ ...f, amount: e.target.value }))}
                                    required
                                    style={{ width: '120px' }}
                                />
                                <select className="alarm-select" value={txForm.type} onChange={e => setTxForm(f => ({ ...f, type: e.target.value }))}>
                                    <option value="invoice">Invoice</option>
                                    <option value="payment">Payment</option>
                                    <option value="expense">Expense</option>
                                </select>
                                <input
                                    className="alarm-input"
                                    type="date"
                                    value={txForm.date}
                                    onChange={e => setTxForm(f => ({ ...f, date: e.target.value }))}
                                />
                                <button className="btn btn-primary" type="submit">Add</button>
                            </form>
                            {txLoading ? <div className="alarm-empty">Loading…</div> : (
                                <table className="alarm-tx-table">
                                    <thead><tr><th>Date</th><th>Description</th><th>Type</th><th>Amount</th><th></th></tr></thead>
                                    <tbody>
                                        {transactions.length === 0 && (
                                            <tr><td colSpan={5} className="alarm-empty">No transactions.</td></tr>
                                        )}
                                        {transactions.map(tx => (
                                            <tr key={tx.id}>
                                                <td>{new Date(tx.date).toLocaleDateString()}</td>
                                                <td>{tx.description}</td>
                                                <td><span className={tx.type === 'payment' ? 'tag-green' : tx.type === 'invoice' ? 'tag-yellow' : 'tag-red'}>{tx.type}</span></td>
                                                <td className={tx.type === 'payment' ? 'tx-pos' : 'tx-neg'}>
                                                    {tx.type === 'payment' ? '+' : '-'}${Number(tx.amount).toFixed(2)}
                                                </td>
                                                <td><button className="btn btn-danger" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={() => deleteTransaction(tx.id)}>✕</button></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    )}

                    {/* SITE MAP TAB */}
                    {tab === 'sitemap' && (
                        <div className="alarm-section">
                            <div className="alarm-label" style={{ marginBottom: 8, fontWeight: 600 }}>
                                Site Maps {siteMaps?.source === 'drive' ? '(DWG) — from the network drive' : '— from Slack'}
                            </div>

                            {siteMaps?.source === 'slack' && !siteMapsLoading && !siteMaps?.error && (
                                <input className="alarm-input" value={smSearch} onChange={e => setSmSearch(e.target.value)}
                                    placeholder="Filter files…" style={{ width: '100%', marginBottom: 10 }} />
                            )}

                            {siteMapsLoading ? (
                                <div className="alarm-empty">Loading…</div>
                            ) : siteMaps?.error ? (
                                <div className="error-msg" style={{ marginBottom: 10 }}>{siteMaps.error}</div>
                            ) : (() => {
                                const all = siteMaps?.files || [];
                                const files = (siteMaps?.source === 'slack' && smSearch.trim())
                                    ? all.filter(f => {
                                        const s = smSearch.toLowerCase();
                                        return f.name.toLowerCase().includes(s) || (f.title || '').toLowerCase().includes(s);
                                    })
                                    : all;
                                if (!files.length) {
                                    return (
                                        <div className="alarm-empty">
                                            {siteMaps?.source === 'slack'
                                                ? (all.length ? 'No files match your filter — clear it to see everything in the channel.' : 'No files posted in the Slack channel yet.')
                                                : (siteMaps?.folder ? 'No DWG files found in this client’s folder.' : `No matching site-map folder found for this client${siteMaps?.root ? ` on ${siteMaps.root}` : ''}.`)}
                                        </div>
                                    );
                                }
                                return (
                                    <table className="data-table">
                                        <thead><tr><th>File</th><th>Size</th><th>Modified</th><th></th></tr></thead>
                                        <tbody>
                                            {files.map(f => (
                                                <tr key={f.key}>
                                                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                                                        {f.name}
                                                        {f.folder && <div style={{ color: 'var(--text-dim)', fontSize: 10, marginTop: 2 }}>{f.folder}</div>}
                                                    </td>
                                                    <td style={{ color: 'var(--text-dim)', fontSize: 12 }}>{fmtSize(f.size)}</td>
                                                    <td style={{ color: 'var(--text-dim)', fontSize: 12 }}>{f.modified ? new Date(f.modified).toLocaleDateString() : ''}</td>
                                                    <td><button className="btn btn-ghost" style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => downloadSiteMap(f)}>Download</button></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                );
                            })()}

                            {user.role === 'admin' && smCfg && (
                                <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                                    <div className="alarm-label" style={{ marginBottom: 6 }}>Site-map source (admin)</div>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                                        <select className="alarm-select" value={smCfg.source} onChange={e => setSmCfg(c => ({ ...c, source: e.target.value }))}>
                                            <option value="slack">Slack channel</option>
                                            <option value="drive">Network drive</option>
                                        </select>
                                        {smCfg.source === 'slack' ? (
                                            <input className="alarm-input" value={smCfg.slack_channel || ''} onChange={e => setSmCfg(c => ({ ...c, slack_channel: e.target.value }))}
                                                placeholder="C01N495H7S5" style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }} />
                                        ) : (
                                            <input className="alarm-input" value={smCfg.root || ''} onChange={e => setSmCfg(c => ({ ...c, root: e.target.value }))}
                                                placeholder="/mnt/sitemaps/RFQ's" style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }} />
                                        )}
                                        <button className="btn btn-primary" onClick={saveSmCfg}>Save</button>
                                    </div>
                                    {smMsg && <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{smMsg}</div>}
                                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
                                        {smCfg.source === 'slack'
                                            ? 'Lists files posted in the Slack channel; the bot must be in that channel and have the files:read scope. Use the filter box to find a client’s maps.'
                                            : 'Each client needs its own subfolder under this path (matched by name or account #).'}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
        {showNewTicket && (
            <NewTicketModal
                initialClient={client}
                technicians={technicians}
                onClose={() => setShowNewTicket(false)}
                onCreated={() => { setShowNewTicket(false); onRefresh(); }}
            />
        )}
        </>
    );
}

/* -----------------------------------------------------------------------
   Add client modal
   ----------------------------------------------------------------------- */
function NewClientModal({ onClose, onCreated }) {
    /* No vendor field: it was removed from the form, and the server defaults the
       column to 'generic' when it isn't sent. */
    const [form, setForm] = useState({
        name: '', customer_id: '', services: [], site_address: '', contact_name: '',
    });
    const [error,   setError]   = useState('');
    const [saving,  setSaving]  = useState(false);

    function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

    function toggleService(s) {
        setForm(f => ({
            ...f,
            services: f.services.includes(s)
                ? f.services.filter(x => x !== s)
                : [...f.services, s],
        }));
    }

    async function submit(e) {
        e.preventDefault();
        setError('');
        setSaving(true);
        try {
            const { data } = await api.post('/clients', form);
            onCreated(data);
            onClose();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to create client.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
                <div className="modal-title">Add Client</div>
                {error && <div className="error-msg">{error}</div>}
                <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Client Name *</label>
                            <input value={form.name} onChange={e => set('name', e.target.value)} required autoFocus />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Customer ID *</label>
                            <input value={form.customer_id} onChange={e => set('customer_id', e.target.value)} placeholder="e.g. PHX-001" required />
                        </div>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Site Address</label>
                        <input value={form.site_address} onChange={e => set('site_address', e.target.value)} placeholder="123 Main St, Phoenix AZ 85001" />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Contact Name</label>
                        <input value={form.contact_name} onChange={e => set('contact_name', e.target.value)} placeholder="e.g. Jane Doe" />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Services</label>
                        <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                            {SERVICE_TYPES.map(s => (
                                <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', fontWeight: 400 }}>
                                    <input type="checkbox" checked={form.services.includes(s)} onChange={() => toggleService(s)} />
                                    {SERVICE_LABEL[s]}
                                </label>
                            ))}
                        </div>
                    </div>
                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>
                            {saving ? 'Adding…' : 'Add Client'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

/* -----------------------------------------------------------------------
   Main Clients page
   ----------------------------------------------------------------------- */
/* Admin: rebuild the client list from the Customers-share folders (dry-run preview
   first, then commit). Monitored clients and their types are preserved. */
function RebuildModal({ onClose, onDone }) {
    const [preview, setPreview]       = useState(null);
    const [loading, setLoading]       = useState(true);
    const [committing, setCommitting] = useState(false);
    const [error, setError]           = useState('');
    const [result, setResult]         = useState(null);

    useEffect(() => {
        api.post('/clients/rebuild-from-drive', { commit: false })
            .then(r => setPreview(r.data))
            .catch(e => setError(e.response?.data?.error || 'Failed to read the drive.'))
            .finally(() => setLoading(false));
    }, []);

    async function commit() {
        if (!confirm(`Add ${preview.to_add.length} client(s) and remove ${preview.to_remove.length}? This cannot be undone.`)) return;
        setCommitting(true); setError('');
        try {
            const { data } = await api.post('/clients/rebuild-from-drive', { commit: true });
            setResult(data);
            onDone();
        } catch (e) { setError(e.response?.data?.error || 'Rebuild failed.'); }
        finally { setCommitting(false); }
    }

    const box = { maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 4, padding: 8, fontSize: 12 };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 640, width: '100%' }}>
                <div className="modal-title">Rebuild Client List from Drive</div>
                {error && <div className="error-msg">{error}</div>}
                {loading ? (
                    <p style={{ color: 'var(--text-dim)' }}>Reading drive…</p>
                ) : preview && (
                    <>
                        <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                            Source: <code>{preview.root}</code> — {preview.folder_count} folder(s){preview.skipped_no_number > 0 ? `, ${preview.skipped_no_number} no-number` : ''}{preview.skipped_inactive > 0 ? `, ${preview.skipped_inactive} inactive (>3yr)` : ''} skipped.{' '}
                            {preview.matched_count} already match a client; {preview.kept_count} established client(s) kept (monitored or typed).
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
                            <div>
                                <div className="alarm-label" style={{ marginBottom: 6 }}>Add ({preview.to_add.length})</div>
                                <div style={box}>
                                    {preview.to_add.length === 0 ? <span style={{ color: 'var(--text-dim)' }}>None</span> :
                                        preview.to_add.map((n, i) => <div key={i} style={{ color: 'var(--green)' }}>+ {n}</div>)}
                                </div>
                            </div>
                            <div>
                                <div className="alarm-label" style={{ marginBottom: 6 }}>Remove ({preview.to_remove.length})</div>
                                <div style={box}>
                                    {preview.to_remove.length === 0 ? <span style={{ color: 'var(--text-dim)' }}>None</span> :
                                        preview.to_remove.map(c => <div key={c.id} style={{ color: 'var(--red)' }}>− {c.name}</div>)}
                                </div>
                            </div>
                        </div>
                        {result ? (
                            <>
                                <div style={{ marginTop: 12, color: 'var(--green)', fontSize: 13 }}>Done — added {result.added}, removed {result.removed}.</div>
                                <div className="modal-actions"><button className="btn btn-primary" onClick={onClose}>Close</button></div>
                            </>
                        ) : (
                            <div className="modal-actions">
                                <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                                <button className="btn btn-danger" onClick={commit} disabled={committing}>{committing ? 'Rebuilding…' : 'Commit changes'}</button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

/* Admin: reconcile the client list against an uploaded alarm-audit .xlsx.
   Match by customer number; preview first; protected (monitored/labeled) clients kept. */
function AuditModal({ onClose, onDone }) {
    const [file, setFile]             = useState(null);
    const [preview, setPreview]       = useState(null);
    const [loading, setLoading]       = useState(false);
    const [committing, setCommitting] = useState(false);
    const [error, setError]           = useState('');
    const [result, setResult]         = useState(null);

    async function send(commit) {
        if (!file) { setError('Choose the audit .xlsx first.'); return; }
        const fd = new FormData();
        fd.append('file', file);
        fd.append('commit', commit ? 'true' : 'false');
        if (commit) setCommitting(true); else setLoading(true);
        setError('');
        try {
            const { data } = await api.post('/clients/rebuild-from-audit', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
            if (commit) { setResult(data); onDone(); } else { setPreview(data); }
        } catch (e) { setError(e.response?.data?.error || 'Failed.'); }
        finally { setLoading(false); setCommitting(false); }
    }

    function pick(e) {
        setFile(e.target.files?.[0] || null);
        setPreview(null); setResult(null); setError('');
    }

    async function commit() {
        if (!confirm(`Add ${preview.to_add.length} client(s) and remove ${preview.to_remove.length}? Protected (monitored / fire-alarm-access) clients are kept. This cannot be undone.`)) return;
        await send(true);
    }

    const box = { maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 4, padding: 8, fontSize: 12 };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 640, width: '100%' }}>
                <div className="modal-title">Rebuild Client List from Audit</div>
                {error && <div className="error-msg">{error}</div>}

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                    <input type="file" accept=".xlsx,.xls" onChange={pick} />
                    <button className="btn btn-ghost" onClick={() => send(false)} disabled={!file || loading}>{loading ? 'Reading…' : 'Preview'}</button>
                </div>

                {preview && (
                    <>
                        <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                            {preview.audit_count} customer(s) across {preview.sheets_used.length} sheet(s). {preview.matched_count} already match; {preview.protected_count} protected client(s) kept (monitored or labeled).
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
                            <div>
                                <div className="alarm-label" style={{ marginBottom: 6 }}>Add ({preview.to_add.length})</div>
                                <div style={box}>
                                    {preview.to_add.length === 0 ? <span style={{ color: 'var(--text-dim)' }}>None</span> :
                                        preview.to_add.map((n, i) => <div key={i} style={{ color: 'var(--green)' }}>+ {n}</div>)}
                                </div>
                            </div>
                            <div>
                                <div className="alarm-label" style={{ marginBottom: 6 }}>Remove ({preview.to_remove.length})</div>
                                <div style={box}>
                                    {preview.to_remove.length === 0 ? <span style={{ color: 'var(--text-dim)' }}>None</span> :
                                        preview.to_remove.map(c => <div key={c.id} style={{ color: 'var(--red)' }}>− {c.name} <span style={{ color: 'var(--text-dim)' }}>({c.customer_id})</span></div>)}
                                </div>
                            </div>
                        </div>
                        {result ? (
                            <>
                                <div style={{ marginTop: 12, color: 'var(--green)', fontSize: 13 }}>Done — added {result.added}, removed {result.removed}.</div>
                                <div className="modal-actions"><button className="btn btn-primary" onClick={onClose}>Close</button></div>
                            </>
                        ) : (
                            <div className="modal-actions">
                                <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                                <button className="btn btn-danger" onClick={commit} disabled={committing}>{committing ? 'Applying…' : 'Commit changes'}</button>
                            </div>
                        )}
                    </>
                )}
                {!preview && (
                    <div className="modal-actions"><button className="btn btn-ghost" onClick={onClose}>Cancel</button></div>
                )}
            </div>
        </div>
    );
}

/* Admin: remove clients whose invoice folder hasn't been touched in 3 years.
   Preview first; monitored/typed clients are protected. */
function PruneModal({ onClose, onDone }) {
    const [preview, setPreview]       = useState(null);
    const [loading, setLoading]       = useState(true);
    const [committing, setCommitting] = useState(false);
    const [error, setError]           = useState('');
    const [result, setResult]         = useState(null);

    useEffect(() => {
        api.post('/clients/prune-inactive', { commit: false })
            .then(r => setPreview(r.data))
            .catch(e => setError(e.response?.data?.error || 'Failed to read the drive.'))
            .finally(() => setLoading(false));
    }, []);

    async function commit() {
        if (!confirm(`Permanently remove ${preview.to_remove.length} inactive client(s)? This cannot be undone.`)) return;
        setCommitting(true); setError('');
        try { const { data } = await api.post('/clients/prune-inactive', { commit: true }); setResult(data); onDone(); }
        catch (e) { setError(e.response?.data?.error || 'Prune failed.'); }
        finally { setCommitting(false); }
    }

    const box = { maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 4, padding: 8, fontSize: 12 };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560, width: '100%' }}>
                <div className="modal-title">Prune Inactive Clients (3yr)</div>
                {error && <div className="error-msg">{error}</div>}
                {loading ? (
                    <p style={{ color: 'var(--text-dim)' }}>Checking invoice activity…</p>
                ) : preview && (
                    <>
                        <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                            Examined {preview.examined} client(s); {preview.protected_count} protected (monitored or typed) and kept.
                            Removing those with no invoice modified in 3 years.
                        </p>
                        <div className="alarm-label" style={{ margin: '8px 0 6px' }}>Remove ({preview.to_remove.length})</div>
                        <div style={box}>
                            {preview.to_remove.length === 0 ? <span style={{ color: 'var(--text-dim)' }}>None — nothing to prune.</span> :
                                preview.to_remove.map(c => <div key={c.id} style={{ color: 'var(--red)' }}>− {c.customer_id ? `${c.customer_id} ` : ''}{c.name}</div>)}
                        </div>
                        {result ? (
                            <>
                                <div style={{ marginTop: 12, color: 'var(--green)', fontSize: 13 }}>Done — removed {result.removed}.</div>
                                <div className="modal-actions"><button className="btn btn-primary" onClick={onClose}>Close</button></div>
                            </>
                        ) : (
                            <div className="modal-actions">
                                <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                                <button className="btn btn-danger" onClick={commit} disabled={committing || preview.to_remove.length === 0}>{committing ? 'Pruning…' : 'Remove inactive'}</button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

/* A customer's billing anchor + monitored panels share a customer_number.
   Group them so multi-location customers (The Pharm, PAL, GG&D…) collapse into
   one expandable roll-up card instead of a wall of near-duplicate tiles. */
function groupClients(list) {
    const map = new Map();
    for (const c of list) {
        /* A manual rollup wins over the automatic customer_number grouping. */
        const key = c.rollup_id
            ? `rollup:${c.rollup_id}`
            : (c.customer_number && String(c.customer_number).trim()) || c.customer_id || `id:${c.id}`;
        let g = map.get(key);
        if (!g) { g = { key, name: '', rows: [], services: new Set(), rollup: null }; map.set(key, g); }
        g.rows.push(c);
        if (c.rollup_id) g.rollup = c.rollup_name || 'Rollup';
        (c.services || []).forEach(s => g.services.add(s));
    }
    for (const g of map.values()) {
        g.rows.sort((a, b) => (a.services || []).length - (b.services || []).length);   // umbrella (no labels) first
        const umb = g.rows.find(r => !(r.services || []).length) || g.rows[0];
        /* Named manual rollups show their own name; auto groups use the umbrella client's. */
        g.name = g.rollup || (String(umb.name || '').replace(/\s*:\s*Billing\s*$/i, '').trim() || umb.name);
        g.services = [...g.services];
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export default function Alarms() {
    const { user }                          = useAuth();
    const [clients, setClients]             = useState([]);
    const [selected, setSelected]           = useState(null);
    const [serviceTab, setServiceTab]       = useState('all');
    const [search, setSearch]               = useState('');
    const [technicians, setTechnicians]     = useState([]);
    const [loading, setLoading]             = useState(true);
    const [showAddClient, setShowAddClient] = useState(false);
    const [expanded, setExpanded]           = useState(() => new Set());   // expanded customer roll-up groups

    const [unmon,        setUnmon]        = useState([]);
    const [unmonLoading, setUnmonLoading] = useState(false);
    const [importMsg,    setImportMsg]    = useState('');
    const [importing,    setImporting]    = useState(false);
    const [rollups,      setRollups]      = useState([]);
    const [projImportMsg, setProjImportMsg] = useState('');
    const [projImporting, setProjImporting] = useState(false);

    const loadRollups = () => api.get('/clients/rollups').then(r => setRollups(r.data)).catch(() => {});

    function fetchClients() {
        setLoading(true);
        const params = {};
        if (serviceTab === 'projects')    params.category = 'project';
        else if (serviceTab !== 'all')    params.service  = serviceTab;
        if (search) params.search = search;
        api.get('/clients', { params })
            .then(r => setClients(r.data))
            .finally(() => setLoading(false));
    }

    useEffect(() => {
        api.get('/admin/technicians').then(r => setTechnicians(r.data)).catch(() => {});
        loadRollups();
    }, []);

    useEffect(() => {
        if (serviceTab === 'unmonitored') loadUnmonitored();
        else                              fetchClients();
    }, [serviceTab, search]);

    async function openClient(c) {
        const r = await api.get(`/clients/${c.id}`);
        setSelected(r.data);
    }

    function toggleGroup(key) {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    }

    async function refreshSelected() {
        if (!selected) return;
        const r = await api.get(`/clients/${selected.id}`);
        setSelected(r.data);
        fetchClients();
    }

    function loadUnmonitored() {
        setUnmonLoading(true);
        api.get('/clients/unmonitored')
            .then(r => setUnmon(r.data))
            .catch(() => setUnmon([]))
            .finally(() => setUnmonLoading(false));
    }

    async function uploadQuickbooks(e) {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        setImporting(true); setImportMsg('');
        const fd = new FormData();
        files.forEach(f => fd.append('files', f));
        try {
            const { data } = await api.post('/clients/import-quickbooks', fd, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            const txBits = (data.tx_added > 0 || data.tx_updated > 0)
                ? ` · ${data.tx_added} new${data.tx_updated > 0 ? `, ${data.tx_updated} refreshed` : ''} transactions (${data.tx_matched} to ${data.clients_matched} clients, ${data.tx_unmonitored} unmonitored)`
                : '';
            setImportMsg(`${data.qb_customers} customers${txBits} · ${data.added} new unmonitored · ${data.total} total`);
            loadUnmonitored();
        } catch (err) {
            setImportMsg(err.response?.data?.error || 'Import failed.');
        } finally {
            setImporting(false);
            e.target.value = '';
        }
    }

    async function dismissUnmonitored(id) {
        await api.delete(`/clients/unmonitored/${id}`);
        setUnmon(prev => prev.filter(u => u.id !== id));
    }

    /* Import install-only "project" clients from the QuickBooks active-customer
       CSV. Existing/monitored customers (matched by Account No. or name) are
       skipped server-side. */
    async function importProjects(e) {
        const file = (e.target.files || [])[0];
        if (!file) return;
        setProjImporting(true); setProjImportMsg('');
        const fd = new FormData();
        fd.append('file', file);
        try {
            const { data } = await api.post('/clients/import-projects', fd, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            setProjImportMsg(`Imported ${data.created} project client(s) · ${data.skipped_existing} already tracked · ${data.skipped_junk} skipped.`);
            fetchClients();
        } catch (err) {
            setProjImportMsg(err.response?.data?.error || 'Import failed.');
        } finally {
            setProjImporting(false);
            e.target.value = '';
        }
    }

    return (
        <Layout>
            <div className="alarm-page">
                <div className="alarm-page-header">
                    <h1 className="page-title">Clients<PageHelp id="clients" /></h1>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <input
                            className="alarm-search"
                            placeholder="Search clients…"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                        {user.role === 'admin' && (
                            <>
                                <button className="btn btn-primary" onClick={() => setShowAddClient(true)}>
                                    + Add Client
                                </button>
                            </>
                        )}
                    </div>
                </div>

                <div className="alarm-service-tabs">
                    {SERVICE_TABS.map(t => (
                        <button
                            key={t}
                            className={`alarm-tab ${serviceTab === t ? 'active' : ''}`}
                            onClick={() => setServiceTab(t)}
                        >
                            {t === 'all' ? 'All' : SERVICE_LABEL[t] || t.charAt(0).toUpperCase() + t.slice(1)}
                            {t !== 'unmonitored' && t !== 'projects' && (
                                <span className="alarm-tab-count">
                                    {t === 'all' ? clients.length : clients.filter(c => (c.services || []).includes(t)).length}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Unmonitored clients (from QuickBooks) */}
                {serviceTab === 'unmonitored' && (
                    <div className="permit-report">
                        {user.role === 'admin' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
                                <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
                                    {importing ? 'Importing…' : 'Upload QuickBooks CSVs'}
                                    <input type="file" accept=".csv" multiple hidden disabled={importing} onChange={uploadQuickbooks} />
                                </label>
                                {importMsg && <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>{importMsg}</span>}
                            </div>
                        )}
                        {unmonLoading ? (
                            <div className="alarm-empty">Loading…</div>
                        ) : (
                            <div className="table-card">
                                <table className="data-table">
                                    <thead><tr><th>Customer</th><th>First seen</th><th></th></tr></thead>
                                    <tbody>
                                        {unmon.length === 0 && (
                                            <tr><td colSpan={3} className="alarm-empty">No unmonitored clients yet. Upload QuickBooks CSV exports to populate this list.</td></tr>
                                        )}
                                        {unmon.map(u => (
                                            <tr key={u.id}>
                                                <td style={{ fontWeight: 500, color: 'var(--text-hi)' }}>{u.name}</td>
                                                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>{new Date(u.first_seen).toLocaleDateString()}</td>
                                                <td style={{ textAlign: 'right' }}>
                                                    {user.role === 'admin' && (
                                                        <button className="btn btn-ghost" style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => dismissUnmonitored(u.id)}>Dismiss</button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* Project-clients import (install-only, non-monitored) */}
                {serviceTab === 'projects' && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                        <div style={{ fontSize: 12, color: 'var(--text-dim)', flex: 1, minWidth: 200 }}>
                            Install-only clients we don’t monitor. {user.role === 'admin' && 'Import the QuickBooks active-customer list — already-tracked customers are skipped.'}
                        </div>
                        {user.role === 'admin' && (
                            <label className="btn btn-primary" style={{ cursor: projImporting ? 'default' : 'pointer', opacity: projImporting ? 0.7 : 1 }}>
                                {projImporting ? 'Importing…' : 'Import Project Clients (CSV)'}
                                <input type="file" accept=".csv,.xlsx" hidden disabled={projImporting} onChange={importProjects} />
                            </label>
                        )}
                        {projImportMsg && <span style={{ fontSize: 12, color: 'var(--text-dim)', width: '100%' }}>{projImportMsg}</span>}
                    </div>
                )}

                {serviceTab !== 'unmonitored' && loading ? (
                    <div className="alarm-empty">Loading…</div>
                ) : serviceTab !== 'unmonitored' && (
                    <div className="alarm-client-grid">
                        {clients.length === 0 && <div className="alarm-empty">No clients found.</div>}
                        {groupClients(clients).map(g => {
                            /* Single row → an ordinary client card. */
                            if (g.rows.length === 1) {
                                const c = g.rows[0];
                                return (
                                    <div key={c.id} className="alarm-client-card" onClick={() => openClient(c)}>
                                        <div className="alarm-client-name">{c.name}</div>
                                        <div className="alarm-client-meta">
                                            <span className="tag-dim">{c.customer_id}</span>
                                            {(c.services || []).map(s => (
                                                <span key={s} className={svcClass(s)}>{SERVICE_LABEL[s] || s}</span>
                                            ))}
                                            {c.monitoring_enabled && <span className="tag-green">monitored</span>}
                                        </div>
                                    </div>
                                );
                            }
                            /* Multi-location customer → one expandable roll-up card. */
                            const isOpen = expanded.has(g.key);
                            const monCnt = g.rows.filter(r => r.monitoring_enabled).length;
                            return (
                                <div key={g.key} className="alarm-client-card" style={{ gridColumn: '1 / -1' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => toggleGroup(g.key)}>
                                        <span style={{ color: 'var(--text-dim)', width: 12, flexShrink: 0 }}>{isOpen ? '▾' : '▸'}</span>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div className="alarm-client-name">{g.name}</div>
                                            <div className="alarm-client-meta">
                                                {g.rollup ? <span className="tag-blue">Multi-Location</span> : <span className="tag-dim">{g.key}</span>}
                                                <span className="tag-blue">{g.rows.length} {g.rollup ? 'locations' : 'panels'}</span>
                                                {g.services.map(s => <span key={s} className={svcClass(s)}>{SERVICE_LABEL[s] || s}</span>)}
                                                {monCnt > 0 && <span className="tag-green">{monCnt} monitored</span>}
                                            </div>
                                        </div>
                                    </div>
                                    {isOpen && (
                                        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                            {g.rows.map(c => (
                                                <div key={c.id} onClick={() => openClient(c)}
                                                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 4, cursor: 'pointer', background: 'rgba(255,255,255,0.03)' }}>
                                                    <span style={{ flex: 1, minWidth: 0, color: 'var(--text-hi)', fontSize: 13 }}>{c.name}</span>
                                                    <span className="tag-dim" style={{ fontSize: 11 }}>{c.customer_id}</span>
                                                    {(c.services || []).map(s => <span key={s} className={svcClass(s)}>{s}</span>)}
                                                    {c.monitoring_enabled && <span className="tag-green">monitored</span>}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {selected && (
                    <ClientDetail
                        client={selected}
                        onClose={() => setSelected(null)}
                        onRefresh={refreshSelected}
                        technicians={technicians}
                        rollups={rollups}
                        reloadRollups={loadRollups}
                    />
                )}
                {showAddClient && (
                    <NewClientModal
                        onClose={() => setShowAddClient(false)}
                        onCreated={() => { setShowAddClient(false); fetchClients(); }}
                    />
                )}
            </div>
        </Layout>
    );
}
