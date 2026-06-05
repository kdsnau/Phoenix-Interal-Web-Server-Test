import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import Layout from '../components/Layout';
import './Cameras.css';

/* ── Helpers ──────────────────────────────────────────────────────────── */
function timeAgo(dateStr) {
    if (!dateStr) return '—';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const EVENT_TYPE_LABELS = {
    cameraDisconnected:     { label: 'Camera Offline',    cls: 'tag-red'    },
    cameraIPConflict:       { label: 'IP Conflict',       cls: 'tag-red'    },
    networkIssue:           { label: 'Network Issue',     cls: 'tag-red'    },
    storageFailure:         { label: 'Storage Failure',   cls: 'tag-red'    },
    motionDetected:         { label: 'Motion',            cls: 'tag-yellow' },
    softwareTrigger:        { label: 'Trigger',           cls: 'tag-yellow' },
    cameraReconnected:      { label: 'Camera Online',     cls: 'tag-green'  },
    serverStarted:          { label: 'Server Started',    cls: 'tag-green'  },
    backupFinished:         { label: 'Backup Done',       cls: 'tag-green'  },
};

function eventTag(type) {
    const t = EVENT_TYPE_LABELS[type];
    if (t) return t;
    return { label: type || 'Event', cls: 'tag-dim' };
}

/* ── Add / Edit server modal ──────────────────────────────────────────── */
function ServerModal({ existing, onClose, onSaved }) {
    const blank = { name: '', host: '', port: '7001', use_https: true, username: '', password: '', client_id: '' };
    const [form,    setForm]    = useState(existing ? { ...existing, password: '' } : blank);
    const [error,   setError]   = useState('');
    const [saving,  setSaving]  = useState(false);
    const [clients, setClients] = useState([]);

    useEffect(() => {
        api.get('/clients').then(r => setClients(r.data)).catch(() => {});
    }, []);

    function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

    async function submit(e) {
        e.preventDefault();
        setError('');
        setSaving(true);
        try {
            const payload = {
                ...form,
                port:      Number(form.port) || 7001,
                client_id: form.client_id ? Number(form.client_id) : null,
            };
            if (existing && !payload.password) delete payload.password;
            let data;
            if (existing) {
                ({ data } = await api.patch(`/nvr/servers/${existing.id}`, payload));
            } else {
                ({ data } = await api.post('/nvr/servers', payload));
            }
            onSaved(data);
            onClose();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to save.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
                <div className="modal-title">{existing ? 'Edit NVR System' : 'Add NVR System'}</div>
                {error && <div className="error-msg">{error}</div>}
                <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Display Name *</label>
                        <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Main Office NVR" required autoFocus />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Host / IP *</label>
                            <input value={form.host} onChange={e => set('host', e.target.value)} placeholder="192.168.1.100" required />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Port</label>
                            <input type="number" value={form.port} onChange={e => set('port', e.target.value)} min="1" max="65535" />
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Username *</label>
                            <input value={form.username} onChange={e => set('username', e.target.value)} required />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">{existing ? 'Password (blank = keep)' : 'Password *'}</label>
                            <input type="password" value={form.password} onChange={e => set('password', e.target.value)} required={!existing} />
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'center' }}>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Linked Client (optional)</label>
                            <select value={form.client_id || ''} onChange={e => set('client_id', e.target.value)}>
                                <option value="">— None —</option>
                                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', paddingTop: 20 }}>
                            <input type="checkbox" checked={form.use_https} onChange={e => set('use_https', e.target.checked)} />
                            Use HTTPS
                        </label>
                    </div>
                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>
                            {saving ? 'Saving…' : existing ? 'Save Changes' : 'Add System'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

/* ── Camera card ──────────────────────────────────────────────────────── */
function CameraCard({ camera, serverId }) {
    const [imgError, setImgError] = useState(false);
    const status   = (camera.status?.toString() || '').toLowerCase();
    const online   = status.includes('online') || status.includes('recording');
    const tagClass = online ? 'tag-green' : 'tag-red';
    const tagLabel = online ? 'Online' : (status || 'Offline');

    return (
        <div className={`cam-card ${online ? '' : 'cam-card--offline'}`}>
            <div className="cam-snapshot">
                {!imgError && online ? (
                    <img
                        src={`/api/nvr/servers/${serverId}/snapshot/${camera.id}`}
                        alt={camera.name}
                        onError={() => setImgError(true)}
                    />
                ) : (
                    <div className="cam-snapshot-placeholder">{online ? '📷' : '🚫'}</div>
                )}
            </div>
            <div className="cam-info">
                <div className="cam-name" title={camera.name}>{camera.name || 'Unnamed Camera'}</div>
                {camera.model && <div className="cam-model">{camera.model}</div>}
                <span className={`tag ${tagClass}`} style={{ fontSize: 10 }}>{tagLabel}</span>
            </div>
        </div>
    );
}

/* ── Events log ───────────────────────────────────────────────────────── */
function EventsLog({ serverId, devices }) {
    const [events,  setEvents]  = useState([]);
    const [loading, setLoading] = useState(true);
    const [error,   setError]   = useState('');

    /* Build a quick id→name map from the device list if available */
    const deviceMap = {};
    (devices || []).forEach(d => { deviceMap[d.id] = d.name; });

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const { data } = await api.get(`/nvr/servers/${serverId}/events`, { params: { limit: 100 } });
            const list = Array.isArray(data) ? data : (data?.data || data?.events || []);
            setEvents(list);
        } catch (err) {
            setError(err.response?.data?.error || 'Could not load events.');
        } finally {
            setLoading(false);
        }
    }, [serverId]);

    useEffect(() => { load(); }, [load]);

    if (loading) return <div className="nvr-loading">Loading events…</div>;
    if (error)   return <div style={{ color: 'var(--red)', fontSize: 13, padding: '12px 0' }}>{error}</div>;
    if (events.length === 0) return <div className="nvr-loading">No recent events.</div>;

    return (
        <div className="events-list">
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 10px' }} onClick={load}>
                    ↻ Refresh
                </button>
            </div>
            {events.map((ev, i) => {
                const { label, cls } = eventTag(ev.eventType || ev.type);
                const camName = deviceMap[ev.deviceId] || ev.deviceName || ev.caption || '—';
                const ts      = ev.eventTimestampUsec
                    ? timeAgo(new Date(ev.eventTimestampUsec / 1000).toISOString())
                    : timeAgo(ev.createdAt || ev.timestamp);
                return (
                    <div key={ev.id || i} className="event-row">
                        <span className={`tag ${cls}`} style={{ fontSize: 10, flexShrink: 0 }}>{label}</span>
                        <span className="event-camera">{camName}</span>
                        {ev.description && (
                            <span className="event-desc">{ev.description}</span>
                        )}
                        <span className="event-time">{ts}</span>
                    </div>
                );
            })}
        </div>
    );
}

