import { useEffect, useState, useMemo } from 'react';
import api from '../api/client';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import './Financials.css';

/* -----------------------------------------------------------------------
   Add financial record modal
   ----------------------------------------------------------------------- */
function NewRecordModal({ onClose, onCreated }) {
    const [desc, setDesc]       = useState('');
    const [amount, setAmount]   = useState('');
    const [type, setType]       = useState('income');
    const [error, setError]     = useState('');
    const [loading, setLoading] = useState(false);

    async function submit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const { data } = await api.post('/financials', {
                description: desc, amount: Number(amount), type,
            });
            onCreated(data);
            onClose();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to add record.');
        } finally {
            setLoading(false);
        }
    }

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
                        <input type="number" min="0.01" step="0.01" value={amount}
                               onChange={e => setAmount(e.target.value)} required />
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
                            {loading ? 'Saving…' : 'Add Record'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

/* -----------------------------------------------------------------------
   Monthly bar chart (pure CSS/flex — no library)
   ----------------------------------------------------------------------- */
function MonthlyChart({ months }) {
    const BAR_H = 110; /* px — matches CSS .fin-bar-wrap height */

    const maxVal = useMemo(() => {
        return Math.max(
            1,
            ...months.map(m => Math.max(m.income, m.expenses, m.fleet))
        );
    }, [months]);

    function px(val) {
        return Math.max(2, Math.round((val / maxVal) * BAR_H));
    }

    function fmt(label) {
        /* 'YYYY-MM' → 'Jan' */
        const [y, mo] = label.split('-');
        return new Date(Number(y), Number(mo) - 1, 1)
            .toLocaleString('en-US', { month: 'short' });
    }

    return (
        <div className="fin-chart-card">
            <div className="fin-chart-title">Monthly Overview — last 12 months</div>
            <div className="fin-chart">
                {months.map(m => (
                    <div className="fin-chart-col" key={m.month}>
                        <div className="fin-bar-wrap">
                            <div className="fin-bar fin-bar-income"  title={`Income $${m.income.toLocaleString()}`}  style={{ height: px(m.income) }} />
                            <div className="fin-bar fin-bar-expense" title={`Expenses $${m.expenses.toLocaleString()}`} style={{ height: px(m.expenses) }} />
                            {m.fleet > 0 && (
                                <div className="fin-bar fin-bar-fleet" title={`Fleet $${m.fleet.toLocaleString()}`} style={{ height: px(m.fleet) }} />
                            )}
                        </div>
                        <span className="fin-chart-label">{fmt(m.month)}</span>
                    </div>
                ))}
            </div>
            <div className="fin-chart-legend">
                <div className="fin-legend-item">
                    <div className="fin-legend-dot" style={{ background: 'var(--green)' }} />
                    Income
                </div>
                <div className="fin-legend-item">
                    <div className="fin-legend-dot" style={{ background: 'var(--red)' }} />
                    Expenses
                </div>
                <div className="fin-legend-item">
                    <div className="fin-legend-dot" style={{ background: 'var(--yellow)' }} />
                    Fleet
                </div>
            </div>
        </div>
    );
}

/* -----------------------------------------------------------------------
   Financial records table
   ----------------------------------------------------------------------- */
function RecordsTable({ records, isAdmin, onDelete }) {
    if (records.length === 0)
        return <div className="fin-empty">No records found.</div>;

    return (
        <div className="fin-table-wrap">
            <table className="fin-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Description</th>
                        <th>Amount</th>
                        <th>Type</th>
                        <th>Added By</th>
                        <th>Date</th>
                        {isAdmin && <th></th>}
                    </tr>
                </thead>
                <tbody>
                    {records.map(r => (
                        <tr key={r.id}>
                            <td className="fin-mono">#{r.id}</td>
                            <td className="fin-name">{r.description}</td>
                            <td className={r.type === 'income' ? 'fin-amount-income' : 'fin-amount-expense'}>
                                {r.type === 'income' ? '+' : '-'}${Number(r.amount).toLocaleString()}
                            </td>
                            <td>
                                <span className={r.type === 'income' ? 'tag-green' : 'tag-red'}>{r.type}</span>
                            </td>
                            <td style={{ color: '#5c6e82' }}>{r.creator_name || '—'}</td>
                            <td className="fin-mono">{new Date(r.created_at).toLocaleDateString()}</td>
                            {isAdmin && (
                                <td>
                                    <button className="btn btn-danger"
                                            style={{ padding: '4px 10px', fontSize: 12 }}
                                            onClick={() => onDelete(r.id)}>
                                        Del
                                    </button>
                                </td>
                            )}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/* -----------------------------------------------------------------------
   Client transactions table
   ----------------------------------------------------------------------- */
function ClientTransactionsTable({ transactions }) {
    if (transactions.length === 0)
        return <div className="fin-empty">No client transactions found.</div>;

    const totals = transactions.reduce(
        (acc, t) => {
            const n = Number(t.amount);
            acc[t.type] = (acc[t.type] || 0) + n;
            return acc;
        },
        {}
    );

    return (
        <div className="fin-table-wrap">
            <table className="fin-table">
                <thead>
                    <tr>
                        <th>Client</th>
                        <th>Description</th>
                        <th>Amount</th>
                        <th>Type</th>
                        <th>Date</th>
                    </tr>
                </thead>
                <tbody>
                    {transactions.map(t => (
                        <tr key={t.id}>
                            <td>
                                <div className="fin-name">{t.client_name}</div>
                                {t.customer_id && <div className="fin-mono">{t.customer_id}</div>}
                            </td>
                            <td style={{ color: '#c9d4e0' }}>{t.description}</td>
                            <td className={t.type === 'payment' ? 'fin-amount-income' : 'fin-amount-expense'}>
                                {t.type === 'payment' ? '+' : ''}${Number(t.amount).toLocaleString()}
                            </td>
                            <td>
                                <span className={
                                    t.type === 'payment' ? 'tag-green' :
                                    t.type === 'invoice' ? 'tag-yellow' : 'tag-dim'
                                }>
                                    {t.type}
                                </span>
                            </td>
                            <td className="fin-mono">
                                {t.date
                                    ? new Date(t.date).toLocaleDateString()
                                    : new Date(t.created_at).toLocaleDateString()}
                            </td>
                        </tr>
                    ))}
                    {/* Totals footer */}
                    {Object.entries(totals).map(([type, sum]) => (
                        <tr key={`total-${type}`} style={{ borderTop: '1px solid #2a3040' }}>
                            <td colSpan={2} style={{ color: '#5c6e82', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                {type} total
                            </td>
                            <td className={type === 'payment' ? 'fin-amount-income' : 'fin-amount-expense'}>
                                ${sum.toLocaleString()}
                            </td>
                            <td /><td />
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/* -----------------------------------------------------------------------
   Inventory asset breakdown table
   ----------------------------------------------------------------------- */
function InventoryTable({ data }) {
    if (!data) return <div className="fin-empty">No inventory data available.</div>;
    const { summary, by_category } = data;
    if (!summary) return <div className="fin-empty">No inventory data available.</div>;

    const markup = summary.cost_value > 0
        ? (((summary.sale_value - summary.cost_value) / summary.cost_value) * 100).toFixed(1)
        : null;

    return (
        <>
            <div className="stats-grid" style={{ marginBottom: 24 }}>
                <div className="stat-card">
                    <div className="stat-label">Items on Hand</div>
                    <div className="stat-value">{Number(summary.total_items).toLocaleString()}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Total Units</div>
                    <div className="stat-value">{Number(summary.total_units).toLocaleString()}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Stock at Cost</div>
                    <div className="stat-value">${Number(summary.cost_value).toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">At Sale Price</div>
                    <div className="stat-value" style={{ color: 'var(--green)' }}>
                        ${Number(summary.sale_value).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                    </div>
                </div>
                {markup && (
                    <div className="stat-card">
                        <div className="stat-label">Avg Markup</div>
                        <div className="stat-value" style={{ color: 'var(--accent)' }}>{markup}%</div>
                    </div>
                )}
            </div>

            <div className="fin-table-wrap">
                <table className="fin-table">
                    <thead>
                        <tr>
                            <th>Category</th>
                            <th style={{ textAlign: 'right' }}>SKUs w/ Stock</th>
                            <th style={{ textAlign: 'right' }}>Units</th>
                            <th style={{ textAlign: 'right' }}>Cost Value</th>
                            <th style={{ textAlign: 'right' }}>Sale Value</th>
                            <th style={{ textAlign: 'right' }}>Markup</th>
                        </tr>
                    </thead>
                    <tbody>
                        {by_category.map(row => {
                            const mu = row.cost_value > 0
                                ? (((row.sale_value - row.cost_value) / row.cost_value) * 100).toFixed(1)
                                : null;
                            return (
                                <tr key={row.category}>
                                    <td className="fin-name" style={{ textTransform: 'capitalize' }}>
                                        {row.category.replace(/_/g, ' ')}
                                    </td>
                                    <td style={{ textAlign: 'right', color: 'var(--text-dim)' }}>{row.item_count}</td>
                                    <td style={{ textAlign: 'right', color: 'var(--text-dim)' }}>{row.total_units}</td>
                                    <td className="fin-mono" style={{ textAlign: 'right' }}>
                                        ${Number(row.cost_value).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                                    </td>
                                    <td className="fin-amount-income fin-mono" style={{ textAlign: 'right' }}>
                                        ${Number(row.sale_value).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                                    </td>
                                    <td className="fin-mono" style={{ textAlign: 'right', color: 'var(--accent)' }}>
                                        {mu ? `${mu}%` : '—'}
                                    </td>
                                </tr>
                            );
                        })}
                        {/* Totals row */}
                        <tr style={{ borderTop: '1px solid var(--border)', fontWeight: 600 }}>
                            <td colSpan={3} style={{ color: 'var(--text-dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total</td>
                            <td className="fin-mono" style={{ textAlign: 'right' }}>
                                ${Number(summary.cost_value).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                            </td>
                            <td className="fin-amount-income fin-mono" style={{ textAlign: 'right' }}>
                                ${Number(summary.sale_value).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                            </td>
                            <td className="fin-mono" style={{ textAlign: 'right', color: 'var(--accent)' }}>
                                {markup ? `${markup}%` : '—'}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </>
    );
}

/* -----------------------------------------------------------------------
   Fleet expenses table
   ----------------------------------------------------------------------- */
function FleetTable({ invoices }) {
    if (invoices.length === 0)
        return <div className="fin-empty">No fleet invoices found.</div>;

    const total = invoices.reduce((s, i) => s + Number(i.amount), 0);

    return (
        <div className="fin-table-wrap">
            <table className="fin-table">
                <thead>
                    <tr>
                        <th>Vehicle</th>
                        <th>Description</th>
                        <th>Amount</th>
                        <th>Date</th>
                    </tr>
                </thead>
                <tbody>
                    {invoices.map(inv => (
                        <tr key={inv.id}>
                            <td>
                                <div className="fin-name">{inv.vehicle_name}</div>
                                <div className="fin-mono">{inv.unit}</div>
                            </td>
                            <td style={{ color: '#c9d4e0' }}>{inv.description}</td>
                            <td className="fin-amount-expense">${Number(inv.amount).toLocaleString()}</td>
                            <td className="fin-mono">
                                {inv.invoice_date
                                    ? new Date(inv.invoice_date).toLocaleDateString()
                                    : new Date(inv.created_at).toLocaleDateString()}
                            </td>
                        </tr>
                    ))}
                    <tr>
                        <td colSpan={2} style={{ color: '#5c6e82', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total</td>
                        <td className="fin-amount-expense">${total.toLocaleString()}</td>
                        <td />
                    </tr>
                </tbody>
            </table>
        </div>
    );
}

/* -----------------------------------------------------------------------
   Main Financials page
   ----------------------------------------------------------------------- */
const TABS = ['records', 'fleet'];

export default function Financials() {
    const { user } = useAuth();
    const isAdmin  = user.role === 'admin';

    const [records,      setRecords]      = useState([]);
    const [summary,      setSummary]      = useState(null);
    const [monthly,      setMonthly]      = useState(null);
    const [fleet,        setFleet]        = useState([]);
    const [clientTx,     setClientTx]     = useState([]);
    const [inventory,    setInventory]    = useState(null);
    const [loading,      setLoading]      = useState(true);
    const [tab,          setTab]          = useState('records');
    const [showModal,    setShowModal]    = useState(false);

    async function load() {
        setLoading(true);
        try {
            const [recs, sum, mon, fl, ctx, inv] = await Promise.all([
                api.get('/financials'),
                api.get('/financials/summary'),
                api.get('/financials/monthly').catch(() => null),
                api.get('/financials/fleet').catch(() => ({ data: [] })),
                api.get('/financials/client-transactions').catch(() => ({ data: [] })),
                api.get('/financials/inventory').catch(() => ({ data: null })),
            ]);
            setRecords(recs.data);
            setSummary(sum.data);
            if (mon) setMonthly(mon.data);
            setFleet(fl.data);
            setClientTx(ctx.data);
            setInventory(inv.data);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { load(); }, []);

    async function handleDelete(id) {
        if (!confirm('Delete this record?')) return;
        try {
            await api.delete(`/financials/${id}`);
            setRecords(prev => prev.filter(r => r.id !== id));
            const { data } = await api.get('/financials/summary');
            setSummary(data);
        } catch (e) { console.error(e); }
    }

    function handleCreated(record) {
        setRecords(prev => [record, ...prev]);
        api.get('/financials/summary').then(r => setSummary(r.data));
        api.get('/financials/monthly').then(r => setMonthly(r.data)).catch(() => {});
    }

    const mrr = monthly?.mrr ?? 0;

    return (
        <Layout>
            <div className="fin-page">
                <div className="fin-header">
                    <h1 className="page-title">Financials</h1>
                    <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Add Record</button>
                </div>

                {/* Summary stats */}
                {summary && (
                    <div className="stats-grid" style={{ marginBottom: 24 }}>
                        <div className="stat-card">
                            <div className="stat-label">Total Income</div>
                            <div className="stat-value" style={{ color: 'var(--green)' }}>
                                ${Number(summary.total_income).toLocaleString()}
                            </div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-label">Total Expenses</div>
                            <div className="stat-value" style={{ color: 'var(--red)' }}>
                                ${Number(summary.total_expenses).toLocaleString()}
                            </div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-label">Net</div>
                            <div className="stat-value"
                                 style={{ color: Number(summary.net) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                {Number(summary.net) < 0 ? '-' : ''}${Math.abs(Number(summary.net)).toLocaleString()}
                            </div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-label">Monthly Recurring (MRR)</div>
                            <div className="stat-value" style={{ color: 'var(--accent)' }}>
                                ${mrr.toLocaleString()}
                            </div>
                        </div>
                        {inventory?.summary && (
                            <>
                                <div className="stat-card">
                                    <div className="stat-label">Stock at Cost</div>
                                    <div className="stat-value">
                                        ${Number(inventory.summary.cost_value).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                                    </div>
                                </div>
                                <div className="stat-card">
                                    <div className="stat-label">At Sale Price</div>
                                    <div className="stat-value" style={{ color: 'var(--green)' }}>
                                        ${Number(inventory.summary.sale_value).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* Monthly chart */}
                {monthly?.months?.length > 0 && (
                    <MonthlyChart months={monthly.months} />
                )}

                {/* Section tabs */}
                <div className="fin-section-tabs">
                    <button className={`fin-tab ${tab === 'records' ? 'active' : ''}`}
                            onClick={() => setTab('records')}>
                        Financial Records
                        <span className="fin-tab-count">{records.length}</span>
                    </button>
                    <button className={`fin-tab ${tab === 'fleet' ? 'active' : ''}`}
                            onClick={() => setTab('fleet')}>
                        Fleet Expenses
                        <span className="fin-tab-count">{fleet.length}</span>
                    </button>
                    <button className={`fin-tab ${tab === 'clients' ? 'active' : ''}`}
                            onClick={() => setTab('clients')}>
                        Client Billing
                        <span className="fin-tab-count">{clientTx.length}</span>
                    </button>
                    <button className={`fin-tab ${tab === 'inventory' ? 'active' : ''}`}
                            onClick={() => setTab('inventory')}>
                        Inventory Assets
                        {inventory?.by_category?.length > 0 && (
                            <span className="fin-tab-count">{inventory.by_category.length}</span>
                        )}
                    </button>
                </div>

                {loading ? (
                    <div className="fin-empty">Loading…</div>
                ) : tab === 'records' ? (
                    <RecordsTable records={records} isAdmin={isAdmin} onDelete={handleDelete} />
                ) : tab === 'fleet' ? (
                    <FleetTable invoices={fleet} />
                ) : tab === 'inventory' ? (
                    <InventoryTable data={inventory} />
                ) : (
                    <ClientTransactionsTable transactions={clientTx} />
                )}
            </div>

            {showModal && (
                <NewRecordModal onClose={() => setShowModal(false)} onCreated={handleCreated} />
            )}
        </Layout>
    );
}
