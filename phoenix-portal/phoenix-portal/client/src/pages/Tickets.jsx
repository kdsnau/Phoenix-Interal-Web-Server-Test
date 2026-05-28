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

function NewTicketModal({ onClose, onCreated, technicians }) {
    const [title, setTitle]           = useState('');
    const [desc, setDesc]             = useState('');
    const [assignedTo, setAssignedTo] = useState('');
    const [error, setError]           = useState('');
    const [loading, setLoading]       = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const { data } = await api.post('/tickets', {
                title,
                description: desc,
                assigned_to: assignedTo || null,
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
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-title">New Service Ticket</div>
                {error && <div className="error-msg">{error}</div>}
                <form onSubmit={submit}>
                    <div className="form-group">
                        <label className="form-label">Title</label>
                        <input value={title} onChange={e => setTitle(e.target.value)} required autoFocus />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Description</label>
                        <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={4} style={{ resize: 'vertical' }} />
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
                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            {loading ? 'Creating...' : 'Create Ticket'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default function Tickets() {
    const { user } = useAuth();
    const [tickets, setTickets]         = useState([]);
    const [technicians, setTechnicians] = useState([]);
    const [loading, setLoading]         = useState(true);
    const [showModal, setShowModal]     = useState(false);

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
                                <th>Status</th>
                                <th>Created By</th>
                                <th>Assigned To</th>
                                <th>Date</th>
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
                                    <td>
                                        <div style={{ fontWeight: 500, color: 'var(--text-hi)' }}>{t.title}</div>
                                        {t.description && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>{t.description.slice(0,60)}{t.description.length > 60 ? '…' : ''}</div>}
                                    </td>
                                    <td>
                                        <span className={`tag ${STATUS_TAG[t.status]}`}>{t.status.replace('_', ' ')}</span>
                                    </td>
                                    <td style={{ color: 'var(--text-dim)' }}>{t.creator_name || '—'}</td>
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
                                                <button className="btn btn-danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => deleteTicket(t.id)}>
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
