import { useState, useEffect } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import Layout from '../components/Layout';
import './Alarms.css';

const STATUS_CLASS = {
    open:             'tag-yellow',
    in_progress:      'tag-blue',
    resolved:         'tag-green',
    closed:           'tag-dim',
    return_necessary: 'tag-red',
};

const SERVICE_TABS = ['all', 'alarm', 'fire', 'access_control', 'permits'];

/* -----------------------------------------------------------------------
   Alarm Slack feed panel
   ----------------------------------------------------------------------- */
function AlarmFeed({ clientId, clientName }) {
    const [msgs, setMsgs] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.get(`/alarm-slack/client/${clientId}`)
            .then(r => setMsgs(r.data.messages || []))
            .catch(() => setMsgs([]))
            .finally(() => setLoading(false));
    }, [clientId]);

    if (loading) return <div className="alarm-slack-empty">Loading feed…</div>;
    if (!msgs.length) return <div className="alarm-slack-empty">No Slack posts found for {clientName}.</div>;

    return (
        <div className="alarm-slack-feed">
            {msgs.map(m => {
                const f = m.fields || {};
                const date = new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                return (
                    <div key={m.ts} className="alarm-slack-msg">
                        <div className="alarm-slack-date">{date}</div>
                        {Object.entries(f).map(([k, v]) => (
                            <div key={k} className="alarm-slack-field">
                                <div className="alarm-slack-label">{k}</div>
                                <div className="alarm-slack-val">{v}</div>
                            </div>
                        ))}
                        {!Object.keys(f).length && (
                            <div className="alarm-slack-raw">{m.text}</div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

/* -----------------------------------------------------------------------
   Client detail panel
   ----------------------------------------------------------------------- */
function ClientDetail({ client, onClose, onRefresh, technicians }) {
    const { user } = useAuth();
    const canBilling = user.role === 'admin' || user.role === 'accounting';

    const [tab, setTab]           = useState('system');
    const [notes, setNotes]         = useState(client.notes || '');
    const [billing, setBilling]     = useState(client.billing_amount || '');
    const [permitNum, setPermitNum] = useState(client.permit_number || '');
    const [permitExp, setPermitExp] = useState(client.permit_expires ? client.permit_expires.slice(0, 10) : '');
    const [savingNotes, setSavingNotes] = useState(false);
    const [transactions, setTransactions] = useState([]);
    const [txLoading, setTxLoading]       = useState(false);
    const [txForm, setTxForm]     = useState({ description: '', amount: '', type: 'invoice', date: '' });
    const [newTicket, setNewTicket] = useState({ title: '', description: '', assigned_to: '' });
    const [togglingMon, setTogglingMon] = useState(false);
    const [monEnabled, setMonEnabled] = useState(client.monitoring_enabled);

    useEffect(() => {
        if (tab === 'transactions' && canBilling) {
            setTxLoading(true);
            api.get(`/clients/${client.id}/transactions`)
                .then(r => setTransactions(r.data))
                .catch(() => setTransactions([]))
                .finally(() => setTxLoading(false));
        }
    }, [tab, client.id, canBilling]);

    async function saveNotes() {
        setSavingNotes(true);
        await api.patch(`/clients/${client.id}`, {
            notes,
            billing_amount: billing || null,
            permit_number:  permitNum || null,
            permit_expires: permitExp || null,
        });
        setSavingNotes(false);
        onRefresh();
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

    async function addTicket(e) {
        e.preventDefault();
        await api.post(`/clients/${client.id}/tickets`, newTicket);
        setNewTicket({ title: '', description: '', assigned_to: '' });
        onRefresh();
    }

    const svc = (client.services || []);

    return (
        <div className="alarm-detail-overlay" onClick={onClose}>
            <div className="alarm-detail" onClick={e => e.stopPropagation()}>
                <div className="alarm-detail-header">
                    <div>
                        <div className="alarm-detail-name">{client.name}</div>
                        <div className="alarm-detail-meta">
                            <span>{client.customer_id}</span>
                            <span className="alarm-sep">·</span>
                            <span>{client.vendor}</span>
                            {svc.map(s => <span key={s} className={`tag-${s === 'fire' ? 'red' : s === 'access_control' ? 'blue' : 'yellow'} alarm-svc-tag`}>{s}</span>)}
                        </div>
                    </div>
                    <button className="alarm-close-btn" onClick={onClose}>✕</button>
                </div>

                <div className="alarm-tabs">
                    {['system', 'tickets', 'slack', ...(canBilling ? ['billing', 'transactions'] : [])].map(t => (
                        <button key={t} className={`alarm-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                    ))}
                </div>

                <div className="alarm-detail-body">
                    {/* SYSTEM TAB */}
                    {tab === 'system' && (
                        <div className="alarm-section">
                            <div className="alarm-grid">
                                <div className="alarm-field"><div className="alarm-label">System Type</div><div className="alarm-value">{client.system_type || '—'}</div></div>
                                <div className="alarm-field"><div className="alarm-label">Vendor</div><div className="alarm-value">{client.vendor}</div></div>
                                <div className="alarm-field"><div className="alarm-label">Serial #</div><div className="alarm-value">{client.serial_number || '—'}</div></div>
                                <div className="alarm-field"><div className="alarm-label">Connection</div><div className="alarm-value">{client.connection_type || '—'}</div></div>
                                <div className="alarm-field"><div className="alarm-label">Carrier</div><div className="alarm-value">{client.carrier || '—'}</div></div>
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
                            <div className="alarm-grid" style={{ marginTop: 16 }}>
                                <div className="alarm-field">
                                    <div className="alarm-label">Permit #</div>
                                    <input
                                        className="alarm-input"
                                        value={permitNum}
                                        onChange={e => setPermitNum(e.target.value)}
                                        placeholder="e.g. P-12345"
                                    />
                                </div>
                                <div className="alarm-field">
                                    <div className="alarm-label">Permit Expires</div>
                                    <input
                                        className="alarm-input"
                                        type="date"
                                        value={permitExp}
                                        onChange={e => setPermitExp(e.target.value)}
                                    />
                                </div>
                            </div>
                            <div className="alarm-notes-section">
                                <div className="alarm-label">Notes</div>
                                <textarea
                                    className="alarm-notes-input"
                                    value={notes}
                                    onChange={e => setNotes(e.target.value)}
                                    rows={4}
                                    placeholder="Internal notes…"
                                />
                                <button className="btn btn-primary" onClick={saveNotes} disabled={savingNotes}>
                                    {savingNotes ? 'Saving…' : 'Save Notes'}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* TICKETS TAB */}
                    {tab === 'tickets' && (
                        <div className="alarm-section">
                            <form className="alarm-ticket-form" onSubmit={addTicket}>
                                <input
                                    className="alarm-input"
                                    placeholder="New ticket title…"
                                    value={newTicket.title}
                                    onChange={e => setNewTicket(t => ({ ...t, title: e.target.value }))}
                                    required
                                />
                                <input
                                    className="alarm-input"
                                    placeholder="Description (optional)"
                                    value={newTicket.description}
                                    onChange={e => setNewTicket(t => ({ ...t, description: e.target.value }))}
                                />
                                <select
                                    className="alarm-select"
                                    value={newTicket.assigned_to}
                                    onChange={e => setNewTicket(t => ({ ...t, assigned_to: e.target.value }))}
                                >
                                    <option value="">Unassigned</option>
                                    {technicians.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                </select>
                                <button className="btn btn-primary" type="submit">Add Ticket</button>
                            </form>
                            <div className="alarm-ticket-list">
                                {(client.tickets || []).length === 0 && <div className="alarm-empty">No tickets.</div>}
                                {(client.tickets || []).map(tk => (
                                    <div key={tk.id} className="alarm-ticket-row">
                                        <div className="alarm-ticket-title">{tk.title}</div>
                                        <div className="alarm-ticket-meta">
                                            <span className={STATUS_CLASS[tk.status] || 'tag-dim'}>{tk.status}</span>
                                            {tk.assigned_name && <span className="tag-dim">{tk.assigned_name}</span>}
                                            <span className="tag-dim">{new Date(tk.created_at).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* SLACK TAB */}
                    {tab === 'slack' && (
                        <AlarmFeed clientId={client.id} clientName={client.name} />
                    )}

                    {/* BILLING TAB */}
                    {tab === 'billing' && canBilling && (
                        <div className="alarm-section">
                            <div className="alarm-label">Monthly Billing Amount</div>
                            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                                <input
                                    className="alarm-input"
                                    type="number"
                                    step="0.01"
                                    placeholder="0.00"
                                    value={billing}
                                    onChange={e => setBilling(e.target.value)}
                                    style={{ width: '160px' }}
                                />
                                <button className="btn btn-primary" onClick={saveNotes}>Save</button>
                            </div>
                        </div>
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
                </div>
            </div>
        </div>
    );
}

/* -----------------------------------------------------------------------
   Main Alarms page
   ----------------------------------------------------------------------- */
export default function Alarms() {
    const [clients, setClients]       = useState([]);
    const [selected, setSelected]     = useState(null);
    const [serviceTab, setServiceTab] = useState('all');
    const [search, setSearch]         = useState('');
    const [technicians, setTechnicians] = useState([]);
    const [loading, setLoading]       = useState(true);
    const [permits, setPermits]       = useState([]);
    const [permitsLoading, setPermitsLoading] = useState(false);

    function fetchClients() {
        setLoading(true);
        const params = {};
        if (serviceTab !== 'all') params.service = serviceTab;
        if (search) params.search = search;
        api.get('/clients', { params })
            .then(r => setClients(r.data))
            .finally(() => setLoading(false));
    }

    useEffect(() => {
        api.get('/admin/technicians').then(r => setTechnicians(r.data)).catch(() => {});
    }, []);

    useEffect(() => {
        if (serviceTab === 'permits') {
            setPermitsLoading(true);
            api.get('/clients/permits')
                .then(r => setPermits(r.data))
                .catch(() => setPermits([]))
                .finally(() => setPermitsLoading(false));
        } else {
            fetchClients();
        }
    }, [serviceTab, search]);

    async function openClient(c) {
        const r = await api.get(`/clients/${c.id}`);
        setSelected(r.data);
    }

    async function refreshSelected() {
        if (!selected) return;
        const r = await api.get(`/clients/${selected.id}`);
        setSelected(r.data);
        fetchClients();
    }

    return (
        <Layout>
            <div className="alarm-page">
                <div className="alarm-page-header">
                    <h1 className="page-title">Alarms</h1>
                    <input
                        className="alarm-search"
                        placeholder="Search clients…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>

                <div className="alarm-service-tabs">
                    {SERVICE_TABS.map(t => (
                        <button
                            key={t}
                            className={`alarm-tab ${serviceTab === t ? 'active' : ''}`}
                            onClick={() => setServiceTab(t)}
                        >
                            {t === 'all' ? 'All' : t === 'access_control' ? 'Access Control' : t === 'permits' ? 'Permits' : t.charAt(0).toUpperCase() + t.slice(1)}
                            {t !== 'permits' && (
                                <span className="alarm-tab-count">
                                    {t === 'all' ? clients.length : clients.filter(c => (c.services || []).includes(t)).length}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Permit report view */}
                {serviceTab === 'permits' && (
                    <div className="permit-report">
                        {permitsLoading ? (
                            <div className="alarm-empty">Loading…</div>
                        ) : (
                            <div className="table-card">
                                <table className="data-table permit-table">
                                    <thead>
                                        <tr>
                                            <th>Client</th>
                                            <th>ID</th>
                                            <th>Permit #</th>
                                            <th>Expiry</th>
                                            <th>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {permits.length === 0 && (
                                            <tr><td colSpan={5} className="alarm-empty">No permit data on file.</td></tr>
                                        )}
                                        {permits.map(c => {
                                            const days = c.days_until != null ? Number(c.days_until) : null;
                                            let statusTag = null;
                                            if (days === null) statusTag = <span className="tag tag-dim">No expiry set</span>;
                                            else if (days < 0)   statusTag = <span className="tag tag-red">EXPIRED {Math.abs(days)}d ago</span>;
                                            else if (days <= 60) statusTag = <span className="tag tag-yellow">Expires in {days}d</span>;
                                            else                 statusTag = <span className="tag tag-green">Valid ({days}d)</span>;
                                            return (
                                                <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => openClient(c)}>
                                                    <td style={{ fontWeight: 500, color: 'var(--text-hi)' }}>{c.name}</td>
                                                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>{c.customer_id}</td>
                                                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{c.permit_number || <span className="permit-none">—</span>}</td>
                                                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                                                        {c.permit_expires ? new Date(c.permit_expires).toLocaleDateString() : <span className="permit-none">—</span>}
                                                    </td>
                                                    <td>{statusTag}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {serviceTab !== 'permits' && loading ? (
                    <div className="alarm-empty">Loading…</div>
                ) : serviceTab !== 'permits' && (
                    <div className="alarm-client-grid">
                        {clients.length === 0 && <div className="alarm-empty">No clients found.</div>}
                        {clients.map(c => (
                            <div key={c.id} className="alarm-client-card" onClick={() => openClient(c)}>
                                <div className="alarm-client-name">{c.name}</div>
                                <div className="alarm-client-meta">
                                    <span className="tag-dim">{c.customer_id}</span>
                                    {(c.services || []).map(s => (
                                        <span key={s} className={`${s === 'fire' ? 'tag-red' : s === 'access_control' ? 'tag-blue' : 'tag-yellow'}`}>{s}</span>
                                    ))}
                                    {c.monitoring_enabled && <span className="tag-green">monitored</span>}
                                    {c.permit_expires && (() => {
                                        const days = Math.ceil((new Date(c.permit_expires) - new Date()) / 86400000);
                                        if (days > 60) return null;
                                        return <span className={`tag ${days < 0 ? 'tag-red' : 'tag-yellow'}`}>Permit {days < 0 ? 'EXPIRED' : `exp. ${days}d`}</span>;
                                    })()}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {selected && (
                    <ClientDetail
                        client={selected}
                        onClose={() => setSelected(null)}
                        onRefresh={refreshSelected}
                        technicians={technicians}
                    />
                )}
            </div>
        </Layout>
    );
}
