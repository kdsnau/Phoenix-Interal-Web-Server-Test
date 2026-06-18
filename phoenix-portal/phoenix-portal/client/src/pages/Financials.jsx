import { useEffect, useState, useMemo } from 'react';
import api from '../api/client';
import Layout from '../components/Layout';
import PageHelp from '../components/PageHelp';
import { useAuth } from '../context/AuthContext';
import './Financials.css';

const WO_STATUS = {
    open:        { label: 'Open · Invoice',          badge: 'tag-yellow' },
    closed_paid: { label: 'Closed & Paid · Payment', badge: 'tag-green'  },
    deadbeat:    { label: 'Deadbeat · Closed Invoice', badge: 'tag-red'  },
};

/* -----------------------------------------------------------------------
   Add entry modal — a Work Order or an Expense
   ----------------------------------------------------------------------- */
function NewEntryModal({ onClose, onWorkOrder, onExpense }) {
    const [kind, setKind]     = useState('work_order');
    const [label, setLabel]   = useState('');
    const [clientId, setClientId] = useState('');
    const [amount, setAmount] = useState('');
    const [status, setStatus] = useState('open');
    const [desc, setDesc]     = useState('');
    const [clients, setClients] = useState([]);
    const [error, setError]   = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => { api.get('/clients').then(r => setClients(r.data)).catch(() => {}); }, []);

    async function submit(e) {
        e.preventDefault(); setError(''); setLoading(true);
        try {
            if (kind === 'work_order') {
                const { data } = await api.post('/financials/work-orders', {
                    label, client_id: clientId || undefined, amount: Number(amount), status,
                });
                onWorkOrder(data);
            } else {
                const { data } = await api.post('/financials', { description: desc, amount: Number(amount), type: 'expense' });
                onExpense(data);
            }
            onClose();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to add entry.');
        } finally { setLoading(false); }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-title">Add Entry</div>
                {error && <div className="error-msg">{error}</div>}
                <form onSubmit={submit}>
                    <div className="form-group">
                        <label className="form-label">Type</label>
                        <select value={kind} onChange={e => setKind(e.target.value)}>
                            <option value="work_order">Work Order</option>
                            <option value="expense">Expense</option>
                        </select>
                    </div>

                    {kind === 'work_order' ? (
                        <>
                            <div className="form-group">
                                <label className="form-label">Work Order / Description</label>
                                <input value={label} onChange={e => setLabel(e.target.value)} required autoFocus />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Client (optional)</label>
                                <select value={clientId} onChange={e => setClientId(e.target.value)}>
                                    <option value="">— none —</option>
                                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Amount ($)</label>
                                <input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Status</label>
                                <select value={status} onChange={e => setStatus(e.target.value)}>
                                    <option value="open">Open · Invoice</option>
                                    <option value="closed_paid">Closed &amp; Paid · Payment</option>
                                    <option value="deadbeat">Deadbeat · Closed Invoice</option>
                                </select>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="form-group">
                                <label className="form-label">Description</label>
                                <input value={desc} onChange={e => setDesc(e.target.value)} required autoFocus />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Amount ($)</label>
                                <input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required />
                            </div>
                        </>
                    )}

                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Saving…' : 'Add'}</button>
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
    const BAR_H = 110;
    const maxVal = useMemo(() => Math.max(1, ...months.map(m => Math.max(m.income, m.expenses, m.fleet))), [months]);
    const px = val => Math.max(2, Math.round((val / maxVal) * BAR_H));
    const fmt = label => {
        const [y, mo] = label.split('-');
        return new Date(Number(y), Number(mo) - 1, 1).toLocaleString('en-US', { month: 'short' });
    };
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
                <div className="fin-legend-item"><div className="fin-legend-dot" style={{ background: 'var(--green)' }} />Income</div>
                <div className="fin-legend-item"><div className="fin-legend-dot" style={{ background: 'var(--red)' }} />Expenses</div>
                <div className="fin-legend-item"><div className="fin-legend-dot" style={{ background: 'var(--yellow)' }} />Fleet</div>
            </div>
        </div>
    );
}

/* -----------------------------------------------------------------------
   Work orders table
   ----------------------------------------------------------------------- */
