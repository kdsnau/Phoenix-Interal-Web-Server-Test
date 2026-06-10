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
    cameraDisconnectEvent:  { label: 'Camera Offline',  cls: 'tag-red'    },
    networkIssueEvent:      { label: 'Network Issue',   cls: 'tag-red'    },
    cameraIpConflictEvent:  { label: 'IP Conflict',     cls: 'tag-red'    },
    storageFailureEvent:    { label: 'Storage Failure', cls: 'tag-red'    },
    serverFailureEvent:     { label: 'Server Failure',  cls: 'tag-red'    },
    serverConflictEvent:    { label: 'Server Conflict', cls: 'tag-red'    },
    licenseIssueEvent:      { label: 'License Issue',   cls: 'tag-red'    },
    cameraMotionEvent:      { label: 'Motion',          cls: 'tag-yellow' },
    cameraInputEvent:       { label: 'Input',           cls: 'tag-yellow' },
    softwareTriggerEvent:   { label: 'Soft Trigger',    cls: 'tag-yellow' },
    analyticsSdkEvent:      { label: 'Analytics',       cls: 'tag-yellow' },
    userDefinedEvent:       { label: 'Custom',          cls: 'tag-dim'    },
    serverStartEvent:       { label: 'Server Started',  cls: 'tag-green'  },
    backupFinishedEvent:    { label: 'Backup Done',     cls: 'tag-green'  },
};

/* Known Nx event types get a label+color; unknown ones are humanized
   ("poeOverBudgetEvent" -> "Poe Over Budget"). */
