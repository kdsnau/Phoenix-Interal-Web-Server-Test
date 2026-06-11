import { useEffect, useState } from 'react';
import api from '../api/client';
import Layout from '../components/Layout';
import PageHelp from '../components/PageHelp';
import { useAuth } from '../context/AuthContext';

const STATUS_TAG = {
    open:        'tag-yellow',
    in_progress: 'tag-blue',
    resolved:    'tag-green',
    closed:      'tag-dim',
};

function fmt(ts, opts) {
    if (!ts) return null;
    return new Date(ts).toLocaleString('en-US', opts);
}

const DATE_OPTS  = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
const TIME_OPTS  = { hour: 'numeric', minute: '2-digit' };

function NewTicketModal({ onClose, onCreated, technicians }) {
    const [title,       setTitle]       = useState('');
    const [desc,        setDesc]        = useState('');
    const [assignedTo,  setAssignedTo]  = useState('');
    const [eventStart,  setEventStart]  = useState('');
    const [eventEnd,    setEventEnd]    = useState('');
    const [location,    setLocation]    = useState('');
    const [error,       setError]       = useState('');
    const [loading,     setLoading]     = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const { data } = await api.post('/tickets', {
                title,
                description:    desc        || undefined,
                assigned_to:    assignedTo  || undefined,
                event_start:    eventStart  || undefined,
                event_end:      eventEnd    || undefined,
                event_location: location    || undefined,
            });
            onCreated(data);
            onClose();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to create ticket.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
                <div className="modal-title">New Service Ticket</div>
                {error && <div className="error-msg">{error}</div>}
                <form onSubmit={submit}>
                    {/* ── Core fields ── */}
                    <div className="form-group">
                        <label className="form-label">Title *</label>
                        <input value={title} onChange={e => setTitle(e.target.value)} required autoFocus />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Description</label>
                        <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} style={{ resize: 'vertical' }} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Assign To</label>
                        <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
                            <option value="">Unassigned</option>
                            {technicians.map(t => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                        </select>
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

                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            {loading ? 'Creating…' : 'Create Ticket'}
                        </button>
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
    const [pick,    setPick]    = useState('');
    const [qty,     setQty]     = useState(1);
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

    const add = async () => {
        if (!pick) return;
        setError('');
        try {
            await api.post(`/tickets/${ticket.id}/items`, { inventory_item_id: Number(pick), quantity: Number(qty) || 1 });
            setPick(''); setQty(1);
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

                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                            <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 220 }}>
                                <label className="form-label">Add inventory item</label>
                                <select value={pick} onChange={e => setPick(e.target.value)}>
                                    <option value="">Select an item…</option>
                                    {inv.map(i => (
                                        <option key={i.id} value={i.id}>
                                            {i.name}{i.sku ? ` (${i.sku})` : ''} — {i.quantity} in stock
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group" style={{ margin: 0, width: 80 }}>
                                <label className="form-label">Qty</label>
                                <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} />
                            </div>
                            <button className="btn btn-primary" onClick={add} disabled={!pick}>Add</button>
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
    const [tickets,     setTickets]     = useState([]);
    const [technicians, setTechnicians] = useState([]);
    const [loading,     setLoading]     = useState(true);
    const [showModal,   setShowModal]   = useState(false);
    const [itemsTicket, setItemsTicket] = useState(null);

    const load = async () => {
        try {
            const [t, tech] = await Promise.all([
                api.get('/tickets'),
                api.get('/admin/technicians'),
            ]);
            setTickets(t.data);
            setTechnicians(tech.data);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const updateStatus = async (id, status) => {
        try {
            const { data } = await api.patch(`/tickets/${id}`, { status });
            setTickets(prev => prev.map(t => t.id === id ? data : t));
        } catch (e) { console.error(e); }
    };

    const updateAssignee = async (id, assigned_to) => {
        try {
            const { data } = await api.patch(`/tickets/${id}`, {
                assigned_to: assigned_to === '' ? '__unassign__' : assigned_to,
            });
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

    return (
        <Layout>
            <div className="page-header">
                <h1 className="page-title">Tickets <span>{tickets.length} records</span><PageHelp id="tickets" /></h1>
                {user.role === 'admin' && (
                    <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ New Ticket</button>
                )}
            </div>

            {loading && <p style={{ color: 'var(--text-dim)' }}>Loading...</p>}

            {!loading && (
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
                            {tickets.length === 0 && (
                                <tr><td colSpan={7} style={{ color: 'var(--text-dim)', textAlign: 'center', padding: 32 }}>No tickets found.</td></tr>
                            )}
                            {tickets.map(t => (
                                <tr key={t.id}>
                                    <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', fontSize: 12 }}>#{t.id}</td>

                                    {/* ── Title cell ── */}
                                    <td>
                                        <div style={{ fontWeight: 500, color: 'var(--text-hi)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                            {t.event_start && <span title="Scheduled event">📅</span>}
                                            {t.title}
                                        </div>
                                        {t.event_location && (
                                            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                                                📍 {t.event_location}
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
                                            <select
                                                value={t.assigned_to || ''}
                                                onChange={e => updateAssignee(t.id, e.target.value)}
                                                style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
                                            >
                                                <option value="">Unassigned</option>
                                                {technicians.map(tech => (
                                                    <option key={tech.id} value={tech.id}>{tech.name}</option>
                                                ))}
                                            </select>
                                        ) : (
                                            <span style={{ color: t.assignee_name ? 'var(--text-dim)' : 'var(--border-hi)' }}>
                                                {t.assignee_name || 'Unassigned'}
                                            </span>
                                        )}
                                    </td>

                                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>
                                        {new Date(t.created_at).toLocaleDateString()}
                                    </td>

                                    <td>
                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
            )}

            {showModal && (
                <NewTicketModal
                    onClose={() => setShowModal(false)}
                    onCreated={t => setTickets(prev => [t, ...prev])}
                    technicians={technicians}
                />
            )}

            {itemsTicket && (
                <TicketItemsModal
                    ticket={itemsTicket}
                    onClose={() => setItemsTicket(null)}
                />
            )}
        </Layout>
    );
}
