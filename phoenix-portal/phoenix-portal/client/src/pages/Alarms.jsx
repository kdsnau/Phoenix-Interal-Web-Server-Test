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

    /* Site & contact */
    const [siteAddress,   setSiteAddress]   = useState(client.site_address   || '');
    const [contactName,   setContactName]   = useState(client.contact_name   || '');
    const [contactPhone,  setContactPhone]  = useState(client.contact_phone  || '');
    const [contactEmail,  setContactEmail]  = useState(client.contact_email  || '');
    /* Equipment */
    const [panelBrand,    setPanelBrand]    = useState(client.panel_brand    || '');
    const [panelModel,    setPanelModel]    = useState(client.panel_model    || '');
    const [cameraCount,   setCameraCount]   = useState(client.camera_count   ?? '');
    const [zoneCount,     setZoneCount]     = useState(client.zone_count     ?? '');
    /* Contract */
    const [contractType,  setContractType]  = useState(client.contract_type  || '');
    const [contractStart, setContractStart] = useState(client.contract_start ? client.contract_start.slice(0, 10) : '');
    const [contractEnd,   setContractEnd]   = useState(client.contract_end   ? client.contract_end.slice(0, 10)   : '');
    const [lastInsp,      setLastInsp]      = useState(client.last_inspection ? client.last_inspection.slice(0, 10) : '');
    const [nextInsp,      setNextInsp]      = useState(client.next_inspection ? client.next_inspection.slice(0, 10) : '');
    const [savingContract, setSavingContract] = useState(false);
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
            billing_amount: billing   || null,
            permit_number:  permitNum || null,
            permit_expires: permitExp || null,
            site_address:   siteAddress   || null,
            contact_name:   contactName   || null,
            contact_phone:  contactPhone  || null,
            contact_email:  contactEmail  || null,
            panel_brand:    panelBrand    || null,
            panel_model:    panelModel    || null,
            camera_count:   cameraCount !== '' ? Number(cameraCount) : null,
            zone_count:     zoneCount   !== '' ? Number(zoneCount)   : null,
        });
        setSavingNotes(false);
        onRefresh();
    }

    async function saveContract() {
        setSavingContract(true);
        await api.patch(`/clients/${client.id}`, {
            contract_type:   contractType  || null,
            contract_start:  contractStart || null,
            contract_end:    contractEnd   || null,
            last_inspection: lastInsp      || null,
            next_inspection: nextInsp      || null,
        });
        setSavingContract(false);
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
                    {['system', 'contract', 'tickets', 'slack', ...(canBilling ? ['billing', 'transactions'] : [])].map(t => (
                        <button key={t} className={`alarm-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                    ))}
                </div>

                <div className="alarm-detail-body">
                    {/* SYSTEM TAB */}
                    {tab === 'system' && (
                        <div className="alarm-section">
                            {/* Site & Contact */}
                            <div className="alarm-label" style={{ marginBottom: 8, fontWeight: 600 }}>Site & Contact</div>
                            <div className="alarm-grid" style={{ marginBottom: 12 }}>
                                <div className="alarm-field" style={{ gridColumn: 'span 2' }}>
                                    <div className="alarm-label">Site Address</div>
                                    <input className="alarm-input" value={siteAddress} onChange={e => setSiteAddress(e.target.value)} placeholder="123 Main St, Phoenix AZ 85001" />
                                </div>
                                <div className="alarm-field">
                                    <div className="alarm-label">Contact Name</div>
                                    <input className="alarm-input" value={contactName} onChange={e => setContactName(e.target.value)} placeholder="John Smith" />
                                </div>
                                <div className="alarm-field">
                                    <div className="alarm-label">Contact Phone</div>
                                    <input className="alarm-input" value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="(602) 555-0100" />
                                </div>
                                <div className="alarm-field">
                                    <div className="alarm-label">Contact Email</div>
                                    <input className="alarm-input" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="owner@example.com" />
                                </div>
                            </div>

                            {/* System details */}
                            <div className="alarm-label" style={{ marginBottom: 8, fontWeight: 600 }}>System Details</div>
                            <div className="alarm-grid" style={{ marginBottom: 12 }}>
                                <div className="alarm-field"><div className="alarm-label">System Type</div><div className="alarm-value">{client.system_type || '—'}</div></div>
                                <div className="alarm-field"><div className="alarm-label">Vendor</div><div className="alarm-value">{client.vendor}</div></div>
                                <div className="alarm-field"><div className="alarm-label">Serial #</div><div className="alarm-value">{client.serial_number || '—'}</div></div>
                                <div className="alarm-field"><div className="alarm-label">Connection</div><div className="alarm-value">{client.connection_type || '—'}</div></div>
                                <div className="alarm-field"><div className="alarm-label">Carrier</div><div className="alarm-value">{client.carrier || '—'}</div></div>
                                <div className="alarm-field">
                                    <div className="alarm-label">Panel Brand</div>
                                    <input className="alarm-input" value={panelBrand} onChange={e => setPanelBrand(e.target.value)} placeholder="e.g. DSC, Honeywell" />
                                </div>
                                <div className="alarm-field">
                                    <div className="alarm-label">Panel Model</div>
                                    <input className="alarm-input" value={panelModel} onChange={e => setPanelModel(e.target.value)} placeholder="e.g. PowerSeries Neo" />
                                </div>
                                <div className="alarm-field">
                                    <div className="alarm-label">Cameras</div>
                                    <input className="alarm-input" type="number" min="0" value={cameraCount} onChange={e => setCameraCount(e.target.value)} placeholder="0" />
                                </div>
                                <div className="alarm-field">
                                    <div className="alarm-label">Zones</div>
                                    <input className="alarm-input" type="number" min="0" value={zoneCount} onChange={e => setZoneCount(e.target.value)} placeholder="0" />
                                </div>
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

                            {/* Permit */}
                            <div className="alarm-grid" style={{ marginBottom: 12 }}>
                                <div className="alarm-field">
                                    <div className="alarm-label">Permit #</div>
                                    <input className="alarm-input" value={permitNum} onChange={e => setPermitNum(e.target.value)} placeholder="e.g. P-12345" />
                                </div>
                                <div className="alarm-field">
                                    <div className="alarm-label">Permit Expires</div>
                                    <input className="alarm-input" type="date" value={permitExp} onChange={e => setPermitExp(e.target.value)} />
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
                                    {savingNotes ? 'Saving…' : 'Save'}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* CONTRACT TAB */}
                    {tab === 'contract' && (
                        <div className="alarm-section">
                            <div className="alarm-grid" style={{ marginBottom: 16 }}>
                                <div className="alarm-field">
                                    <div className="alarm-label">Contract Type</div>
                                    <select className="alarm-input" value={contractType} onChange={e => setContractType(e.target.value)}>
                                        <option value="">— Select —</option>
                                        <option value="monitoring">Monitoring Only</option>
                                        <option value="service">Service Only</option>
                                        <option value="full_service">Full Service</option>
                                        <option value="installation">Installation</option>
                                        <option value="time_materials">Time & Materials</option>
                                    </select>
                                </div>
                                <div className="alarm-field">
                                    <div className="alarm-label">Contract Start</div>
                                    <input className="alarm-input" type="date" value={contractStart} onChange={e => setContractStart(e.target.value)} />
                                </div>
                                <div className="alarm-field">
                                    <div className="alarm-label">Contract End</div>
                                    <input className="alarm-input" type="date" value={contractEnd} onChange={e => setContractEnd(e.target.value)} />
                                </div>
                            </div>

                            {/* Contract status badge */}
                            {contractEnd && (() => {
                                const days = Math.ceil((new Date(contractEnd) - new Date()) / 86400000);
                                if (days < 0)   return <div style={{ marginBottom: 12 }}><span className="tag tag-red">Contract EXPIRED {Math.abs(days)}d ago</span></div>;
                                if (days <= 60) return <div style={{ marginBottom: 12 }}><span className="tag tag-yellow">Expires in {days}d</span></div>;
                                return <div style={{ marginBottom: 12 }}><span className="tag tag-green">Active — {days}d remaining</span></div>;
                            })()}

                            <div className="alarm-label" style={{ marginBottom: 8, fontWeight: 600 }}>Inspections</div>
                            <div className="alarm-grid" style={{ marginBottom: 16 }}>
                                <div className="alarm-field">
                                    <div className="alarm-label">Last Inspection</div>
                                    <input className="alarm-input" type="date" value={lastInsp} onChange={e => setLastInsp(e.target.value)} />
                                </div>
                                <div className="alarm-field">
                                    <div className="alarm-label">Next Inspection Due</div>
                                    <input className="alarm-input" type="date" value={nextInsp} onChange={e => setNextInsp(e.target.value)} />
                                </div>
                            </div>

                            {nextInsp && (() => {
                                const days = Math.ceil((new Date(nextInsp) - new Date()) / 86400000);
                                if (days < 0)   return <div style={{ marginBottom: 12 }}><span className="tag tag-red">Inspection OVERDUE by {Math.abs(days)}d</span></div>;
                                if (days <= 30) return <div style={{ marginBottom: 12 }}><span className="tag tag-yellow">Inspection due in {days}d</span></div>;
                                return null;
                            })()}

                            <button className="btn btn-primary" onClick={saveContract} disabled={savingContract}>
                                {savingContract ? 'Saving…' : 'Save Contract'}
                            </button>
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
   Add client modal
   ----------------------------------------------------------------------- */
function NewClientModal({ onClose, onCreated }) {
    const [form, setForm] = useState({
        name: '', customer_id: '', vendor: 'generic', services: [],
    });
    const [error,   setError]   = useState('');
    const [saving,  setSaving]  = useState(false);

    function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

    function toggleService(s) {
        setForm(f => ({
            ...f,
            services: f.services.includes(s)
                ? f.services.filter(x => x !== s)
                : [...f.services, s],
        }));
    }

    async function submit(e) {
        e.preventDefault();
        setError('');
        setSaving(true);
        try {
            const { data } = await api.post('/clients', form);
            onCreated(data);
            onClose();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to create client.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
                <div className="modal-title">Add Client</div>
                {error && <div className="error-msg">{error}</div>}
                <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Client Name *</label>
                            <input value={form.name} onChange={e => set('name', e.target.value)} required autoFocus />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Customer ID *</label>
                            <input value={form.customer_id} onChange={e => set('customer_id', e.target.value)} placeholder="e.g. PHX-001" required />
                        </div>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Vendor / Panel Manufacturer</label>
                        <input value={form.vendor} onChange={e => set('vendor', e.target.value)} placeholder="generic, DSC, Honeywell, Bosch…" />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Services</label>
                        <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
                            {['alarm', 'fire', 'access_control'].map(s => (
                                <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', fontWeight: 400 }}>
                                    <input type="checkbox" checked={form.services.includes(s)} onChange={() => toggleService(s)} />
                                    {s === 'access_control' ? 'Access Control' : s.charAt(0).toUpperCase() + s.slice(1)}
                                </label>
                            ))}
                        </div>
                    </div>
                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>
                            {saving ? 'Adding…' : 'Add Client'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

/* -----------------------------------------------------------------------
   Main Alarms page
   ----------------------------------------------------------------------- */
export default function Alarms() {
    const { user }                          = useAuth();
    const [clients, setClients]             = useState([]);
    const [selected, setSelected]           = useState(null);
    const [serviceTab, setServiceTab]       = useState('all');
    const [search, setSearch]               = useState('');
    const [technicians, setTechnicians]     = useState([]);
    const [loading, setLoading]             = useState(true);
    const [showAddClient, setShowAddClient] = useState(false);
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
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <input
                            className="alarm-search"
                            placeholder="Search clients…"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                        {user.role === 'admin' && (
                            <button className="btn btn-primary" onClick={() => setShowAddClient(true)}>
                                + Add Client
                            </button>
                        )}
                    </div>
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
                {showAddClient && (
                    <NewClientModal
                        onClose={() => setShowAddClient(false)}
                        onCreated={() => { setShowAddClient(false); fetchClients(); }}
                    />
                )}
            </div>
        </Layout>
    );
}
