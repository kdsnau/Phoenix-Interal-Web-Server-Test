import { useEffect, useState } from 'react';
import api from '../api/client';
import Layout from '../components/Layout';
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

export default function Tickets() {
    const { user } = useAuth();
    const [tickets,     setTickets]     = useState([]);
    const [technicians, setTechnicians] = useState([]);
    const [loading,     setLoading]     = useState(true);
    const [showModal,   setShowModal]   = useState(false);

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
                <h1 className="page-title">Tickets <span>{tickets.length} records</span></h1>
                <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ New Ticket</button>
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
        </Layout>
    );
}