/* ── Server panel ─────────────────────────────────────────────────────── */
function ServerPanel({ server, onEdit, onDelete }) {
    const { user }                          = useAuth();
    const navigate                          = useNavigate();
    const [expanded, setExpanded]           = useState(false);
    const [tab,      setTab]                = useState('cameras'); // 'cameras' | 'events'
    const [ping,     setPing]               = useState(null);
    const [devices,  setDevices]            = useState([]);
    const [loadingDevices, setLoadingDevices] = useState(false);
    const [devError, setDevError]           = useState('');

    /* Ping on mount */
    useEffect(() => {
        api.get(`/nvr/servers/${server.id}/ping`)
            .then(r => setPing(r.data))
            .catch(() => setPing({ online: false }));
    }, [server.id]);

    async function loadDevices() {
        if (devices.length > 0) return;
        setLoadingDevices(true);
        setDevError('');
        try {
            const { data } = await api.get(`/nvr/servers/${server.id}/devices`);
            setDevices(Array.isArray(data) ? data : (data?.data || []));
        } catch (err) {
            setDevError(err.response?.data?.error || 'Could not load cameras.');
        } finally {
            setLoadingDevices(false);
        }
    }

    async function expand() {
        if (expanded) { setExpanded(false); return; }
        setExpanded(true);
        await loadDevices();
    }

    function switchTab(t) {
        setTab(t);
        if (t === 'cameras') loadDevices();
    }

    const online = ping?.online;

    /* Stats derived from device list */
    const onlineCount  = devices.filter(d => {
        const s = (d.status?.toString() || '').toLowerCase();
        return s.includes('online') || s.includes('recording');
    }).length;
    const offlineCount = devices.length - onlineCount;

    return (
        <div className="nvr-panel">
            {/* ── Header ── */}
            <div className="nvr-panel-header" onClick={expand}>
                <div
                    className="nvr-status-dot"
                    style={{ background: ping === null ? 'var(--text-dim)' : online ? 'var(--green)' : 'var(--red)' }}
                />
                <div className="nvr-panel-name">{server.name}</div>

                <div className="nvr-panel-meta">
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>
                        {server.use_https ? 'https' : 'http'}://{server.host}:{server.port}
                    </span>

                    {/* Client badge — clickable, navigates to Alarms page */}
                    {server.client_name && (
                        <button
                            className="tag tag-blue nvr-client-badge"
                            onClick={e => { e.stopPropagation(); navigate('/alarms', { state: { openClientId: server.client_id } }); }}
                            title={`View ${server.client_name} in Alarms`}
                        >
                            🏢 {server.client_name}
                        </button>
                    )}

                    {ping !== null && (
                        <span className={`tag ${online ? 'tag-green' : 'tag-red'}`} style={{ fontSize: 10 }}>
                            {online ? 'Reachable' : 'Unreachable'}
                        </span>
                    )}

                    {devices.length > 0 && (
                        <>
                            <span className="tag tag-green" style={{ fontSize: 10 }}>{onlineCount} online</span>
                            {offlineCount > 0 && <span className="tag tag-red" style={{ fontSize: 10 }}>{offlineCount} offline</span>}
                        </>
                    )}
                </div>

                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                    {user.role === 'admin' && (
                        <>
                            <button
                                className="btn btn-ghost"
                                style={{ fontSize: 11, padding: '3px 10px' }}
                                onClick={e => { e.stopPropagation(); onEdit(server); }}
                            >Edit</button>
                            <button
                                className="btn btn-danger"
                                style={{ fontSize: 11, padding: '3px 10px' }}
                                onClick={e => { e.stopPropagation(); onDelete(server.id); }}
                            >Remove</button>
                        </>
                    )}
                    <span style={{ color: 'var(--text-dim)', fontSize: 14 }}>{expanded ? '▲' : '▼'}</span>
                </div>
            </div>

            {/* ── Expanded body ── */}
            {expanded && (
                <div className="nvr-panel-body">
                    {/* Tabs */}
                    <div className="nvr-tabs">
                        <button
                            className={`nvr-tab ${tab === 'cameras' ? 'nvr-tab--active' : ''}`}
                            onClick={() => switchTab('cameras')}
                        >
                            📷 Cameras {devices.length > 0 && `(${devices.length})`}
                        </button>
                        <button
                            className={`nvr-tab ${tab === 'events' ? 'nvr-tab--active' : ''}`}
                            onClick={() => switchTab('events')}
                        >
                            🔔 Events
                        </button>
                    </div>

                    {/* Cameras tab */}
                    {tab === 'cameras' && (
                        <>
                            {loadingDevices && <div className="nvr-loading">Loading cameras…</div>}
                            {devError && <div style={{ color: 'var(--red)', fontSize: 13, padding: '12px 0' }}>{devError}</div>}
                            {!loadingDevices && !devError && devices.length === 0 && (
                                <div className="nvr-loading">No cameras found.</div>
                            )}
                            {!loadingDevices && devices.length > 0 && (
                                <div className="cam-grid">
                                    {devices.map(cam => (
                                        <CameraCard key={cam.id} camera={cam} serverId={server.id} />
                                    ))}
                                </div>
                            )}
                        </>
                    )}

                    {/* Events tab */}
                    {tab === 'events' && (
                        <EventsLog serverId={server.id} devices={devices} />
                    )}
                </div>
            )}
        </div>
    );
}