function eventTag(type) {
    const t = EVENT_TYPE_LABELS[type];
    if (t) return t;
    if (!type) return { label: 'Event', cls: 'tag-dim' };
    const label = type
        .replace(/Event$/, '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/^./, c => c.toUpperCase());
    return { label, cls: 'tag-dim' };
}

/* Pull a clean host out of a pasted address like
   "http://192.168.10.43:80/onvif/device_service" -> { host, port, https }.
   Protocol and any /path are removed; host:port is split apart. */
function parseHostAddress(raw) {
    let s = (raw || '').trim();
    if (!s) return null;
    let https = null;
    const proto = s.match(/^(https?):\/\//i);
    if (proto) { https = proto[1].toLowerCase() === 'https'; s = s.slice(proto[0].length); }
    s = s.split(/[/?#]/)[0];                 // drop path / query / hash
    let port = null;
    const hp = s.match(/^(.+):(\d{1,5})$/);
    if (hp) { s = hp[1]; port = hp[2]; }
    return { host: s.trim(), port, https };
}

/* Lighter cleanup for typing: strip protocol + path, keep the rest. */
function stripUrlNoise(raw) {
    return (raw || '').replace(/^\s*https?:\/\//i, '').split(/[/?#]/)[0];
}

/* ── Add / Edit server modal ──────────────────────────────────────────── */
function ServerModal({ existing, onClose, onSaved }) {
    const blank = {
        name: '', host: '', port: '', use_https: false, username: '', password: '',
        client_id: '', mock: false,
        conn_type: 'direct', cloud_system_id: '',
        cloud_host: 'https://dwspectrum.digital-watchdog.com', cloud_user: '', cloud_password: '',
    };
    const [form,    setForm]    = useState(existing ? { ...blank, ...existing, password: '', cloud_password: '' } : blank);
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
            if (existing && !payload.cloud_password) delete payload.cloud_password;
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
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460, width: '100%' }}>
                <div className="modal-title">{existing ? 'Edit NVR System' : 'Add NVR System'}</div>
                {error && <div className="error-msg">{error}</div>}
                <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                    <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Display Name *</label>
                        <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Main Office NVR" required autoFocus />
                    </div>

                    {/* Connection type — hidden in mock mode */}
                    {!form.mock && (
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Connection</label>
                            <div className="conn-toggle">
                                <button type="button"
                                    className={`conn-opt ${form.conn_type !== 'cloud' ? 'conn-opt--active' : ''}`}
                                    onClick={() => set('conn_type', 'direct')}>Direct (LAN)</button>
                                <button type="button"
                                    className={`conn-opt ${form.conn_type === 'cloud' ? 'conn-opt--active' : ''}`}
                                    onClick={() => set('conn_type', 'cloud')}>DW&nbsp;Cloud</button>
                            </div>
                        </div>
                    )}

                    {/* Direct (LAN) host / credentials */}
                    {!form.mock && form.conn_type !== 'cloud' && (
                        <>
                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
                                <div className="form-group" style={{ margin: 0 }}>
                                    <label className="form-label">Host / IP *</label>
                                    <input
                                        value={form.host}
                                        onChange={e => set('host', stripUrlNoise(e.target.value))}
                                        onPaste={e => {
                                            const text   = e.clipboardData?.getData('text');
                                            const parsed = text && parseHostAddress(text);
                                            if (!parsed || !parsed.host) return;   // nothing useful — allow normal paste
                                            e.preventDefault();
                                            setForm(f => ({
                                                ...f,
                                                host: parsed.host,
                                                ...(parsed.port  != null ? { port: parsed.port } : {}),
                                                ...(parsed.https != null ? { use_https: parsed.https } : {}),
                                            }));
                                        }}
                                        placeholder="192.168.1.100"
                                        required
                                    />
                                </div>
                                <div className="form-group" style={{ margin: 0 }}>
                                    <label className="form-label">Port</label>
                                    <input type="number" value={form.port} onChange={e => set('port', e.target.value)} min="1" max="65535" placeholder="7001" />
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
                        </>
                    )}

                    {/* DW Spectrum Cloud relay */}
                    {!form.mock && form.conn_type === 'cloud' && (
                        <>
                            <div className="form-group" style={{ margin: 0 }}>
                                <label className="form-label">Cloud System ID *</label>
                                <input
                                    value={form.cloud_system_id || ''}
                                    onChange={e => set('cloud_system_id', e.target.value.trim())}
                                    placeholder="2f78b1a4-e226-44ce-89a8-…"
                                    required
                                />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                <div className="form-group" style={{ margin: 0 }}>
                                    <label className="form-label">Cloud Account *</label>
                                    <input value={form.cloud_user || ''} onChange={e => set('cloud_user', e.target.value)} placeholder="service@yourco.com" required />
                                </div>
                                <div className="form-group" style={{ margin: 0 }}>
                                    <label className="form-label">{existing ? 'Password (blank = keep)' : 'Password *'}</label>
                                    <input type="password" value={form.cloud_password || ''} onChange={e => set('cloud_password', e.target.value)} required={!existing} />
                                </div>
                            </div>
                            <div className="form-group" style={{ margin: 0 }}>
                                <label className="form-label">Cloud Host</label>
                                <input value={form.cloud_host || ''} onChange={e => set('cloud_host', e.target.value)} placeholder="https://dwspectrum.digital-watchdog.com" />
                            </div>
                        </>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'center' }}>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Linked Client (optional)</label>
                            <select value={form.client_id || ''} onChange={e => set('client_id', e.target.value)}>
                                <option value="">— None —</option>
                                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 20 }}>
                            {!form.mock && form.conn_type !== 'cloud' && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                                    <input type="checkbox" id="cb-https" checked={form.use_https} onChange={e => set('use_https', e.target.checked)} />
                                    <label htmlFor="cb-https" style={{ cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' }}>Use HTTPS</label>
                                </div>
                            )}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                                <input type="checkbox" id="cb-mock" checked={form.mock} onChange={e => set('mock', e.target.checked)} />
                                <label htmlFor="cb-mock" style={{ cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' }}>Demo / Mock</label>
                            </div>
                        </div>
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

/* ── Live view modal (auto-refreshing snapshot ≈1 fps) ────────────────── */
/* Polls the snapshot once a second via the authed blob fetch. Built so a
   real HLS <video> player can drop into .live-modal-body later. */
function LiveModal({ camera, serverId, onClose }) {
    const [snapUrl, setSnapUrl] = useState(null);
    const [err,     setErr]     = useState(false);

    useEffect(() => {
        let active = true;
        let lastUrl;
        let timer;
        async function tick() {
            try {
                const r = await api.get(
                    `/nvr/servers/${serverId}/snapshot/${encodeURIComponent(camera.id)}`,
                    { responseType: 'blob', params: { height: 720 } }
                );
                if (!active) return;
                const next = URL.createObjectURL(r.data);
                if (lastUrl) URL.revokeObjectURL(lastUrl);
                lastUrl = next;
                setSnapUrl(next);
                setErr(false);
            } catch {
                if (active) setErr(true);
            } finally {
                if (active) timer = setTimeout(tick, 1000);
            }
        }
        tick();
        return () => { active = false; clearTimeout(timer); if (lastUrl) URL.revokeObjectURL(lastUrl); };
    }, [serverId, camera.id]);

    /* Close on Escape */
    useEffect(() => {
        const onKey = e => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="live-modal" onClick={e => e.stopPropagation()}>
                <div className="live-modal-header">
                    <div style={{ minWidth: 0 }}>
                        <div className="live-modal-title" title={camera.name}>{camera.name || 'Camera'}</div>
                        {camera.model && (
                            <div className="live-modal-sub">
                                {camera.vendor ? `${camera.vendor} · ` : ''}{camera.model}
                            </div>
                        )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                        <span className="live-dot" />
                        <span className="live-label">LIVE</span>
                        <button className="live-close" onClick={onClose} aria-label="Close">✕</button>
                    </div>
                </div>
                <div className="live-modal-body">
                    {snapUrl && !err ? (
                        <img src={snapUrl} alt={camera.name} className="live-img" />
                    ) : (
                        <div className="live-placeholder">{err ? 'Feed unavailable' : 'Connecting…'}</div>
                    )}
                </div>
                <div className="live-modal-foot">Live snapshot · refreshing ~1/sec · press Esc to close</div>
            </div>
        </div>
    );
}

/* ── Camera card ──────────────────────────────────────────────────────── */
function CameraCard({ camera, serverId }) {
    const [imgError, setImgError] = useState(false);
    const [snapUrl,  setSnapUrl]  = useState(null);
    const [open,     setOpen]     = useState(false);
    const status   = (camera.status?.toString() || '').toLowerCase();
    const online   = status.includes('online') || status.includes('recording');
    const tagClass = online ? 'tag-green' : 'tag-red';
    const tagLabel = online ? 'Online' : (status || 'Offline');

    /* An <img src=…> can't send the JWT Authorization header, so the snapshot
       endpoint 401s when loaded directly. Fetch it through axios (which
       attaches the token) and hand the <img> an object URL instead. */
    useEffect(() => {
        if (!online) return undefined;
        let objUrl;
        let cancelled = false;
        api.get(`/nvr/servers/${serverId}/snapshot/${encodeURIComponent(camera.id)}`, { responseType: 'blob' })
            .then(r => {
                if (cancelled) return;
                objUrl = URL.createObjectURL(r.data);
                setSnapUrl(objUrl);
            })
            .catch(() => { if (!cancelled) setImgError(true); });
        return () => { cancelled = true; if (objUrl) URL.revokeObjectURL(objUrl); };
    }, [serverId, camera.id, online]);

    return (
        <>
        <div
            className={`cam-card ${online ? 'cam-card--live' : 'cam-card--offline'}`}
            onClick={() => online && setOpen(true)}
            title={online ? 'Click for live view' : undefined}
        >
            <div className="cam-snapshot">
                {online && snapUrl && !imgError ? (
                    <img src={snapUrl} alt={camera.name} onError={() => setImgError(true)} />
                ) : (
                    <div className="cam-snapshot-placeholder">
                        {!online ? 'Offline' : imgError ? 'No Feed' : 'Loading…'}
                    </div>
                )}
            </div>
            <div className="cam-info">
                <div className="cam-name" title={camera.name}>{camera.name || 'Unnamed Camera'}</div>
                {camera.model && (
                    <div className="cam-model" title={camera.vendor ? `${camera.vendor} ${camera.model}` : camera.model}>
                        {camera.model}
                    </div>
                )}
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                    <span className={`tag ${tagClass}`} style={{ fontSize: 10 }}>{tagLabel}</span>
                    {camera.isLicensed === false && (
                        <span className="tag tag-red" style={{ fontSize: 10 }}>Unlicensed</span>
                    )}
                    {camera.isLicensed === true && (
                        <span className="tag tag-dim" style={{ fontSize: 10 }}>Licensed</span>
                    )}
                </div>
            </div>
        </div>
        {open && <LiveModal camera={camera} serverId={serverId} onClose={() => setOpen(false)} />}
        </>
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
    const [licenses, setLicenses]           = useState([]);
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
            const [devRes, licRes] = await Promise.all([
                api.get(`/nvr/servers/${server.id}/devices`),
                api.get(`/nvr/servers/${server.id}/licenses`).catch(() => ({ data: [] })),
            ]);
            setDevices(Array.isArray(devRes.data) ? devRes.data : (devRes.data?.data || []));
            setLicenses(Array.isArray(licRes.data) ? licRes.data : []);
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
                <div className="nvr-panel-name">
                    {server.name}
                    {server.mock && <span className="tag tag-dim" style={{ fontSize: 10, marginLeft: 8, verticalAlign: 'middle' }}>MOCK</span>}
                </div>

                <div className="nvr-panel-meta">
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>
                        {server.conn_type === 'cloud'
                            ? `cloud · ${(server.cloud_system_id || '').slice(0, 8)}…`
                            : `${server.use_https ? 'https' : 'http'}://${server.host}:${server.port}`}
                    </span>

                    {/* Client badge — clickable, navigates to Clients page */}
                    {server.client_name && (
                        <button
                            className="tag tag-blue nvr-client-badge"
                            onClick={e => { e.stopPropagation(); navigate('/clients', { state: { openClientId: server.client_id } }); }}
                            title={`View ${server.client_name} in Clients`}
                        >
                            {server.client_name}
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
                    {licenses.length > 0 && (() => {
                        const total = licenses.reduce((s, l) => s + (l.channels || 0), 0);
                        const used  = devices.filter(d => d.isLicensed).length;
                        const cls   = used >= total ? 'tag-red' : used >= total * 0.8 ? 'tag-yellow' : 'tag-dim';
                        return <span className={`tag ${cls}`} style={{ fontSize: 10 }}>{used}/{total} licensed</span>;
                    })()}
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
                            Cameras {devices.length > 0 && `(${devices.length})`}
                        </button>
                        <button
                            className={`nvr-tab ${tab === 'events' ? 'nvr-tab--active' : ''}`}
                            onClick={() => switchTab('events')}
                        >
                            Events
                        </button>
                        <button
                            className={`nvr-tab ${tab === 'licenses' ? 'nvr-tab--active' : ''}`}
                            onClick={() => switchTab('licenses')}
                        >
                            Licenses
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

                    {/* Licenses tab */}
                    {tab === 'licenses' && (
                        <div>
                            {licenses.length === 0 ? (
                                <div className="nvr-loading">No license data available.</div>
                            ) : (
                                <div className="table-card">
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Key</th>
                                                <th>Type</th>
                                                <th>Channels</th>
                                                <th>Used</th>
                                                <th>Expires</th>
                                                <th>Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {licenses.map((lic, idx) => {
                                                const expiring = lic.expirationDate
                                                    ? Math.ceil((new Date(lic.expirationDate) - Date.now()) / 86400000)
                                                    : null;
                                                return (
                                                    <tr key={lic.key || idx}>
                                                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>
                                                            {lic.key || '—'}
                                                        </td>
                                                        <td>
                                                            <span className={`tag ${lic.type === 'trial' ? 'tag-yellow' : 'tag-dim'}`} style={{ fontSize: 10 }}>
                                                                {lic.type || 'unknown'}
                                                            </span>
                                                        </td>
                                                        <td style={{ fontFamily: 'var(--font-mono)' }}>{lic.channels ?? '—'}</td>
                                                        <td style={{ fontFamily: 'var(--font-mono)' }}>{lic.usedChannels ?? '—'}</td>
                                                        <td style={{ fontSize: 12, color: expiring !== null && expiring < 30 ? 'var(--red)' : 'var(--text-dim)' }}>
                                                            {lic.expirationDate
                                                                ? expiring < 0 ? 'Expired' : `${expiring}d`
                                                                : 'Never'}
                                                        </td>
                                                        <td>
                                                            <span className={`tag ${lic.isValid ? 'tag-green' : 'tag-red'}`} style={{ fontSize: 10 }}>
                                                                {lic.isValid ? 'Valid' : 'Invalid'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
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
