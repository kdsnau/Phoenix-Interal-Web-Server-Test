import { useEffect, useState } from 'react';
import api from '../api/client';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';

function NewRecordModal({ onClose, onCreated }) {
    const [desc, setDesc]     = useState('');
    const [amount, setAmount] = useState('');
    const [type, setType]     = useState('income');
    const [error, setError]   = useState('');
    const [loading, setLoading] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const { data } = await api.post('/financials', { description: desc, amount: Number(amount), type });
            onCreated(data);
            onClose();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to add record.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-title">Add Financial Record</div>
                {error && <div className="error-msg">{error}</div>}
                <form onSubmit={submit}>
                    <div className="form-group">
                        <label className="form-label">Description</label>
                        <input value={desc} onChange={e => setDesc(e.target.value)} required autoFocus />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Amount ($)</label>
                        <input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Type</label>
                        <select value={type} onChange={e => setType(e.target.value)}>
                            <option value="income">Income</option>
                            <option value="expense">Expense</option>
                        </select>
                    </div>
                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            {loading ? 'Saving...' : 'Add Record'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default function Financials() {
    const { user } = useAuth();
    const [records, setRecords]   = useState([]);
    const [summary, setSummary]   = useState(null);
    const [loading, setLoading]   = useState(true);
    const [showModal, setShowModal] = useState(false);

    const load = async () => {
        try {
            const [recs, sum] = await Promise.all([
                api.get('/financials'),
                api.get('/financials/summary'),
            ]);
            setRecords(recs.data);
            setSummary(sum.data);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const deleteRecord = async (id) => {
        if (!confirm('Delete this record?')) return;
        try {
            await api.delete(`/financials/${id}`);
            setRecords(prev => prev.filter(r => r.id !== id));
            const { data } = await api.get('/financials/summary');
            setSummary(data);
        } catch (e) { console.error(e); }
    };

    const handleCreated = (record) => {
        setRecords(prev => [record, ...prev]);
        api.get('/financials/summary').then(r => setSummary(r.data));
    };

    return (
        <Layout>
            <div className="page-header">
                <h1 className="page-title">Financials <span>{records.length} records</span></h1>
                <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Add Record</button>
            </div>

            {summary && (
                <div className="stats-grid" style={{ marginBottom: 28 }}>
                    <div className="stat-card">
                        <div className="stat-label">Total Income</div>
                        <div className="stat-value green">${Number(summary.total_income).toLocaleString()}</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label">Total Expenses</div>
                        <div className="stat-value red">${Number(summary.total_expenses).toLocaleString()}</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label">Net</div>
                        <div className={`stat-value ${Number(summary.net) >= 0 ? 'green' : 'red'}`}>
                            {Number(summary.net) < 0 ? '-' : ''}${Math.abs(Number(summary.net)).toLocaleString()}
                        </div>
                    </div>
                </div>
            )}

            {loading && <p style={{ color: 'var(--text-dim)' }}>Loading...</p>}

            {!loading && (
                <div className="table-card">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Description</th>
                                <th>Amount</th>
                                <th>Type</th>
                                <th>Added By</th>
                                <th>Date</th>
                                {user.role === 'admin' && <th></th>}
                            </tr>
                        </thead>
                        <tbody>
                            {records.length === 0 && (
                                <tr><td colSpan={7} style={{ color: 'var(--text-dim)', textAlign: 'center', padding: 32 }}>No records found.</td></tr>
                            )}
                            {records.map(r => (
                                <tr key={r.id}>
                                    <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', fontSize: 12 }}>#{r.id}</td>
                                    <td style={{ color: 'var(--text-hi)', fontWeight: 500 }}>{r.description}</td>
                                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: r.type === 'income' ? 'var(--green)' : 'var(--red)' }}>
                                        {r.type === 'income' ? '+' : '-'}${Number(r.amount).toLocaleString()}
                                    </td>
                                    <td>
                                        <span className={`tag ${r.type === 'income' ? 'tag-green' : 'tag-red'}`}>{r.type}</span>
                                    </td>
                                    <td style={{ color: 'var(--text-dim)' }}>{r.creator_name || '—'}</td>
                                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>
                                        {new Date(r.created_at).toLocaleDateString()}
                                    </td>
                                    {user.role === 'admin' && (
                                        <td>
                                            <button className="btn btn-danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => deleteRecord(r.id)}>
                                                Del
                                            </button>
                                        </td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {showModal && (
                <NewRecordModal
                    onClose={() => setShowModal(false)}
                    onCreated={handleCreated}
                />
            )}
        </Layout>
    );
}