/* ── Main page ────────────────────────────────────────────────────────── */
export default function Cameras() {
    const { user }                          = useAuth();
    const [servers,    setServers]          = useState([]);
    const [loading,    setLoading]          = useState(true);
    const [showModal,  setShowModal]        = useState(false);
    const [editTarget, setEditTarget]       = useState(null);

    useEffect(() => {
        api.get('/nvr/servers')
            .then(r => setServers(r.data))
            .finally(() => setLoading(false));
    }, []);

    function handleSaved(server) {
        setServers(prev => {
            const exists = prev.find(s => s.id === server.id);
            return exists
                ? prev.map(s => s.id === server.id ? { ...s, ...server } : s)
                : [...prev, server];
        });
    }

    async function handleDelete(id) {
        if (!confirm('Remove this NVR system?')) return;
        await api.delete(`/nvr/servers/${id}`);
        setServers(prev => prev.filter(s => s.id !== id));
    }

    function openEdit(server) { setEditTarget(server); setShowModal(true); }
    function openAdd()        { setEditTarget(null);   setShowModal(true); }

    return (
        <Layout>
            <div className="page-header">
                <h1 className="page-title">
                    Camera Systems
                    <span>{servers.length} system{servers.length !== 1 ? 's' : ''}</span>
                </h1>
                {user.role === 'admin' && (
                    <button className="btn btn-primary" onClick={openAdd}>+ Add System</button>
                )}
            </div>

            {loading && <p style={{ color: 'var(--text-dim)' }}>Loading…</p>}

            {!loading && servers.length === 0 && (
                <div className="nvr-empty">
                    <div style={{ fontSize: 32, marginBottom: 12 }}>📷</div>
                    <div>No NVR systems connected yet.</div>
                    {user.role === 'admin' && (
                        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={openAdd}>
                            + Add First System
                        </button>
                    )}
                </div>
            )}

            {!loading && servers.length > 0 && (
                <div className="nvr-list">
                    {servers.map(s => (
                        <ServerPanel
                            key={s.id}
                            server={s}
                            onEdit={openEdit}
                            onDelete={handleDelete}
                        />
                    ))}
                </div>
            )}

            {showModal && (
                <ServerModal
                    existing={editTarget}
                    onClose={() => setShowModal(false)}
                    onSaved={handleSaved}
                />
            )}
        </Layout>
    );
}