function WorkOrdersTable({ orders, isAdmin, onPatch, onDelete }) {
    if (orders.length === 0) return <div className="fin-empty">No work orders yet.</div>;
    return (
        <div className="fin-table-wrap">
            <table className="fin-table">
                <thead>
                    <tr><th>#</th><th>Work Order</th><th>Client</th><th>Amount</th><th>Status</th><th>Added By</th><th>Date</th>{isAdmin && <th></th>}</tr>
                </thead>
                <tbody>
                    {orders.map(w => (
                        <tr key={w.id}>
                            <td className="fin-mono">#{w.id}</td>
                            <td className="fin-name">{w.label}</td>
                            <td>{w.client_name || <span style={{ color: 'var(--text-dim)' }}>—</span>}</td>
                            <td className={w.status === 'closed_paid' ? 'fin-amount-income' : w.status === 'deadbeat' ? 'fin-amount-expense' : 'fin-mono'}>
                                ${Number(w.amount).toLocaleString()}
                            </td>
                            <td>
                                <select value={w.status} onChange={e => onPatch(w.id, { status: e.target.value })}
                                        style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}>
                                    <option value="open">Open · Invoice</option>
                                    <option value="closed_paid">Closed &amp; Paid · Payment</option>
                                    <option value="deadbeat">Deadbeat · Closed Invoice</option>
                                </select>
                            </td>
                            <td style={{ color: '#5c6e82' }}>{w.creator_name || '—'}</td>
                            <td className="fin-mono">{new Date(w.created_at).toLocaleDateString()}</td>
                            {isAdmin && (
                                <td><button className="btn btn-danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => onDelete(w.id)}>Del</button></td>
                            )}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/* -----------------------------------------------------------------------
   Expenses table (financial_records, type = expense)
   ----------------------------------------------------------------------- */
function ExpensesTable({ records, isAdmin, onDelete }) {
    if (records.length === 0) return <div className="fin-empty">No expenses recorded.</div>;
    return (
        <div className="fin-table-wrap">
            <table className="fin-table">
                <thead><tr><th>#</th><th>Description</th><th>Amount</th><th>Added By</th><th>Date</th>{isAdmin && <th></th>}</tr></thead>
                <tbody>
                    {records.map(r => (
                        <tr key={r.id}>
                            <td className="fin-mono">#{r.id}</td>
                            <td className="fin-name">{r.description}</td>
                            <td className="fin-amount-expense">-${Number(r.amount).toLocaleString()}</td>
                            <td style={{ color: '#5c6e82' }}>{r.creator_name || '—'}</td>
                            <td className="fin-mono">{new Date(r.created_at).toLocaleDateString()}</td>
                            {isAdmin && (
                                <td><button className="btn btn-danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => onDelete(r.id)}>Del</button></td>
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
    if (transactions.length === 0) return <div className="fin-empty">No client transactions found.</div>;
    const fmt = n => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

    const invoices    = transactions.filter(t => t.type === 'invoice');
    const sumInvoiced = invoices.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const sumPaid     = invoices.reduce((s, t) => s + (Number(t.paid_amount) || 0), 0);
    const sumBalance  = invoices.reduce((s, t) => s + (t.balance_due != null ? Number(t.balance_due) : (Number(t.amount) || 0)), 0);

    return (
        <>
            {invoices.length > 0 && (
                <div className="stats-grid" style={{ marginBottom: 16 }}>
                    <div className="stat-card"><div className="stat-label">Total Invoiced</div><div className="stat-value">{fmt(sumInvoiced)}</div></div>
                    <div className="stat-card"><div className="stat-label">Paid</div><div className="stat-value" style={{ color: 'var(--green)' }}>{fmt(sumPaid)}</div></div>
                    <div className="stat-card"><div className="stat-label">Balance Due</div><div className="stat-value" style={{ color: 'var(--red)' }}>{fmt(sumBalance)}</div></div>
                </div>
            )}
            <div className="fin-table-wrap">
                <table className="fin-table">
                    <thead><tr><th>Client</th><th>Description</th><th>Type</th><th>Total</th><th>Paid</th><th>Balance Due</th><th>Date</th></tr></thead>
                    <tbody>
                        {transactions.map(t => {
                            const isInvoice = t.type === 'invoice';
                            const total   = Number(t.amount) || 0;
                            const paid    = t.paid_amount != null ? Number(t.paid_amount) : (t.type === 'payment' ? total : null);
                            const balance = t.balance_due != null ? Number(t.balance_due) : (isInvoice ? total : null);
                            return (
                                <tr key={t.id}>
                                    <td>
                                        <div className="fin-name">
                                            {t.client_name}
                                            {t.unmonitored && <span className="tag-dim" style={{ marginLeft: 6, fontSize: 10 }}>unmonitored</span>}
                                        </div>
                                        {t.customer_id && <div className="fin-mono">{t.customer_id}</div>}
                                    </td>
                                    <td style={{ color: '#c9d4e0' }}>{t.description}</td>
                                    <td><span className={t.type === 'payment' ? 'tag-green' : t.type === 'invoice' ? 'tag-yellow' : 'tag-dim'}>{t.type}</span></td>
                                    <td className="fin-mono">{fmt(total)}</td>
                                    <td className="fin-amount-income fin-mono">{paid != null ? fmt(paid) : '—'}</td>
                                    <td className="fin-amount-expense fin-mono">{balance != null ? fmt(balance) : '—'}</td>
                                    <td className="fin-mono">{t.date ? new Date(t.date).toLocaleDateString() : new Date(t.created_at).toLocaleDateString()}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </>
    );
}

/* -----------------------------------------------------------------------
   Inventory asset breakdown table
   ----------------------------------------------------------------------- */
function InventoryTable({ data }) {
    if (!data || !data.summary) return <div className="fin-empty">No inventory data available.</div>;
    const { summary, by_category } = data;
    const markup = summary.cost_value > 0 ? (((summary.sale_value - summary.cost_value) / summary.cost_value) * 100).toFixed(1) : null;
    return (
        <>
            <div className="stats-grid" style={{ marginBottom: 24 }}>
                <div className="stat-card"><div className="stat-label">Items on Hand</div><div className="stat-value">{Number(summary.total_items).toLocaleString()}</div></div>
                <div className="stat-card"><div className="stat-label">Total Units</div><div className="stat-value">{Number(summary.total_units).toLocaleString()}</div></div>
                <div className="stat-card"><div className="stat-label">Stock at Cost</div><div className="stat-value">${Number(summary.cost_value).toLocaleString('en-US', { maximumFractionDigits: 0 })}</div></div>
                <div className="stat-card"><div className="stat-label">At Sale Price</div><div className="stat-value" style={{ color: 'var(--green)' }}>${Number(summary.sale_value).toLocaleString('en-US', { maximumFractionDigits: 0 })}</div></div>
                {markup && <div className="stat-card"><div className="stat-label">Avg Markup</div><div className="stat-value" style={{ color: 'var(--accent)' }}>{markup}%</div></div>}
            </div>
            <div className="fin-table-wrap">
                <table className="fin-table">
                    <thead><tr><th>Category</th><th style={{ textAlign: 'right' }}>SKUs w/ Stock</th><th style={{ textAlign: 'right' }}>Units</th><th style={{ textAlign: 'right' }}>Cost Value</th><th style={{ textAlign: 'right' }}>Sale Value</th><th style={{ textAlign: 'right' }}>Markup</th></tr></thead>
                    <tbody>
                        {by_category.map(row => {
                            const mu = row.cost_value > 0 ? (((row.sale_value - row.cost_value) / row.cost_value) * 100).toFixed(1) : null;
                            return (
                                <tr key={row.category}>
                                    <td className="fin-name" style={{ textTransform: 'capitalize' }}>{row.category.replace(/_/g, ' ')}</td>
                                    <td style={{ textAlign: 'right', color: 'var(--text-dim)' }}>{row.item_count}</td>
                                    <td style={{ textAlign: 'right', color: 'var(--text-dim)' }}>{row.total_units}</td>
                                    <td className="fin-mono" style={{ textAlign: 'right' }}>${Number(row.cost_value).toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                                    <td className="fin-amount-income fin-mono" style={{ textAlign: 'right' }}>${Number(row.sale_value).toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                                    <td className="fin-mono" style={{ textAlign: 'right', color: 'var(--accent)' }}>{mu ? `${mu}%` : '—'}</td>
                                </tr>
                            );
                        })}
                        <tr style={{ borderTop: '1px solid var(--border)', fontWeight: 600 }}>
                            <td colSpan={3} style={{ color: 'var(--text-dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total</td>
                            <td className="fin-mono" style={{ textAlign: 'right' }}>${Number(summary.cost_value).toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                            <td className="fin-amount-income fin-mono" style={{ textAlign: 'right' }}>${Number(summary.sale_value).toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                            <td className="fin-mono" style={{ textAlign: 'right', color: 'var(--accent)' }}>{markup ? `${markup}%` : '—'}</td>
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
    if (invoices.length === 0) return <div className="fin-empty">No fleet invoices found.</div>;
    const total = invoices.reduce((s, i) => s + Number(i.amount), 0);
    return (
        <div className="fin-table-wrap">
            <table className="fin-table">
                <thead><tr><th>Vehicle</th><th>Description</th><th>Amount</th><th>Date</th></tr></thead>
                <tbody>
                    {invoices.map(inv => (
                        <tr key={inv.id}>
                            <td><div className="fin-name">{inv.vehicle_name}</div><div className="fin-mono">{inv.unit}</div></td>
                            <td style={{ color: '#c9d4e0' }}>{inv.description}</td>
                            <td className="fin-amount-expense">${Number(inv.amount).toLocaleString()}</td>
                            <td className="fin-mono">{inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString() : new Date(inv.created_at).toLocaleDateString()}</td>
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
const money = n => `$${Number(n || 0).toLocaleString()}`;

export default function Financials() {
    const { user } = useAuth();
    const isAdmin  = user.role === 'admin';

    const [workOrders, setWorkOrders] = useState([]);
    const [records,    setRecords]    = useState([]);
    const [summary,    setSummary]    = useState(null);
    const [monthly,    setMonthly]    = useState(null);
    const [fleet,      setFleet]      = useState([]);
    const [clientTx,   setClientTx]   = useState([]);
    const [inventory,  setInventory]  = useState(null);
    const [loading,    setLoading]    = useState(true);
    const [tab,        setTab]        = useState('workorders');
    const [showModal,  setShowModal]  = useState(false);
    const [clearMsg,   setClearMsg]   = useState('');

    const expenses = records.filter(r => r.type === 'expense');

    async function load() {
        setLoading(true);
        try {
            const [wo, recs, sum, mon, fl, ctx, inv] = await Promise.all([
                api.get('/financials/work-orders').catch(() => ({ data: [] })),
                api.get('/financials'),
                api.get('/financials/summary'),
                api.get('/financials/monthly').catch(() => null),
                api.get('/financials/fleet').catch(() => ({ data: [] })),
                api.get('/financials/client-transactions').catch(() => ({ data: [] })),
                api.get('/financials/inventory').catch(() => ({ data: null })),
            ]);
            setWorkOrders(wo.data);
            setRecords(recs.data);
            setSummary(sum.data);
            if (mon) setMonthly(mon.data);
            setFleet(fl.data);
            setClientTx(ctx.data);
            setInventory(inv.data);
        } finally { setLoading(false); }
    }

    useEffect(() => { load(); }, []);

    const refreshSummary = () => api.get('/financials/summary').then(r => setSummary(r.data)).catch(() => {});

    async function patchWorkOrder(id, body) {
        try {
            const { data } = await api.patch(`/financials/work-orders/${id}`, body);
            setWorkOrders(prev => prev.map(w => w.id === id ? data : w));
            refreshSummary();
        } catch (e) { console.error(e); }
    }
    async function deleteWorkOrder(id) {
        if (!confirm('Delete this work order?')) return;
        try { await api.delete(`/financials/work-orders/${id}`); setWorkOrders(prev => prev.filter(w => w.id !== id)); refreshSummary(); }
        catch (e) { console.error(e); }
    }
    async function deleteExpense(id) {
        if (!confirm('Delete this expense?')) return;
        try { await api.delete(`/financials/${id}`); setRecords(prev => prev.filter(r => r.id !== id)); refreshSummary(); }
        catch (e) { console.error(e); }
    }
    async function clearUnmonitored() {
        if (!confirm('Delete ALL unmonitored entries (no linked client)? This cannot be undone.')) return;
        setClearMsg('Clearing…');
        try {
            const { data } = await api.post('/financials/clear-unmonitored');
            setClearMsg(`Cleared ${data.deleted} unmonitored entr${data.deleted === 1 ? 'y' : 'ies'}.`);
            const ctx = await api.get('/financials/client-transactions').catch(() => ({ data: [] }));
            setClientTx(ctx.data);
        } catch (e) { setClearMsg(e.response?.data?.error || 'Clear failed.'); }
    }

    const onWorkOrder = (w) => { setWorkOrders(prev => [w, ...prev]); refreshSummary(); };
    const onExpense   = (r) => { setRecords(prev => [r, ...prev]); refreshSummary(); api.get('/financials/monthly').then(m => setMonthly(m.data)).catch(() => {}); };

    const mrr = monthly?.mrr ?? 0;

    return (
        <Layout>
            <div className="fin-page">
                <div className="fin-header">
                    <h1 className="page-title">Financials<PageHelp id="financials" /></h1>
                    <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Add Entry</button>
                </div>

                {summary && (
                    <div className="stats-grid" style={{ marginBottom: 24 }}>
                        <div className="stat-card">
                            <div className="stat-label">Gross Total</div>
                            <div className="stat-value" style={{ color: 'var(--green)' }}>{money(summary.gross_total)}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>payments collected</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-label">Invoice + Gross</div>
                            <div className="stat-value" style={{ color: 'var(--accent)' }}>{money(summary.invoice_gross_total)}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>incl. {money(summary.open_invoice_total)} open</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-label">Expense Total</div>
                            <div className="stat-value" style={{ color: 'var(--red)' }}>{money(summary.expense_total)}</div>
                            {Number(summary.fleet_expenses) > 0 && (
                                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>incl. {money(summary.fleet_expenses)} fleet</div>
                            )}
                        </div>
                        <div className="stat-card">
                            <div className="stat-label">Net</div>
                            <div className="stat-value" style={{ color: Number(summary.net) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                {Number(summary.net) < 0 ? '-' : ''}${Math.abs(Number(summary.net)).toLocaleString()}
                            </div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-label">Unpaid Closed (Deadbeat)</div>
                            <div className="stat-value" style={{ color: 'var(--red)' }}>{money(summary.unpaid_closed_total)}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>excluded from totals</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-label">Monthly Recurring (MRR)</div>
                            <div className="stat-value" style={{ color: 'var(--accent)' }}>${mrr.toLocaleString()}</div>
                        </div>
                    </div>
                )}

                {monthly?.months?.length > 0 && <MonthlyChart months={monthly.months} />}

                <div className="fin-section-tabs">
                    <button className={`fin-tab ${tab === 'workorders' ? 'active' : ''}`} onClick={() => setTab('workorders')}>Work Orders<span className="fin-tab-count">{workOrders.length}</span></button>
                    <button className={`fin-tab ${tab === 'expenses' ? 'active' : ''}`} onClick={() => setTab('expenses')}>Expenses<span className="fin-tab-count">{expenses.length}</span></button>
                    <button className={`fin-tab ${tab === 'fleet' ? 'active' : ''}`} onClick={() => setTab('fleet')}>Fleet Expenses<span className="fin-tab-count">{fleet.length}</span></button>
                    <button className={`fin-tab ${tab === 'clients' ? 'active' : ''}`} onClick={() => setTab('clients')}>Client Billing<span className="fin-tab-count">{clientTx.length}</span></button>
                    <button className={`fin-tab ${tab === 'inventory' ? 'active' : ''}`} onClick={() => setTab('inventory')}>Inventory Assets{inventory?.by_category?.length > 0 && <span className="fin-tab-count">{inventory.by_category.length}</span>}</button>
                </div>

                {loading ? (
                    <div className="fin-empty">Loading…</div>
                ) : tab === 'workorders' ? (
                    <WorkOrdersTable orders={workOrders} isAdmin={isAdmin} onPatch={patchWorkOrder} onDelete={deleteWorkOrder} />
                ) : tab === 'expenses' ? (
                    <ExpensesTable records={expenses} isAdmin={isAdmin} onDelete={deleteExpense} />
                ) : tab === 'fleet' ? (
                    <FleetTable invoices={fleet} />
                ) : tab === 'inventory' ? (
                    <InventoryTable data={inventory} />
                ) : (
                    <>
                        {isAdmin && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                                <button className="btn btn-danger" style={{ fontSize: 12 }} onClick={clearUnmonitored}>Clear all unmonitored entries</button>
                                {clearMsg && <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{clearMsg}</span>}
                            </div>
                        )}
                        <ClientTransactionsTable transactions={clientTx} />
                    </>
                )}
            </div>

            {showModal && <NewEntryModal onClose={() => setShowModal(false)} onWorkOrder={onWorkOrder} onExpense={onExpense} />}
        </Layout>
    );
}
