import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/client';
import Layout from '../components/Layout';
import PageHelp from '../components/PageHelp';
import RoleBadge from '../components/RoleBadge';
import useRoles from '../hooks/useRoles';
import { useAuth } from '../context/AuthContext';

const STATUS_TAG = {
    open:        'tag-yellow',
    in_progress: 'tag-blue',
    resolved:    'tag-green',
    closed:      'tag-dim',
};

const TICKET_TYPES = ['Service', 'Service Warranty', 'Maintenance', 'Open Work Order', 'Errand', 'Bid (Site Walks)'];

function fmt(ts, opts) {
    if (!ts) return null;
    return new Date(ts).toLocaleString('en-US', opts);
}

const DATE_OPTS  = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
const TIME_OPTS  = { hour: 'numeric', minute: '2-digit' };

/* Searchable inventory picker. Collapses to a single search box; the results
   list only renders while you're typing, so it doesn't bloat the modal. */
function InventoryItemPicker({ inv, exclude = [], onPick, placeholder = 'Search inventory…' }) {
    const [q, setQ] = useState('');
    const list = inv
        .filter(i => !exclude.includes(i.id))
        .filter(i => {
            const s = q.toLowerCase();
            return i.name.toLowerCase().includes(s) || (i.sku || '').toLowerCase().includes(s);
        })
        .slice(0, 40);
    return (
        <div>
            <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder={placeholder}
                style={{ width: '100%' }}
            />
            {q && (
                <div style={{ border: '1px solid var(--border)', borderRadius: 4, marginTop: 6, maxHeight: 180, overflowY: 'auto' }}>
                    {list.length === 0 && (
                        <div style={{ padding: 10, color: 'var(--text-dim)', fontSize: 13 }}>No matching items.</div>
                    )}
                    {list.map(i => (
                        <button
                            type="button"
                            key={i.id}
                            onClick={() => { onPick(i); setQ(''); }}
                            style={{
                                display: 'flex', justifyContent: 'space-between', gap: 10, width: '100%',
                                textAlign: 'left', background: 'none', border: 'none',
                                borderBottom: '1px solid var(--border)', color: 'var(--text)',
                                padding: '8px 10px', fontSize: 12, cursor: 'pointer', whiteSpace: 'normal', lineHeight: 1.4,
                            }}
                        >
                            <span>{i.name}{i.sku ? ` (${i.sku})` : ''}</span>
                            <span style={{ color: i.quantity <= 0 ? 'var(--red)' : 'var(--text-dim)', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
                                {i.quantity} in stock
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

/* Searchable client autocomplete — picking one fills the ticket title and links
   the ticket to that client. The results float over the form (absolute) so the
   list never pushes the rest of the modal around. */
function ClientPicker({ clients, onPick, placeholder = 'Search clients…' }) {
    const [q, setQ]       = useState('');
    const [open, setOpen] = useState(false);
    const list = clients
        .filter(c => {
            if (!q) return true;
            const s = q.toLowerCase();
            return c.name.toLowerCase().includes(s) || (c.customer_id || '').toLowerCase().includes(s);
        })
        .slice(0, 40);
    return (
        <div style={{ position: 'relative' }}>
            <input
                value={q}
                onChange={e => { setQ(e.target.value); setOpen(true); }}
                onFocus={() => setOpen(true)}
                onBlur={() => setTimeout(() => setOpen(false), 150)}
                placeholder={placeholder}
                style={{ width: '100%' }}
            />
            {open && (
                <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, marginTop: 2,
                    background: 'var(--bg-3)', border: '1px solid var(--border-hi)', borderRadius: 4,
                    maxHeight: 220, overflowY: 'auto', boxShadow: 'var(--shadow)',
                }}>
                    {list.length === 0 && (
                        <div style={{ padding: 10, color: 'var(--text-dim)', fontSize: 13 }}>No matching clients.</div>
                    )}
                    {list.map(c => (
                        <button
                            type="button"
                            key={c.id}
                            onMouseDown={() => { onPick(c); setQ(''); setOpen(false); }}
                            style={{
                                display: 'flex', justifyContent: 'space-between', gap: 10, width: '100%',
                                textAlign: 'left', background: 'none', border: 'none',
                                borderBottom: '1px solid var(--border)', color: 'var(--text)',
                                padding: '8px 10px', fontSize: 12, cursor: 'pointer', whiteSpace: 'normal', lineHeight: 1.4,
                            }}
                        >
                            <span>{c.name}</span>
                            {c.customer_id && (
                                <span style={{ color: 'var(--text-dim)', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>{c.customer_id}</span>
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

/* Multi-select technician assignment — a compact dropdown of checkboxes.
   value/onChange work with an array of technician ids. */
function AssigneeMultiSelect({ technicians, value = [], onChange }) {
    const [open, setOpen] = useState(false);
    const sel   = new Set(value);
    const names = technicians.filter(t => sel.has(t.id)).map(t => t.name);
    const label = names.length ? names.join(', ') : 'Unassigned';
    const toggle = (id) => onChange(sel.has(id) ? value.filter(x => x !== id) : [...value, id]);
    return (
        <div style={{ position: 'relative' }}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                title={label}
                style={{
                    width: '100%', maxWidth: 200, textAlign: 'left', background: 'var(--bg-2)',
                    border: '1px solid var(--border)', borderRadius: 4, color: names.length ? 'var(--text)' : 'var(--text-dim)',
                    padding: '6px 10px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
                    overflow: 'hidden', textOverflow: 'ellipsis',
                }}
            >
                {label} ▾
            </button>
            {open && (
                <>
                    <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                    <div style={{
                        position: 'absolute', top: '100%', left: 0, zIndex: 41, minWidth: 190, marginTop: 2,
                        background: 'var(--bg-3)', border: '1px solid var(--border-hi)', borderRadius: 4,
                        boxShadow: 'var(--shadow)', maxHeight: 240, overflowY: 'auto', padding: 4,
                    }}>
                        {technicians.length === 0 && (
                            <div style={{ padding: 8, color: 'var(--text-dim)', fontSize: 12 }}>No technicians.</div>
                        )}
                        {technicians.map(t => (
                            <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                <input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} />
                                {t.name}
                            </label>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

/* initialClient: when opened from a client's detail panel, pre-select that
   client (and its autofill) so the user doesn't re-pick it. */
export function NewTicketModal({ onClose, onCreated, technicians, initialClient = null }) {
    const [title,       setTitle]       = useState(initialClient?.name || '');
    const [ticketType,  setTicketType]  = useState('Service');
    const [desc,        setDesc]        = useState('');
    const [assigneeIds, setAssigneeIds] = useState([]);
    const [eventStart,  setEventStart]  = useState('');
    const [eventEnd,    setEventEnd]    = useState('');
    const [location,    setLocation]    = useState(initialClient?.site_address || '');
    const [error,       setError]       = useState('');
    const [loading,     setLoading]     = useState(false);
    const [inv,         setInv]         = useState([]);
    const [pendingItems, setPendingItems] = useState([]);
    const [clients,     setClients]     = useState([]);
    const [clientId,    setClientId]    = useState(initialClient?.id || '');
    const [clientName,  setClientName]  = useState(initialClient?.name || '');
    const [pocName,     setPocName]     = useState(initialClient?.contact_name || '');
    const [pocPhone,    setPocPhone]    = useState(initialClient?.contact_phone || '');

    useEffect(() => {
        api.get('/inventory').then(r => setInv(r.data)).catch(() => {});
        /* all: 1 so project clients are linkable too, not just monitored ones. */
        api.get('/clients', { params: { all: 1 } }).then(r => setClients(r.data)).catch(() => {});
    }, []);

    /* Pick a client → autofill the title, location, point of contact, and link
       the ticket. These come from the client's Site & Contact fields, so they
       only fill in if that section has been filled in on the client. */
    const pickClient = (c) => {
        setClientId(c.id);
        setClientName(c.name);
        setTitle(c.name);
        setLocation(c.site_address || '');
        setPocName(c.contact_name || '');
        setPocPhone(c.contact_phone || '');
    };
    const clearClient = () => {
        setClientId('');
        setClientName('');
    };

    const payload = (extra = {}) => ({
        title,
        ticket_type:    ticketType,
        description:    desc        || undefined,
        assignee_ids:   assigneeIds,
        event_start:    eventStart  || undefined,
        event_end:      eventEnd    || undefined,
        event_location: location    || undefined,
        client_id:      clientId    || undefined,
        poc_name:       pocName     || undefined,
        poc_phone:      pocPhone    || undefined,
        ...extra,
    });

    const create = async ({ draft }) => {
        setError('');
        setLoading(true);
        try {
            const { data } = await api.post('/tickets', payload(draft ? { is_draft: true } : {}));
            for (const it of pendingItems) {
                await api.post(`/tickets/${data.id}/items`,
                    { inventory_item_id: it.id, quantity: it.quantity, used: it.used }).catch(() => {});
            }
            onCreated(data);
            onClose();
        } catch (err) {
            setError(err.response?.data?.error || `Failed to ${draft ? 'save draft' : 'create ticket'}.`);
        } finally {
            setLoading(false);
        }
    };

    const submit = (e) => { e.preventDefault(); create({ draft: false }); };

    /* Anything the user has actually entered beyond what the form opened with
       (initialClient pre-fills the title/client/location/POC). */
    const isDirty = () =>
        title.trim()    !== (initialClient?.name || '') ||
        desc.trim()     !== '' ||
        clientId        !== (initialClient?.id || '') ||
        assigneeIds.length > 0 ||
        eventStart      !== '' ||
        eventEnd        !== '' ||
        location.trim() !== (initialClient?.site_address || '') ||
        pocName.trim()  !== (initialClient?.contact_name || '') ||
        pocPhone.trim() !== (initialClient?.contact_phone || '') ||
        pendingItems.length > 0;

    /* Clicking off (the backdrop) auto-saves an in-progress ticket as a draft so
       the work is never lost. An untouched form just closes — no point littering
       the drafts list. Cancel stays the explicit "discard without saving" path. */
    const dismiss = () => {
        if (loading) return;                    // a save/create is already running
        if (isDirty()) create({ draft: true });
        else onClose();
    };

    return (
        <div className="modal-overlay" onClick={dismiss}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
                <div className="modal-title">New Service Ticket</div>
                {error && <div className="error-msg">{error}</div>}
                <form onSubmit={submit}>
                    {/* ── Core fields ── */}
                    <div className="form-group">
                        <label className="form-label">Client (optional — autofills the title)</label>
                        {clientName ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
                                          border: '1px solid var(--border)', borderRadius: 4, padding: '8px 10px' }}>
                                <span style={{ flex: 1, minWidth: 0 }}>🔗 {clientName}</span>
                                <button type="button" className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }}
                                    onClick={clearClient}>✕ unlink</button>
                            </div>
                        ) : (
                            <ClientPicker clients={clients} onPick={pickClient} />
                        )}
                    </div>
                    <div className="form-group">
                        <label className="form-label">Title *</label>
                        <input value={title} onChange={e => setTitle(e.target.value)} required autoFocus />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Ticket Type</label>
                        <select value={ticketType} onChange={e => setTicketType(e.target.value)}>
                            {TICKET_TYPES.map(tt => <option key={tt} value={tt}>{tt}</option>)}
                        </select>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Scope of Work</label>
                        <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} style={{ resize: 'vertical' }} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Assign To (one or more)</label>
                        <AssigneeMultiSelect technicians={technicians} value={assigneeIds} onChange={setAssigneeIds} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Point of Contact</label>
                            <input value={pocName} onChange={e => setPocName(e.target.value)} placeholder="Name (autofills from client)" />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Contact Phone</label>
                            <input value={pocPhone} onChange={e => setPocPhone(e.target.value)} placeholder="Phone" />
                        </div>
                    </div>

                    {/* ── Schedule fields ── */}
                    <div style={{ borderTop: '1px solid var(--border)', margin: '14px 0 12px', paddingTop: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                            Schedule (optional — creates a Google Calendar event)
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <div className="form-group" style={{ margin: 0 }}>
                                <label className="form-label">Entry Date &amp; Time</label>
                                <input
                                    type="datetime-local"
                                    value={eventStart}
                                    onChange={e => setEventStart(e.target.value)}
                                />
                            </div>
                            <div className="form-group" style={{ margin: 0 }}>
                                <label className="form-label">Departure Time</label>
                                <input
                                    type="datetime-local"
                                    value={eventEnd}
                                    onChange={e => setEventEnd(e.target.value)}
                                    min={eventStart || undefined}
                                />
                            </div>
                        </div>
                        <div className="form-group" style={{ marginTop: 10, marginBottom: 0 }}>
                            <label className="form-label">Location / Address</label>
                            <input
                                type="text"
                                placeholder="e.g. 123 Main St, Phoenix"
                                value={location}
                                onChange={e => setLocation(e.target.value)}
                            />
                        </div>
                    </div>

                    {/* ── Inventory items (optional) ── */}
                    <div style={{ borderTop: '1px solid var(--border)', margin: '14px 0 12px', paddingTop: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                            Inventory Items (optional)
                        </div>
                        {pendingItems.length > 0 && (
                            <div style={{ marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {pendingItems.map(it => (
                                    <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                                        <span style={{ flex: 1, minWidth: 0 }}>{it.name}{it.sku ? ` (${it.sku})` : ''}</span>
                                        <input type="number" min="1" value={it.quantity}
                                            onChange={e => setPendingItems(p => p.map(x => x.id === it.id ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x))}
                                            style={{ width: 56, padding: '4px 6px', fontSize: 12 }} />
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, whiteSpace: 'nowrap' }}>
                                            <input type="checkbox" checked={it.used}
                                                onChange={e => setPendingItems(p => p.map(x => x.id === it.id ? { ...x, used: e.target.checked } : x))} />
                                            used
                                        </label>
                                        <button type="button" className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }}
                                            onClick={() => setPendingItems(p => p.filter(x => x.id !== it.id))}>✕</button>
                                    </div>
                                ))}
                            </div>
                        )}
                        <InventoryItemPicker
                            inv={inv}
                            exclude={pendingItems.map(p => p.id)}
                            onPick={item => setPendingItems(p => [...p, { id: item.id, name: item.name, sku: item.sku, quantity: 1, used: false }])}
                        />
                    </div>

                    <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
                        <button type="button" className="btn btn-ghost" onClick={onClose} title="Discard without saving (clicking off saves a draft)">Cancel</button>
                        <div style={{ display: 'flex', gap: 8 }}>
                            {/* Save an unfinished ticket to come back to. No title needed. */}
                            <button type="button" className="btn btn-ghost" disabled={loading}
                                onClick={() => create({ draft: true })} title="Save as a draft to finish later">
                                {loading ? '…' : 'Save draft'}
                            </button>
                            <button type="submit" className="btn btn-primary" disabled={loading}>
                                {loading ? 'Creating…' : 'Create Ticket'}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}

/* Admin: edit a ticket's details + upload a site-map image. */
export function EditTicketModal({ ticket, technicians, onClose, onUpdated }) {
    /* datetime-local needs LOCAL wall-clock (YYYY-MM-DDTHH:MM). Using
       toISOString() fed UTC into the input, so each edit re-saved the time
       shifted by the tz offset (the "randomly changing time" bug). Offset-
       correct it so the value round-trips unchanged. */
    const toLocalInput = ts => {
        if (!ts) return '';
        const d = new Date(ts);
        return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    };
    const [title,       setTitle]       = useState(ticket.title || '');
    const [ticketType,  setTicketType]  = useState(ticket.ticket_type || 'Service');
    const [desc,        setDesc]        = useState(ticket.description || '');
    const [assigneeIds, setAssigneeIds] = useState(ticket.assignee_ids || []);
    const [eventStart,  setEventStart]  = useState(toLocalInput(ticket.event_start));
    const [eventEnd,    setEventEnd]    = useState(toLocalInput(ticket.event_end));
    const [location,    setLocation]    = useState(ticket.event_location || '');
    const [clients,     setClients]     = useState([]);
    const [clientId,    setClientId]    = useState(ticket.client_id || '');
    const [clientName,  setClientName]  = useState('');
    const [pocName,     setPocName]     = useState(ticket.poc_name || '');
    const [pocPhone,    setPocPhone]    = useState(ticket.poc_phone || '');
    const [siteMap,     setSiteMap]     = useState(ticket.site_map_file || null);
    const [uploading,   setUploading]   = useState(false);
    const [error,       setError]       = useState('');
    const [saving,      setSaving]      = useState(false);

    useEffect(() => {
        api.get('/clients', { params: { all: 1 } }).then(r => {
            setClients(r.data);
            const c = r.data.find(x => x.id === ticket.client_id);
            if (c) setClientName(c.name);
        }).catch(() => {});
    }, []);

    const isDraft = ticket.status === 'draft';

    const patchBody = (extra = {}) => ({
        title,
        ticket_type:   ticketType,
        description:    desc,
        assignee_ids:  assigneeIds,
        event_start:   eventStart || undefined,
        event_end:     eventEnd   || undefined,
        event_location: location,
        client_id:     clientId || undefined,
        poc_name:      pocName,
        poc_phone:     pocPhone,
        ...extra,
    });

    /* Save without changing status. For a draft this keeps it a draft (COALESCE
       leaves status as 'draft'); for a normal ticket it just saves the edits. */
    const save = async (e) => {
        e?.preventDefault();
        setSaving(true); setError('');
        try {
            const { data } = await api.patch(`/tickets/${ticket.id}`, patchBody());
            onUpdated(data);
            onClose();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to save ticket.');
        } finally {
            setSaving(false);
        }
    };

    /* Promote a draft to a real ticket. Requires a title; a scheduled draft
       becomes a calendar entry server-side (source flips when event_start set). */
    const finalize = async () => {
        if (!title.trim()) { setError('A title is required to create the ticket.'); return; }
        setSaving(true); setError('');
        try {
            const { data } = await api.patch(`/tickets/${ticket.id}`, patchBody({ status: 'open' }));
            onUpdated(data);
            onClose();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to create ticket.');
        } finally {
            setSaving(false);
        }
    };

    /* Clicking off keeps a draft's in-progress edits (saves it — still a draft);
       a normal ticket's unsaved edits are discarded on click-off, as before —
       auto-persisting half-finished edits to a live ticket would be riskier. */
    const dismiss = () => {
        if (saving) return;
        if (isDraft) save();
        else onClose();
    };

    const uploadSiteMap = async (file) => {
        if (!file) return;
        setUploading(true); setError('');
        const fd = new FormData(); fd.append('sitemap', file);
        try {
            const { data } = await api.post(`/tickets/${ticket.id}/site-map`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
            setSiteMap(data.site_map_file);
        } catch (err) {
            setError(err.response?.data?.error || 'Upload failed.');
        } finally {
            setUploading(false);
        }
    };
    const removeSiteMap = async () => {
        await api.delete(`/tickets/${ticket.id}/site-map`).catch(() => {});
        setSiteMap(null);
    };

    return (
        <div className="modal-overlay" onClick={dismiss}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
                <div className="modal-title">{isDraft ? `Draft #${ticket.id}` : `Edit Ticket #${ticket.id}`}</div>
                {error && <div className="error-msg">{error}</div>}
                <form onSubmit={save}>
                    <div className="form-group">
                        <label className="form-label">Client</label>
                        {clientName ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, border: '1px solid var(--border)', borderRadius: 4, padding: '8px 10px' }}>
                                <span style={{ flex: 1, minWidth: 0 }}>🔗 {clientName}</span>
                                <button type="button" className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }}
                                    onClick={() => { setClientId(''); setClientName(''); }}>✕ unlink</button>
                            </div>
                        ) : (
                            <ClientPicker clients={clients} onPick={c => { setClientId(c.id); setClientName(c.name); setLocation(c.site_address || ''); setPocName(c.contact_name || ''); setPocPhone(c.contact_phone || ''); }} />
                        )}
                    </div>
                    <div className="form-group">
                        <label className="form-label">Title{isDraft ? '' : ' *'}</label>
                        {/* Not required while it's a draft — a draft can be saved unfinished. */}
                        <input value={title} onChange={e => setTitle(e.target.value)} required={!isDraft} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Point of Contact</label>
                            <input value={pocName} onChange={e => setPocName(e.target.value)} placeholder="Name" />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Contact Phone</label>
                            <input value={pocPhone} onChange={e => setPocPhone(e.target.value)} placeholder="Phone" />
                        </div>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Ticket Type</label>
                        <select value={ticketType} onChange={e => setTicketType(e.target.value)}>
                            {TICKET_TYPES.map(tt => <option key={tt} value={tt}>{tt}</option>)}
                        </select>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Scope of Work</label>
                        <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} style={{ resize: 'vertical' }} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Assigned To</label>
                        <AssigneeMultiSelect technicians={technicians} value={assigneeIds} onChange={setAssigneeIds} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Entry Date &amp; Time</label>
                            <input type="datetime-local" value={eventStart} onChange={e => setEventStart(e.target.value)} />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Departure Time</label>
                            <input type="datetime-local" value={eventEnd} onChange={e => setEventEnd(e.target.value)} min={eventStart || undefined} />
                        </div>
                    </div>
                    <div className="form-group" style={{ marginTop: 10 }}>
                        <label className="form-label">Location / Address</label>
                        <input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. 123 Main St, Phoenix" />
                    </div>

                    {/* Site map image */}
                    <div style={{ borderTop: '1px solid var(--border)', margin: '14px 0 12px', paddingTop: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                            Site Map
                        </div>
                        {siteMap ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <a href={`/uploads/tickets/${siteMap}`} target="_blank" rel="noopener noreferrer">
                                    <img src={`/uploads/tickets/${siteMap}`} alt="Site map"
                                        style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 4, border: '1px solid var(--border)' }} />
                                </a>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <label className="btn btn-ghost" style={{ fontSize: 12, cursor: 'pointer' }}>
                                        {uploading ? 'Uploading…' : '↑ Replace'}
                                        <input type="file" accept="image/*" hidden disabled={uploading}
                                            onChange={e => uploadSiteMap(e.target.files?.[0])} />
                                    </label>
                                    <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={removeSiteMap}>Remove</button>
                                </div>
                            </div>
                        ) : (
                            <label className="btn btn-ghost" style={{ fontSize: 12, cursor: 'pointer' }}>
                                {uploading ? 'Uploading…' : '↑ Upload site map image'}
                                <input type="file" accept="image/*" hidden disabled={uploading}
                                    onChange={e => uploadSiteMap(e.target.files?.[0])} />
                            </label>
                        )}
                    </div>

                    <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                        <div style={{ display: 'flex', gap: 8 }}>
                            {/* For a draft, Save is type=button so the (optional) empty title
                               doesn't trip HTML5 validation; a normal edit submits the form. */}
                            {isDraft ? (
                                <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => save()}>
                                    {saving ? 'Saving…' : 'Save draft'}
                                </button>
                            ) : (
                                <button type="submit" className="btn btn-primary" disabled={saving}>
                                    {saving ? 'Saving…' : 'Save Changes'}
                                </button>
                            )}
                            {isDraft && (
                                <button type="button" className="btn btn-primary" disabled={saving} onClick={finalize}>
                                    {saving ? '…' : 'Create Ticket'}
                                </button>
                            )}
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}

/* Inventory items used on a ticket. Techs/admins add items, mark them "used",
   and used items draw down stock when the ticket is marked complete. */
function TicketItemsModal({ ticket, onClose }) {
    const [items,   setItems]   = useState([]);
    const [inv,     setInv]     = useState([]);
    const [loading, setLoading] = useState(true);
    const [error,   setError]   = useState('');

    const reload = async () => {
        const { data } = await api.get(`/tickets/${ticket.id}/items`);
        setItems(data);
    };

    useEffect(() => {
        (async () => {
            try {
                const [it, inventory] = await Promise.all([
                    api.get(`/tickets/${ticket.id}/items`),
                    api.get('/inventory'),
                ]);
                setItems(it.data);
                setInv(inventory.data);
            } catch (e) {
                setError(e.response?.data?.error || 'Could not load items.');
            } finally {
                setLoading(false);
            }
        })();
    }, [ticket.id]);

    const addItem = async (item) => {
        setError('');
        try {
            await api.post(`/tickets/${ticket.id}/items`, { inventory_item_id: item.id, quantity: 1 });
            await reload();
        } catch (e) { setError(e.response?.data?.error || 'Failed to add item.'); }
    };

    const patchItem = async (item, body) => {
        try {
            const { data } = await api.patch(`/tickets/${ticket.id}/items/${item.id}`, body);
            setItems(prev => prev.map(i => i.id === item.id ? data : i));
        } catch (e) { setError(e.response?.data?.error || 'Failed to update item.'); }
    };

    const remove = async (item) => {
        try {
            await api.delete(`/tickets/${ticket.id}/items/${item.id}`);
            setItems(prev => prev.filter(i => i.id !== item.id));
        } catch (e) { setError(e.response?.data?.error || 'Failed to remove item.'); }
    };

    const isComplete = ticket.status === 'resolved' || ticket.status === 'closed';

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 580, width: '100%' }}>
                <div className="modal-title">Inventory — {ticket.title}</div>
                {error && <div className="error-msg">{error}</div>}

                {loading ? (
                    <p style={{ color: 'var(--text-dim)' }}>Loading…</p>
                ) : (
                    <>
                        {items.length === 0 ? (
                            <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>No items added yet.</p>
                        ) : (
                            <table className="data-table" style={{ marginBottom: 12 }}>
                                <thead>
                                    <tr><th>Item</th><th>In stock</th><th>Qty</th><th>Used</th><th></th></tr>
                                </thead>
                                <tbody>
                                    {items.map(it => (
                                        <tr key={it.id}>
                                            <td>
                                                {it.item_name}
                                                {it.sku && <span style={{ color: 'var(--text-dim)', fontSize: 11 }}> · {it.sku}</span>}
                                            </td>
                                            <td style={{ fontFamily: 'var(--font-mono)', color: it.stock <= 0 ? 'var(--red)' : 'var(--text-dim)' }}>{it.stock}</td>
                                            <td>
                                                <input type="number" min="1" value={it.quantity}
                                                    disabled={it.deducted}
                                                    onChange={e => patchItem(it, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                                                    style={{ width: 56, padding: '4px 6px', fontSize: 12 }} />
                                            </td>
                                            <td>
                                                <input type="checkbox" checked={it.used} disabled={it.deducted}
                                                    onChange={() => patchItem(it, { used: !it.used })} />
                                                {it.deducted && <span className="tag tag-green" style={{ fontSize: 10, marginLeft: 6 }}>deducted</span>}
                                            </td>
                                            <td>
                                                {!it.deducted && (
                                                    <button className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => remove(it)}>✕</button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}

                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Add inventory item</label>
                            <InventoryItemPicker inv={inv} exclude={items.map(i => i.inventory_item_id)} onPick={addItem} />
                        </div>

                        <p style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 14 }}>
                            Check <strong>Used</strong> for items consumed on this job. When the ticket is marked{' '}
                            <strong>Resolved</strong> or <strong>Closed</strong>, used items are subtracted from inventory stock.
                            {isComplete && ' This ticket is already complete — re-save its status to deduct any newly-used items.'}
                        </p>

                        <div className="modal-actions">
                            <button className="btn btn-primary" onClick={onClose}>Done</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export default function Tickets() {
    const { user } = useAuth();
    const { roleForName } = useRoles();
    const [tickets,     setTickets]     = useState([]);
    const [technicians, setTechnicians] = useState([]);
    const [loading,     setLoading]     = useState(true);
    const [showModal,   setShowModal]   = useState(false);
    const [itemsTicket, setItemsTicket] = useState(null);
    const [editTicket,  setEditTicket]  = useState(null);
    const [statusFilter, setStatusFilter] = useState('all');
    const [drafts,      setDrafts]      = useState([]);
    const [loadError,   setLoadError]   = useState('');
    const [searchParams, setSearchParams] = useSearchParams();

    const loadDrafts = () => api.get('/tickets', { params: { drafts: 1 } })
        .then(r => setDrafts(r.data)).catch(() => setDrafts([]));

    const load = async () => {
        try {
            const [t, tech] = await Promise.all([
                api.get('/tickets'),
                api.get('/admin/technicians'),
            ]);
            setTickets(t.data);
            setTechnicians(tech.data);
            setLoadError('');
            loadDrafts();
        } catch (e) {
            /* Don't fail silently — an empty list used to look like "all tickets
               gone" when the request actually errored. */
            setLoadError(e.response?.data?.error || 'Could not load tickets.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    /* Deep link from the calendar: /tickets?open=<id> opens that ticket's editor
       once the list has loaded, then drops the param so it won't reopen. */
    useEffect(() => {
        const openId = searchParams.get('open');
        if (!openId || tickets.length === 0) return;
        const t = tickets.find(x => String(x.id) === String(openId));
        if (t) setEditTicket(t);
        searchParams.delete('open');
        setSearchParams(searchParams, { replace: true });
    }, [tickets, searchParams, setSearchParams]);

    const updateStatus = async (id, status) => {
        try {
            const { data } = await api.patch(`/tickets/${id}`, { status });
            setTickets(prev => prev.map(t => t.id === id ? data : t));
        } catch (e) { console.error(e); }
    };

    const updateAssignees = async (id, assignee_ids) => {
        try {
            const { data } = await api.patch(`/tickets/${id}`, { assignee_ids });
            setTickets(prev => prev.map(t => t.id === id ? data : t));
        } catch (e) { console.error(e); }
    };

    const deleteTicket = async (id) => {
        if (!confirm('Delete this ticket?')) return;
        try {
            await api.delete(`/tickets/${id}`);
            setTickets(prev => prev.filter(t => t.id !== id));
        } catch (e) { console.error(e); }
    };

    const [deletingAll, setDeletingAll] = useState(false);
    const autoCount = tickets.filter(t => t.source === 'calendar').length;
    const deleteAutoTickets = async () => {
        if (autoCount === 0) return;
        if (!confirm(`Delete ${autoCount} auto-generated (calendar) ticket(s)?\n\nThis removes only tickets the server generated from the calendar — it does NOT touch your Google Calendar, and cannot be undone.`)) return;
        setDeletingAll(true);
        try {
            const { data } = await api.delete('/tickets');
            setTickets(prev => prev.filter(t => t.source !== 'calendar'));
            alert(`Deleted ${data.deleted} auto-generated ticket(s).`);
        } catch (e) {
            alert(e.response?.data?.error || 'Failed to delete tickets.');
        } finally {
            setDeletingAll(false);
        }
    };

    return (
        <Layout>
            <div className="page-header">
                <h1 className="page-title">Tickets <span>{tickets.length} records</span><PageHelp id="tickets" /></h1>
                {user.role === 'admin' && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <button className="btn btn-danger" onClick={deleteAutoTickets} disabled={deletingAll || autoCount === 0}
                            title="Removes tickets auto-generated from the calendar. Does not touch Google Calendar.">
                            {deletingAll ? 'Deleting…' : `Delete auto-generated tickets${autoCount ? ` (${autoCount})` : ''}`}
                        </button>
                        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ New Ticket</button>
                    </div>
                )}
            </div>

            {loading && <p style={{ color: 'var(--text-dim)' }}>Loading...</p>}
            {!loading && loadError && <div className="error-msg" style={{ marginBottom: 16 }}>{loadError}</div>}

            {!loading && (() => {
                const STATUS_TABS = [
                    ['all', 'All'], ['open', 'Open'], ['in_progress', 'In Progress'],
                    ['resolved', 'Resolved'], ['closed', 'Closed'], ['drafts', 'Drafts'],
                ];
                const shown = statusFilter === 'drafts' ? drafts
                    : statusFilter === 'all' ? tickets
                    : tickets.filter(t => t.status === statusFilter);
                return (
                <>
                <div className="alarm-service-tabs" style={{ marginBottom: 16 }}>
                    {STATUS_TABS.map(([s, label]) => {
                        const count = s === 'drafts' ? drafts.length
                            : s === 'all' ? tickets.length
                            : tickets.filter(t => t.status === s).length;
                        return (
                            <button key={s} className={`alarm-tab ${statusFilter === s ? 'active' : ''}`} onClick={() => setStatusFilter(s)}>
                                {label} <span className="alarm-tab-count">{count}</span>
                            </button>
                        );
                    })}
                </div>
                <div className="table-card">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Title</th>
                                <th>Schedule</th>
                                <th>Status</th>
                                <th>Assigned To</th>
                                <th>Created</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {shown.length === 0 && (
                                <tr><td colSpan={7} style={{ color: 'var(--text-dim)', textAlign: 'center', padding: 32 }}>No tickets found.</td></tr>
                            )}
                            {shown.map(t => (
                                <tr key={t.id}>
                                    <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', fontSize: 12 }}>#{t.id}</td>

                                    {/* ── Title cell ── */}
                                    <td>
                                        <div style={{ fontWeight: 500, color: 'var(--text-hi)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                            {t.event_start && <span title="Scheduled event">📅</span>}
                                            {t.title || <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>(untitled draft)</span>}
                                        </div>
                                        {t.ticket_type && (
                                            <div style={{ marginTop: 3 }}>
                                                <span style={{
                                                    fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
                                                    letterSpacing: 0.5, color: 'var(--accent)',
                                                    border: '1px solid var(--border)', borderRadius: 3, padding: '1px 6px',
                                                }}>{t.ticket_type}</span>
                                            </div>
                                        )}
                                        {t.event_location && (
                                            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                                                📍 {t.event_location}
                                            </div>
                                        )}
                                        {(t.poc_name || t.poc_phone) && (
                                            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                                                👤 {t.poc_name}{t.poc_phone ? ` · ${t.poc_phone}` : ''}
                                            </div>
                                        )}
                                        {!t.event_start && t.description && (
                                            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                                                {t.description.slice(0, 60)}{t.description.length > 60 ? '…' : ''}
                                            </div>
                                        )}
                                    </td>

                                    {/* ── Schedule cell ── */}
                                    <td style={{ minWidth: 150 }}>
                                        {t.event_start ? (
                                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.6 }}>
                                                <div style={{ color: 'var(--accent)' }}>
                                                    ▶ {fmt(t.event_start, DATE_OPTS)}
                                                </div>
                                                {t.event_end && (
                                                    <div style={{ color: 'var(--text-dim)' }}>
                                                        ■ {fmt(t.event_end, TIME_OPTS)}
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <span style={{ color: 'var(--border-hi)', fontSize: 12 }}>—</span>
                                        )}
                                    </td>

                                    <td>
                                        <span className={`tag ${STATUS_TAG[t.status]}`}>{t.status.replace('_', ' ')}</span>
                                    </td>

                                    <td>
                                        {user.role === 'admin' ? (
                                            <AssigneeMultiSelect
                                                technicians={technicians}
                                                value={t.assignee_ids || []}
                                                onChange={ids => updateAssignees(t.id, ids)}
                                            />
                                        ) : (t.assignee_names || []).length ? (
                                            <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', color: 'var(--text-dim)' }}>
                                                {t.assignee_names.map((nm, i) => (
                                                    <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                        {nm}
                                                        <RoleBadge role={roleForName(nm)} />
                                                    </span>
                                                ))}
                                            </span>
                                        ) : (
                                            <span style={{ color: 'var(--border-hi)' }}>Unassigned</span>
                                        )}
                                    </td>

                                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>
                                        {new Date(t.created_at).toLocaleDateString()}
                                    </td>

                                    <td>
                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                            {t.status === 'draft' ? (
                                                /* Drafts can't take a status yet — resume to finish. */
                                                <button
                                                    className="btn btn-primary"
                                                    style={{ padding: '4px 10px', fontSize: 12 }}
                                                    onClick={() => setEditTicket(t)}
                                                >
                                                    Resume draft
                                                </button>
                                            ) : (
                                                <>
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
                                                    <button
                                                        className="btn btn-ghost"
                                                        style={{ padding: '4px 10px', fontSize: 12 }}
                                                        onClick={() => setItemsTicket(t)}
                                                    >
                                                        Items
                                                    </button>
                                                    {user.role === 'admin' && (
                                                        <button
                                                            className="btn btn-ghost"
                                                            style={{ padding: '4px 10px', fontSize: 12 }}
                                                            onClick={() => setEditTicket(t)}
                                                        >
                                                            Edit
                                                        </button>
                                                    )}
                                                </>
                                            )}
                                            {user.role === 'admin' && (
                                                <button
                                                    className="btn btn-danger"
                                                    style={{ padding: '4px 10px', fontSize: 12 }}
                                                    onClick={() => deleteTicket(t.id)}
                                                >
                                                    Del
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                </>
                );
            })()}

            {showModal && (
                <NewTicketModal
                    onClose={() => setShowModal(false)}
                    onCreated={t => { if (t.status === 'draft') loadDrafts(); else setTickets(prev => [t, ...prev]); }}
                    technicians={technicians}
                />
            )}

            {itemsTicket && (
                <TicketItemsModal
                    ticket={itemsTicket}
                    onClose={() => setItemsTicket(null)}
                />
            )}

            {editTicket && (
                <EditTicketModal
                    ticket={editTicket}
                    technicians={technicians}
                    onClose={() => setEditTicket(null)}
                    onUpdated={u => {
                        /* A finalized draft leaves the drafts list and joins the
                           main list; a normal edit updates in place. */
                        setTickets(prev => prev.some(t => t.id === u.id)
                            ? prev.map(t => t.id === u.id ? { ...t, ...u } : t)
                            : (u.status !== 'draft' ? [u, ...prev] : prev));
                        loadDrafts();
                    }}
                />
            )}
        </Layout>
    );
}
