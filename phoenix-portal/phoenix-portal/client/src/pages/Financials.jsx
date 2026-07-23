import { useEffect, useState, useMemo } from 'react';
import api from '../api/client';
import Layout from '../components/Layout';
import PageHelp from '../components/PageHelp';
import EstimatePrint from '../components/EstimatePrint';
import WorkOrderPrint from '../components/WorkOrderPrint';
import { useAuth } from '../context/AuthContext';
import './Financials.css';

const money  = n => `$${Number(n || 0).toLocaleString()}`;
const money0 = n => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const money2 = n => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const WO_STATUS_OPTS = [
    ['open',        'Open · Invoice'],
    ['closed_paid', 'Closed & Paid · Payment'],
    ['deadbeat',    'Deadbeat · Closed Invoice'],
];
const RFQ_TYPE_OPTS = [
    ['in_progress', 'In Progress'],
    ['complete',    'Complete'],
    ['deadbeat',    'Deadbeat'],
];
const RFQ_TYPE_TAG = { in_progress: 'tag-yellow', complete: 'tag-green', deadbeat: 'tag-red' };

/* Native client <select> — clients fetched once by the parent and passed in. */
function ClientSelect({ clients, value, onChange, placeholder = '— none —' }) {
    return (
        <select value={value || ''} onChange={e => onChange(e.target.value || '')}>
            <option value="">{placeholder}</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
    );
}

/* -----------------------------------------------------------------------
   Create / edit a Work Order
   ----------------------------------------------------------------------- */
function WorkOrderModal({ entry, clients, presetClientId, onSaved, onClose }) {
    const editing = !!entry;
    const [label,    setLabel]    = useState(entry?.label || '');
    const [clientId, setClientId] = useState(entry?.client_id || presetClientId || '');
    const [amount,   setAmount]   = useState(entry?.amount != null ? String(entry.amount) : '');
    const [status,   setStatus]   = useState(entry?.status || 'open');
    /* Work Order document fields */
    const [woNumber,       setWoNumber]       = useState(entry?.wo_number || '');
    const [customerNumber, setCustomerNumber] = useState(entry?.customer_number || '');
    const [woDate,         setWoDate]         = useState(entry?.wo_date ? String(entry.wo_date).slice(0, 10) : '');
    const [scheduled,      setScheduled]      = useState(entry?.scheduled || '');
    const [techOnSite,     setTechOnSite]     = useState(entry?.tech_on_site || '');
    const [contactPhone,   setContactPhone]   = useState(entry?.contact_phone || '');
    const [jobSite,        setJobSite]        = useState(entry?.job_site || '');
    const [lineItems,      setLineItems]      = useState(Array.isArray(entry?.line_items) ? entry.line_items : []);
    const [error,    setError]    = useState('');
    const [saving,   setSaving]   = useState(false);

    /* Picking a client fills the customer # and job site if they're still blank. */
    const pickClient = (id) => {
        setClientId(id);
        const c = clients.find(x => String(x.id) === String(id));
        if (c) {
            if (!customerNumber) setCustomerNumber(c.customer_number || '');
            if (!jobSite.trim()) setJobSite([c.name, c.site_address].filter(Boolean).join('\n'));
        }
    };

    async function submit(e) {
        e.preventDefault(); setError(''); setSaving(true);
        const body = {
            label, client_id: clientId || undefined, amount: Number(amount), status,
            wo_number: woNumber, customer_number: customerNumber, wo_date: woDate || undefined,
            scheduled, tech_on_site: techOnSite, contact_phone: contactPhone, job_site: jobSite,
            line_items: lineItems,
        };
        try {
            const { data } = editing
                ? await api.patch(`/financials/work-orders/${entry.id}`, body)
                : await api.post('/financials/work-orders', body);
            onSaved(data, editing); onClose();
        } catch (err) { setError(err.response?.data?.error || 'Failed to save work order.'); }
        finally { setSaving(false); }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 700, maxHeight: '88vh', overflowY: 'auto' }}>
                <div className="modal-title">{editing ? `Edit Work Order #${entry.id}` : 'New Work Order'}</div>
                {error && <div className="error-msg">{error}</div>}
                <form onSubmit={submit}>
                    <div className="form-group">
                        <label className="form-label">Work Order / Description</label>
                        <input value={label} onChange={e => setLabel(e.target.value)} required autoFocus />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Client (optional)</label>
                        <ClientSelect clients={clients} value={clientId} onChange={pickClient} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Amount ($)</label>
                        <input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Status</label>
                        <select value={status} onChange={e => setStatus(e.target.value)}>
                            {WO_STATUS_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                    </div>

                    {/* ── Work Order document (drives the printable form) ── */}
                    <div style={{ borderTop: '1px solid var(--border)', margin: '16px 0 12px', paddingTop: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                            Work Order document (for the printable form)
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Work Order #</label><input value={woNumber} onChange={e => setWoNumber(e.target.value)} placeholder="e.g. W10605" /></div>
                            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Customer #</label><input value={customerNumber} onChange={e => setCustomerNumber(e.target.value)} /></div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
                            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Date</label><input type="date" value={woDate} onChange={e => setWoDate(e.target.value)} /></div>
                            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Scheduled</label><input value={scheduled} onChange={e => setScheduled(e.target.value)} placeholder="date or TBD" /></div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
                            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Tech On Site</label><input value={techOnSite} onChange={e => setTechOnSite(e.target.value)} /></div>
                            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Contact / Phone</label><input value={contactPhone} onChange={e => setContactPhone(e.target.value)} /></div>
                        </div>
                        <div className="form-group" style={{ marginTop: 14 }}>
                            <label className="form-label">Job Site Information</label>
                            <textarea value={jobSite} onChange={e => setJobSite(e.target.value)} rows={3} placeholder={'The Pharm\n5900 Greenhouse Rd.\nWillcox, AZ 85643'} style={{ resize: 'vertical' }} />
                        </div>
                        <div className="form-group" style={{ marginTop: 14 }}>
                            <label className="form-label">Line Items</label>
                            <LineItemsEditor items={lineItems} onChange={setLineItems} priced={false} />
                        </div>
                    </div>

                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : (editing ? 'Save' : 'Add')}</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

/* -----------------------------------------------------------------------
   Line-items editor — rows of { item, description, rate?, qty }. `priced`
   shows the Rate column + a running total (RFQ estimate); off for Work Orders.
   ----------------------------------------------------------------------- */
function LineItemsEditor({ items, onChange, priced = true }) {
    const setRow = (i, patch) => onChange(items.map((r, idx) => idx === i ? { ...r, ...patch } : r));
    const addRow = () => onChange([...items, { item: '', description: '', rate: '', qty: '' }]);
    const delRow = (i) => onChange(items.filter((_, idx) => idx !== i));
    const lt = r => (r.rate === '' || r.rate == null ? null : Number(r.rate) * (r.qty === '' || r.qty == null ? 1 : Number(r.qty)));
    const grand = items.reduce((s, r) => s + (lt(r) || 0), 0);
    const cols = priced ? '84px 1fr 74px 46px 26px' : '110px 1fr 46px 26px';
    return (
        <div>
            <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 6, fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
                <span>Item</span><span>Description</span>{priced && <span>Rate</span>}<span>Qty</span><span />
            </div>
            {items.map((r, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: cols, gap: 6, marginBottom: 6, alignItems: 'start' }}>
                    <input value={r.item} onChange={e => setRow(i, { item: e.target.value })} style={{ fontSize: 12 }} />
                    <textarea value={r.description} onChange={e => setRow(i, { description: e.target.value })} rows={1} style={{ fontSize: 12, resize: 'vertical' }} />
                    {priced && <input type="number" step="0.01" value={r.rate} onChange={e => setRow(i, { rate: e.target.value })} style={{ fontSize: 12 }} />}
                    <input type="number" step="1" value={r.qty} onChange={e => setRow(i, { qty: e.target.value })} style={{ fontSize: 12 }} />
                    <button type="button" className="btn btn-ghost" style={{ padding: '2px 6px', color: 'var(--red)' }} onClick={() => delRow(i)}>✕</button>
                </div>
            ))}
            <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={addRow}>+ Add line</button>
            {priced && items.length > 0 && (
                <div style={{ textAlign: 'right', marginTop: 6, fontWeight: 600 }}>Total: ${grand.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
            )}
        </div>
    );
}

/* -----------------------------------------------------------------------
   Create / edit an RFQ (snapshot_entries) — also an estimate document
   ----------------------------------------------------------------------- */
function RfqModal({ entry, clients, presetClientId, presetCustomer, onSaved, onClose }) {
    const editing = !!entry;
    const [type,       setType]       = useState(entry?.type || 'in_progress');
    const [clientId,   setClientId]   = useState(entry?.client_id || presetClientId || '');
    const [customer,   setCustomer]   = useState(entry?.customer || presetCustomer || '');
    const [rfq,        setRfq]        = useState(entry?.rfq || '');
    const [hours,      setHours]      = useState(entry?.hours != null ? String(entry.hours) : '');
    const [scheduled,  setScheduled]  = useState(entry?.scheduled_date || '');
    const [invoiceNum, setInvoiceNum] = useState(entry?.invoice_num || '');
    const [emailDate,  setEmailDate]  = useState(entry?.email_date || '');
    const [notes,      setNotes]      = useState(entry?.notes || '');
    /* Estimate document fields */
    const [estimateDate,    setEstimateDate]    = useState(entry?.estimate_date ? String(entry.estimate_date).slice(0, 10) : '');
    const [salesman,        setSalesman]        = useState(entry?.salesman || '');
    const [poNumber,        setPoNumber]        = useState(entry?.po_number || '');
    const [billingAddress,  setBillingAddress]  = useState(entry?.billing_address || '');
    const [projectLocation, setProjectLocation] = useState(entry?.project_location || '');
    const [title,           setTitle]           = useState(entry?.title || '');
    const [subtitle,        setSubtitle]         = useState(entry?.subtitle || '');
    const [lineItems,       setLineItems]        = useState(Array.isArray(entry?.line_items) ? entry.line_items : []);
    const [error,      setError]      = useState('');
    const [saving,     setSaving]     = useState(false);

    /* Linking a client defaults the (still-editable) customer text to its name. */
    const pickClient = (id) => {
        setClientId(id);
        if (id && !customer.trim()) { const c = clients.find(x => String(x.id) === String(id)); if (c) setCustomer(c.name); }
    };

    async function submit(e) {
        e.preventDefault(); setError(''); setSaving(true);
        const body = {
            type, client_id: clientId || undefined, customer, rfq, hours,
            scheduled_date: scheduled, invoice_num: invoiceNum, email_date: emailDate, notes,
            estimate_date: estimateDate || undefined, salesman, po_number: poNumber,
            billing_address: billingAddress, project_location: projectLocation,
            title, subtitle, line_items: lineItems,
        };
        try {
            const { data } = editing
                ? await api.patch(`/snapshot/${entry.id}`, body)
                : await api.post('/snapshot', body);
            onSaved(data, editing); onClose();
        } catch (err) { setError(err.response?.data?.error || 'Failed to save RFQ.'); }
        finally { setSaving(false); }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 700, maxHeight: '88vh', overflowY: 'auto' }}>
                <div className="modal-title">{editing ? `Edit RFQ #${entry.id}` : 'New RFQ'}</div>
                {error && <div className="error-msg">{error}</div>}
                <form onSubmit={submit}>
                    <div className="form-group">
                        <label className="form-label">Client (optional — links it to their page)</label>
                        <ClientSelect clients={clients} value={clientId} onChange={pickClient} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Customer</label>
                        <input value={customer} onChange={e => setCustomer(e.target.value)} required autoFocus />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Status</label>
                            <select value={type} onChange={e => setType(e.target.value)}>
                                {RFQ_TYPE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">RFQ #</label>
                            <input value={rfq} onChange={e => setRfq(e.target.value)} />
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Hours</label>
                            <input type="number" min="0" step="0.25" value={hours} onChange={e => setHours(e.target.value)} />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Scheduled</label>
                            <input value={scheduled} onChange={e => setScheduled(e.target.value)} placeholder="date or TBD" />
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Invoice #</label>
                            <input value={invoiceNum} onChange={e => setInvoiceNum(e.target.value)} />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Email Date</label>
                            <input value={emailDate} onChange={e => setEmailDate(e.target.value)} />
                        </div>
                    </div>
                    <div className="form-group" style={{ marginTop: 14 }}>
                        <label className="form-label">Notes</label>
                        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ resize: 'vertical' }} />
                    </div>

                    {/* ── Estimate document (drives the printable RFQ) ── */}
                    <div style={{ borderTop: '1px solid var(--border)', margin: '16px 0 12px', paddingTop: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                            Estimate document (for the printable RFQ)
                        </div>
                        <div className="form-group">
                            <label className="form-label">Title</label>
                            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. KEYSCAN PANEL SWAP" />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Subtitle</label><input value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder="e.g. CA4500 & CA150" /></div>
                            <div className="form-group" style={{ margin: 0 }}><label className="form-label">P.O. #</label><input value={poNumber} onChange={e => setPoNumber(e.target.value)} /></div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
                            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Estimate Date</label><input type="date" value={estimateDate} onChange={e => setEstimateDate(e.target.value)} /></div>
                            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Salesman</label><input value={salesman} onChange={e => setSalesman(e.target.value)} placeholder="e.g. AM" /></div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
                            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Customer Billing Address</label><textarea value={billingAddress} onChange={e => setBillingAddress(e.target.value)} rows={3} placeholder={'645 E. Missouri Ave #280\nPhoenix, AZ 85012'} style={{ resize: 'vertical' }} /></div>
                            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Project Location</label><textarea value={projectLocation} onChange={e => setProjectLocation(e.target.value)} rows={3} placeholder={'The Pharm\n5900 Greenhouse Rd.\nWillcox, AZ 85643'} style={{ resize: 'vertical' }} /></div>
                        </div>
                        <div className="form-group" style={{ marginTop: 14 }}>
                            <label className="form-label">Line Items</label>
                            <LineItemsEditor items={lineItems} onChange={setLineItems} priced />
                        </div>
                    </div>

                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : (editing ? 'Save' : 'Add')}</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

/* -----------------------------------------------------------------------
   Add an Expense (financial_records, type = expense)
   ----------------------------------------------------------------------- */
function ExpenseModal({ onSaved, onClose }) {
    const [description, setDescription] = useState('');
    const [amount,      setAmount]      = useState('');
    const [error,       setError]       = useState('');
    const [saving,      setSaving]      = useState(false);

    async function submit(e) {
        e.preventDefault(); setError(''); setSaving(true);
        try {
            const { data } = await api.post('/financials', { description, amount: Number(amount), type: 'expense' });
            onSaved(data); onClose();
        } catch (err) { setError(err.response?.data?.error || 'Failed to add expense.'); }
        finally { setSaving(false); }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-title">New Expense</div>
                {error && <div className="error-msg">{error}</div>}
                <form onSubmit={submit}>
                    <div className="form-group">
                        <label className="form-label">Description</label>
                        <input value={description} onChange={e => setDescription(e.target.value)} required autoFocus />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Amount ($)</label>
                        <input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required />
                    </div>
                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Add'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

/* -----------------------------------------------------------------------
   Record a payment against a client (client_transactions type=payment)
   ----------------------------------------------------------------------- */
function PaymentModal({ clientId, clientName, onSaved, onClose }) {
    const [amount,      setAmount]      = useState('');
    const [description, setDescription] = useState('');
    const [date,        setDate]        = useState(() => new Date().toISOString().slice(0, 10));
    const [error,       setError]       = useState('');
    const [saving,      setSaving]      = useState(false);

    async function submit(e) {
        e.preventDefault(); setError(''); setSaving(true);
        try {
            const { data } = await api.post('/financials/payments', { client_id: clientId, amount: Number(amount), description, date });
            onSaved(data); onClose();
        } catch (err) { setError(err.response?.data?.error || 'Failed to add payment.'); setSaving(false); }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-title">New Payment{clientName ? ` — ${clientName}` : ''}</div>
                {error && <div className="error-msg">{error}</div>}
                <form onSubmit={submit}>
                    <div className="form-group">
                        <label className="form-label">Amount ($)</label>
                        <input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required autoFocus />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Description</label>
                        <input value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Check #1024" required />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Date</label>
                        <input type="date" value={date} onChange={e => setDate(e.target.value)} />
                    </div>
                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Add Payment'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

const FREQ_MONTHS = { monthly: 1, quarterly: 3, yearly: 12 };

/* -----------------------------------------------------------------------
   Edit a client's recurring billing (drives ARR + the annual auto-invoice)
   ----------------------------------------------------------------------- */
function BillingModal({ client, onSaved, onClose }) {
    const [amount, setAmount] = useState(client.billing_amount != null ? String(client.billing_amount) : '');
    const [freq,   setFreq]   = useState(client.billing_frequency || 'monthly');
    const [error,  setError]  = useState('');
    const [saving, setSaving] = useState(false);

    const arr = (Number(amount) || 0) * 12 / (FREQ_MONTHS[freq] || 1);

    async function submit(e) {
        e.preventDefault(); setError(''); setSaving(true);
        try {
            await api.patch(`/clients/${client.id}`, { billing_amount: amount === '' ? null : Number(amount), billing_frequency: freq });
            onSaved(); onClose();
        } catch (err) { setError(err.response?.data?.error || 'Failed to update billing.'); setSaving(false); }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-title">Recurring Billing — {client.name}</div>
                {error && <div className="error-msg">{error}</div>}
                <form onSubmit={submit}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Amount ($)</label>
                            <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0 to clear" autoFocus />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Billed</label>
                            <select value={freq} onChange={e => setFreq(e.target.value)}>
                                <option value="monthly">Monthly</option>
                                <option value="quarterly">Quarterly</option>
                                <option value="yearly">Yearly</option>
                            </select>
                        </div>
                    </div>
                    <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 12 }}>
                        Annual recurring (ARR): <strong style={{ color: 'var(--accent)' }}>{money2(arr)}</strong>
                        {Number(amount) > 0 && ' — an invoice for this amount auto-generates each year on the billing anniversary.'}
                    </p>
                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
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
function WorkOrdersTable({ orders, canManage, isAdmin, onEdit, onPatch, onDelete, onPrint }) {
    if (orders.length === 0) return <div className="fin-empty">No work orders yet.</div>;
    return (
        <div className="fin-table-wrap">
            <table className="fin-table">
                <thead>
                    <tr><th>#</th><th>Work Order</th><th>Client</th><th>Amount</th><th>Status</th><th>Added By</th><th>Date</th><th></th></tr>
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
                                    {WO_STATUS_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                </select>
                            </td>
                            <td style={{ color: '#5c6e82' }}>{w.creator_name || '—'}</td>
                            <td className="fin-mono">{new Date(w.created_at).toLocaleDateString()}</td>
                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                                <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => onPrint(w)} title="Open the printable work order">PDF</button>
                                {canManage && <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => onEdit(w)}>Edit</button>}
                                {canManage && isAdmin && <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 12, color: 'var(--red)' }} onClick={() => onDelete(w.id)}>Del</button>}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/* -----------------------------------------------------------------------
   RFQ table (snapshot_entries)
   ----------------------------------------------------------------------- */
function RfqsTable({ rfqs, canManage, onEdit, onDelete, onPrint }) {
    if (rfqs.length === 0) return <div className="fin-empty">No RFQs yet.</div>;
    return (
        <div className="fin-table-wrap">
            <table className="fin-table">
                <thead>
                    <tr><th>#</th><th>Customer</th><th>RFQ</th><th>Status</th><th>Hours</th><th>Scheduled</th><th>Invoice #</th><th>Added</th><th></th></tr>
                </thead>
                <tbody>
                    {rfqs.map(e => (
                        <tr key={e.id}>
                            <td className="fin-mono">#{e.id}</td>
                            <td>
                                <div className="fin-name">{e.client_name || e.customer}</div>
                                {e.client_name && e.customer && e.client_name !== e.customer && (
                                    <div className="fin-mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{e.customer}</div>
                                )}
                            </td>
                            <td className="fin-mono">{e.rfq || '—'}</td>
                            <td><span className={`tag ${RFQ_TYPE_TAG[e.type] || 'tag-dim'}`}>{String(e.type).replace('_', ' ')}</span></td>
                            <td className="fin-mono">{e.hours != null ? e.hours : '—'}</td>
                            <td className="fin-mono">{e.scheduled_date || '—'}</td>
                            <td className="fin-mono">{e.invoice_num || '—'}</td>
                            <td className="fin-mono">{new Date(e.created_at).toLocaleDateString()}</td>
                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                                <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => onPrint(e)} title="Open the printable estimate">PDF</button>
                                {canManage && <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => onEdit(e)}>Edit</button>}
                                {canManage && <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 12, color: 'var(--red)' }} onClick={() => onDelete(e.id)}>Del</button>}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/* Simple invoice/payment table used inside a client's detail. */
function TxTable({ rows, kind }) {
    if (rows.length === 0) return <div className="fin-empty">No {kind} for this client.</div>;
    return (
        <div className="fin-table-wrap">
            <table className="fin-table">
                <thead>
                    <tr><th>Description</th><th style={{ textAlign: 'right' }}>Total</th>
                        {kind === 'invoices' && <><th style={{ textAlign: 'right' }}>Paid</th><th style={{ textAlign: 'right' }}>Balance</th></>}
                        <th>Date</th></tr>
                </thead>
                <tbody>
                    {rows.map(t => {
                        const total   = Number(t.amount) || 0;
                        const paid    = t.paid_amount != null ? Number(t.paid_amount) : null;
                        const balance = t.balance_due != null ? Number(t.balance_due) : total;
                        return (
                            <tr key={t.id}>
                                <td style={{ color: '#c9d4e0' }}>{t.description}</td>
                                <td className="fin-mono" style={{ textAlign: 'right' }}>{money2(total)}</td>
                                {kind === 'invoices' && <>
                                    <td className="fin-amount-income fin-mono" style={{ textAlign: 'right' }}>{paid != null ? money2(paid) : '—'}</td>
                                    <td className="fin-amount-expense fin-mono" style={{ textAlign: 'right' }}>{money2(balance)}</td>
                                </>}
                                <td className="fin-mono">{t.date ? new Date(t.date).toLocaleDateString() : new Date(t.created_at).toLocaleDateString()}</td>
                            </tr>
                        );
                    })}
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
                <div className="stat-card"><div className="stat-label">Stock at Cost</div><div className="stat-value">{money0(summary.cost_value)}</div></div>
                <div className="stat-card"><div className="stat-label">At Sale Price</div><div className="stat-value" style={{ color: 'var(--green)' }}>{money0(summary.sale_value)}</div></div>
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
                                    <td className="fin-mono" style={{ textAlign: 'right' }}>{money0(row.cost_value)}</td>
                                    <td className="fin-amount-income fin-mono" style={{ textAlign: 'right' }}>{money0(row.sale_value)}</td>
                                    <td className="fin-mono" style={{ textAlign: 'right', color: 'var(--accent)' }}>{mu ? `${mu}%` : '—'}</td>
                                </tr>
                            );
                        })}
                        <tr style={{ borderTop: '1px solid var(--border)', fontWeight: 600 }}>
                            <td colSpan={3} style={{ color: 'var(--text-dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total</td>
                            <td className="fin-mono" style={{ textAlign: 'right' }}>{money0(summary.cost_value)}</td>
                            <td className="fin-amount-income fin-mono" style={{ textAlign: 'right' }}>{money0(summary.sale_value)}</td>
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
   MRR breakdown — recurring revenue by source type + ranked clients
   ----------------------------------------------------------------------- */
const MRR_TYPES = [
    { key: 'fire',           label: 'Fire',           color: '#d94040' },
    { key: 'alarm',          label: 'Alarm',          color: '#d9a832' },
    { key: 'access_control', label: 'Access Control', color: '#4a90d9' },
    { key: 'other',          label: 'Other',          color: '#5c6e82' },
];
const SVC_TAG = { fire: 'tag-red', access_control: 'tag-blue', alarm: 'tag-yellow' };

function MrrTab({ data }) {
    if (!data) return <div className="fin-empty">Loading…</div>;
    const clients = data.clients || [];
    if (clients.length === 0) return <div className="fin-empty">No clients have recurring billing set. Add a Monthly Billing amount on the Admin → Billing tab.</div>;

    const total = data.total_mrr || clients.reduce((s, c) => s + Number(c.mrr || 0), 0);

    const buckets = { fire: 0, alarm: 0, access_control: 0, other: 0 };
    for (const c of clients) {
        const svcs = (c.services || []).filter(s => s === 'fire' || s === 'alarm' || s === 'access_control');
        const mrr = Number(c.mrr) || 0;
        if (svcs.length === 0) buckets.other += mrr;
        else { const share = mrr / svcs.length; svcs.forEach(s => { buckets[s] += share; }); }
    }
    const segments = MRR_TYPES.map(t => ({ ...t, value: buckets[t.key] })).filter(s => s.value > 0.0001);

    const R = 60, CX = 80, CY = 80, SW = 30, CIRC = 2 * Math.PI * R;
    let acc = 0;

    return (
        <>
            <div className="stats-grid" style={{ marginBottom: 20 }}>
                <div className="stat-card"><div className="stat-label">Total ARR</div><div className="stat-value" style={{ color: 'var(--accent)' }}>{money2(total * 12)}</div></div>
                <div className="stat-card"><div className="stat-label">Paying Clients</div><div className="stat-value">{clients.length}</div></div>
                <div className="stat-card"><div className="stat-label">Per Month</div><div className="stat-value" style={{ color: 'var(--green)' }}>{money2(total)}</div></div>
            </div>

            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'center', marginBottom: 24 }}>
                <svg viewBox="0 0 160 160" width="180" height="180" style={{ flexShrink: 0 }}>
                    {segments.map(seg => {
                        const frac = seg.value / total;
                        const dash = `${frac * CIRC} ${CIRC}`;
                        const offset = -acc * CIRC;
                        acc += frac;
                        return <circle key={seg.key} cx={CX} cy={CY} r={R} fill="none" stroke={seg.color} strokeWidth={SW} strokeDasharray={dash} strokeDashoffset={offset} transform={`rotate(-90 ${CX} ${CY})`} />;
                    })}
                    <text x={CX} y={CY - 3} textAnchor="middle" style={{ fill: 'var(--text-hi)', fontSize: 15, fontWeight: 600 }}>{money2(total * 12).replace('.00', '')}</text>
                    <text x={CX} y={CY + 14} textAnchor="middle" style={{ fill: 'var(--text-dim)', fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>per year</text>
                </svg>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 240 }}>
                    {segments.map(seg => (
                        <div key={seg.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ width: 12, height: 12, borderRadius: 3, background: seg.color, flexShrink: 0 }} />
                            <span style={{ color: 'var(--text-hi)', minWidth: 110 }}>{seg.label}</span>
                            <span className="fin-mono" style={{ color: 'var(--text-hi)' }}>{money2(seg.value * 12)}</span>
                            <span className="fin-mono" style={{ color: 'var(--text-dim)', marginLeft: 'auto' }}>{((seg.value / total) * 100).toFixed(1)}%</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="fin-table-wrap">
                <table className="fin-table">
                    <thead><tr><th style={{ width: 40 }}>#</th><th>Client</th><th>Sources</th><th style={{ textAlign: 'right' }}>ARR</th><th style={{ textAlign: 'right' }}>Share</th></tr></thead>
                    <tbody>
                        {clients.map((c, i) => {
                            const tags = (c.services || []).filter(s => SVC_TAG[s]);
                            return (
                                <tr key={c.id}>
                                    <td className="fin-mono" style={{ color: 'var(--text-dim)' }}>{i + 1}</td>
                                    <td>
                                        <div className="fin-name">{c.name}</div>
                                        {c.customer_id && <div className="fin-mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{c.customer_id}</div>}
                                    </td>
                                    <td>
                                        {tags.length > 0
                                            ? tags.map(s => <span key={s} className={`tag ${SVC_TAG[s]}`} style={{ marginRight: 4 }}>{s === 'access_control' ? 'access' : s}</span>)
                                            : <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>—</span>}
                                    </td>
                                    <td className="fin-mono" style={{ textAlign: 'right', color: 'var(--text-hi)' }}>{money2(c.mrr * 12)}</td>
                                    <td className="fin-mono" style={{ textAlign: 'right', color: 'var(--text-dim)' }}>{((Number(c.mrr) / total) * 100).toFixed(1)}%</td>
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
   Overview — the Financials landing page (numbers + bar chart + MRR pie)
   ----------------------------------------------------------------------- */
function OverviewTab({ summary, monthly, mrrData }) {
    const mrr = monthly?.mrr ?? 0;
    return (
        <>
            {summary && (
                <div className="stats-grid" style={{ marginBottom: 24 }}>
                    <div className="stat-card">
                        <div className="stat-label">Total Invoiced</div>
                        <div className="stat-value" style={{ color: 'var(--accent)' }}>{money(summary.total_invoiced)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>billed to clients</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label">Paid</div>
                        <div className="stat-value" style={{ color: 'var(--green)' }}>{money(summary.total_paid)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>collected</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label">Balance Due</div>
                        <div className="stat-value" style={{ color: 'var(--red)' }}>{money(summary.balance_due)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>open balance</div>
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
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>paid − expenses</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label">Annual Recurring (ARR)</div>
                        <div className="stat-value" style={{ color: 'var(--accent)' }}>${(mrr * 12).toLocaleString()}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>${mrr.toLocaleString()}/mo</div>
                    </div>
                </div>
            )}

            {monthly?.months?.length > 0 && <MonthlyChart months={monthly.months} />}

            <div className="fin-chart-title" style={{ marginTop: 26 }}>Recurring Revenue by Source</div>
            <MrrTab data={mrrData} />
        </>
    );
}

/* -----------------------------------------------------------------------
   Clients list — clickable, with rolled-up balances
   ----------------------------------------------------------------------- */
function FinClientsList({ clients, onOpen }) {
    const [q, setQ] = useState('');
    const list = (clients || []).filter(c => {
        const s = q.toLowerCase();
        return !q || c.name.toLowerCase().includes(s) || (c.customer_id || '').toLowerCase().includes(s);
    });
    return (
        <>
            <input placeholder="Search clients…" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 320, marginBottom: 14 }} />
            {list.length === 0 ? <div className="fin-empty">No clients with financial activity.</div> : (
                <div className="fin-table-wrap">
                    <table className="fin-table">
                        <thead>
                            <tr><th>Client</th>
                                <th style={{ textAlign: 'right' }}>Invoiced</th>
                                <th style={{ textAlign: 'right' }}>Paid</th>
                                <th style={{ textAlign: 'right' }}>Balance</th>
                                <th style={{ textAlign: 'right' }}>ARR</th>
                                <th style={{ textAlign: 'center' }}>WO</th>
                                <th style={{ textAlign: 'center' }}>RFQ</th></tr>
                        </thead>
                        <tbody>
                            {list.map(c => (
                                <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(c)}>
                                    <td>
                                        <div className="fin-name" style={{ color: 'var(--accent)' }}>{c.name}</div>
                                        {c.customer_id && <div className="fin-mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{c.customer_id}</div>}
                                    </td>
                                    <td className="fin-mono" style={{ textAlign: 'right' }}>{money0(c.invoiced)}</td>
                                    <td className="fin-amount-income fin-mono" style={{ textAlign: 'right' }}>{money0(c.paid)}</td>
                                    <td className="fin-mono" style={{ textAlign: 'right', color: Number(c.balance) > 0 ? 'var(--red)' : 'var(--text-dim)' }}>{money0(c.balance)}</td>
                                    <td className="fin-mono" style={{ textAlign: 'right', color: 'var(--accent)' }}>{Number(c.mrr) > 0 ? money0(c.mrr * 12) : '—'}</td>
                                    <td className="fin-mono" style={{ textAlign: 'center' }}>{c.wo_count > 0 ? `${c.wo_open}/${c.wo_count}` : '—'}</td>
                                    <td className="fin-mono" style={{ textAlign: 'center' }}>{c.rfq_count > 0 ? c.rfq_count : '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </>
    );
}

/* -----------------------------------------------------------------------
   Add a client from the directory onto the Financials list (pins them so they
   show even with no activity yet). Automatic inclusion by activity still applies.
   ----------------------------------------------------------------------- */
function AddClientModal({ clients, existingIds, onAdded, onClose }) {
    const [q,      setQ]      = useState('');
    const [saving, setSaving] = useState(false);
    const [error,  setError]  = useState('');
    const list = clients
        .filter(c => !existingIds.has(c.id))
        .filter(c => { const s = q.toLowerCase(); return !q || c.name.toLowerCase().includes(s) || (c.customer_id || '').toLowerCase().includes(s); })
        .slice(0, 60);

    const add = async (c) => {
        setSaving(true); setError('');
        try { await api.post(`/financials/clients/${c.id}/pin`); onAdded(c); onClose(); }
        catch (err) { setError(err.response?.data?.error || 'Failed to add client.'); setSaving(false); }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
                <div className="modal-title">Add a client to Financials</div>
                {error && <div className="error-msg">{error}</div>}
                <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 12 }}>
                    Pick a client from the directory. Clients with invoices, work orders, or RFQs already show up here automatically.
                </p>
                <input placeholder="Search clients…" value={q} onChange={e => setQ(e.target.value)} autoFocus style={{ width: '100%', marginBottom: 10 }} />
                <div style={{ border: '1px solid var(--border)', borderRadius: 4, maxHeight: 320, overflowY: 'auto' }}>
                    {list.length === 0 ? (
                        <div className="fin-empty" style={{ padding: 16 }}>No matching clients.</div>
                    ) : list.map(c => (
                        <button key={c.id} type="button" disabled={saving} onClick={() => add(c)}
                            style={{ display: 'flex', justifyContent: 'space-between', gap: 10, width: '100%', textAlign: 'left',
                                     background: 'none', border: 'none', borderBottom: '1px solid var(--border)', color: 'var(--text)',
                                     padding: '9px 12px', fontSize: 13, cursor: 'pointer' }}>
                            <span>{c.name}</span>
                            {c.customer_id && <span className="fin-mono" style={{ color: 'var(--text-dim)', fontSize: 11 }}>{c.customer_id}</span>}
                        </button>
                    ))}
                </div>
                <div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button></div>
            </div>
        </div>
    );
}

/* -----------------------------------------------------------------------
   Client detail — summary + a tab per thing (Invoices / Payments / WO / RFQ)
   ----------------------------------------------------------------------- */
function FinClientDetail({ clientId, clients, canManage, isAdmin, onBack, onChanged }) {
    const [data,  setData]  = useState(null);
    const [tab,   setTab]   = useState('invoices');
    const [error, setError] = useState('');
    const [modal, setModal] = useState(null);   // { kind:'wo'|'rfq', entry }
    const [printRfq, setPrintRfq] = useState(null);
    const [printWo,  setPrintWo]  = useState(null);

    const load = () => api.get(`/financials/clients/${clientId}`)
        .then(r => setData(r.data)).catch(() => setError('Failed to load client.'));
    useEffect(() => { setData(null); setError(''); load(); }, [clientId]);

    if (error) return <div className="fin-empty">{error} <button className="btn btn-ghost" onClick={onBack}>← Back</button></div>;
    if (!data) return <div className="fin-empty">Loading…</div>;

    const { client, summary, invoices, payments, work_orders, rfqs } = data;

    const afterChange = () => { load(); onChanged?.(); };

    const deleteWo = async (id) => { if (!confirm('Delete this work order?')) return; await api.delete(`/financials/work-orders/${id}`).catch(() => {}); afterChange(); };
    const patchWo  = async (id, body) => { await api.patch(`/financials/work-orders/${id}`, body).catch(() => {}); afterChange(); };
    const deleteRfq = async (id) => { if (!confirm('Delete this RFQ?')) return; await api.delete(`/snapshot/${id}`).catch(() => {}); afterChange(); };
    const removeFromList = async () => {
        if (!confirm('Remove this client from the Financials list? (They reappear automatically if they have any invoices, work orders, or RFQs.)')) return;
        await api.delete(`/financials/clients/${clientId}/pin`).catch(() => {});
        onChanged?.(); onBack();
    };

    /* Recurring is shown annualized (ARR = monthly-equivalent × 12). */
    const arr = Number(client.mrr) * 12;

    const TABS = [
        ['invoices',    'Invoices',    invoices.length],
        ['payments',    'Payments',    payments.length],
        ['work_orders', 'Work Orders', work_orders.length],
        ['rfqs',        'RFQs',        rfqs.length],
    ];

    return (
        <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <button className="btn btn-ghost" onClick={onBack}>← Clients</button>
                <div>
                    <div style={{ fontSize: 19, fontWeight: 600, color: 'var(--text-hi)' }}>{client.name}</div>
                    {client.customer_id && <span className="fin-mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>{client.customer_id}</span>}
                </div>
                {canManage && client.financials_pinned && (
                    <button className="btn btn-ghost" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-dim)' }}
                        onClick={removeFromList} title="Manually added — remove from the Financials list">Remove from list</button>
                )}
            </div>

            <div className="stats-grid" style={{ marginBottom: 20 }}>
                <div className="stat-card"><div className="stat-label">Invoiced</div><div className="stat-value">{money2(summary.invoiced)}</div></div>
                <div className="stat-card"><div className="stat-label">Paid</div><div className="stat-value" style={{ color: 'var(--green)' }}>{money2(summary.paid)}</div></div>
                <div className="stat-card"><div className="stat-label">Balance Due</div><div className="stat-value" style={{ color: 'var(--red)' }}>{money2(summary.balance)}</div></div>
                <div className="stat-card" onClick={canManage ? () => setModal({ kind: 'billing' }) : undefined}
                    style={canManage ? { cursor: 'pointer' } : undefined}
                    title={canManage ? 'Click to edit recurring billing' : undefined}>
                    <div className="stat-label">Recurring (ARR){canManage && <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}> ✎</span>}</div>
                    <div className="stat-value" style={{ color: 'var(--accent)' }}>{arr > 0 ? money2(arr) : '—'}</div>
                </div>
            </div>

            <div className="fin-section-tabs" style={{ marginBottom: 14, alignItems: 'center' }}>
                {TABS.map(([k, l, n]) => (
                    <button key={k} className={`fin-tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}<span className="fin-tab-count">{n}</span></button>
                ))}
                {canManage && (tab === 'payments' || tab === 'work_orders' || tab === 'rfqs') && (
                    <button className="btn btn-primary" style={{ marginLeft: 'auto', fontSize: 12 }}
                        onClick={() => setModal({ kind: tab === 'payments' ? 'payment' : tab === 'work_orders' ? 'wo' : 'rfq', entry: null })}>
                        + New {tab === 'payments' ? 'Payment' : tab === 'work_orders' ? 'Work Order' : 'RFQ'}
                    </button>
                )}
            </div>

            {tab === 'invoices'    && <TxTable rows={invoices} kind="invoices" />}
            {tab === 'payments'    && <TxTable rows={payments} kind="payments" />}
            {tab === 'work_orders' && <WorkOrdersTable orders={work_orders} canManage={canManage} isAdmin={isAdmin} onEdit={w => setModal({ kind: 'wo', entry: w })} onPatch={patchWo} onDelete={deleteWo} onPrint={setPrintWo} />}
            {tab === 'rfqs'        && <RfqsTable rfqs={rfqs} canManage={canManage} onEdit={e => setModal({ kind: 'rfq', entry: e })} onDelete={deleteRfq} onPrint={setPrintRfq} />}

            {modal?.kind === 'wo' && (
                <WorkOrderModal entry={modal.entry} clients={clients} presetClientId={client.id}
                    onSaved={afterChange} onClose={() => setModal(null)} />
            )}
            {modal?.kind === 'rfq' && (
                <RfqModal entry={modal.entry} clients={clients} presetClientId={client.id} presetCustomer={client.name}
                    onSaved={afterChange} onClose={() => setModal(null)} />
            )}
            {modal?.kind === 'payment' && (
                <PaymentModal clientId={client.id} clientName={client.name} onSaved={afterChange} onClose={() => setModal(null)} />
            )}
            {modal?.kind === 'billing' && (
                <BillingModal client={client} onSaved={afterChange} onClose={() => setModal(null)} />
            )}
            {printRfq && <EstimatePrint rfq={printRfq} onClose={() => setPrintRfq(null)} />}
            {printWo && <WorkOrderPrint wo={printWo} onClose={() => setPrintWo(null)} />}
        </>
    );
}

/* -----------------------------------------------------------------------
   Main Financials page
   ----------------------------------------------------------------------- */
const TOP_TABS = [
    ['overview',   'Overview'],
    ['clients',    'Clients'],
    ['workorders', 'Work Orders'],
    ['rfqs',       'RFQs'],
    ['expenses',   'Expenses'],
    ['fleet',      'Fleet'],
    ['inventory',  'Inventory Assets'],
];

export default function Financials() {
    const { user } = useAuth();
    const isAdmin   = user.role === 'admin';
    const canManage = user.role === 'admin' || user.role === 'accounting';

    const [summary,    setSummary]    = useState(null);
    const [monthly,    setMonthly]    = useState(null);
    const [mrrData,    setMrrData]    = useState(null);
    const [workOrders, setWorkOrders] = useState([]);
    const [rfqs,       setRfqs]       = useState([]);
    const [records,    setRecords]    = useState([]);
    const [fleet,      setFleet]      = useState([]);
    const [inventory,  setInventory]  = useState(null);
    const [finClients, setFinClients] = useState(null);
    const [pickClients, setPickClients] = useState([]);   // for the modal selects
    const [loading,    setLoading]    = useState(true);
    const [tab,        setTab]        = useState('overview');
    const [openClient, setOpenClient] = useState(null);   // client row being viewed
    const [modal,      setModal]      = useState(null);   // { kind, entry }
    const [printRfq,   setPrintRfq]   = useState(null);   // RFQ being printed as an estimate
    const [printWo,    setPrintWo]    = useState(null);   // work order being printed as a form

    const expenses = records.filter(r => r.type === 'expense');

    async function load() {
        setLoading(true);
        try {
            const [sum, mon, mrrRes, wo, rfqRes, recs, fl, inv, fc, pc] = await Promise.all([
                api.get('/financials/summary').catch(() => ({ data: null })),
                api.get('/financials/monthly').catch(() => ({ data: null })),
                api.get('/financials/mrr').catch(() => ({ data: null })),
                api.get('/financials/work-orders').catch(() => ({ data: [] })),
                api.get('/snapshot').catch(() => ({ data: [] })),
                api.get('/financials').catch(() => ({ data: [] })),
                api.get('/financials/fleet').catch(() => ({ data: [] })),
                api.get('/financials/inventory').catch(() => ({ data: null })),
                api.get('/financials/clients').catch(() => ({ data: [] })),
                api.get('/clients', { params: { all: 1 } }).catch(() => ({ data: [] })),
            ]);
            setSummary(sum.data); setMonthly(mon.data); setMrrData(mrrRes.data);
            setWorkOrders(wo.data); setRfqs(rfqRes.data); setRecords(recs.data);
            setFleet(fl.data); setInventory(inv.data); setFinClients(fc.data); setPickClients(pc.data);
        } finally { setLoading(false); }
    }
    useEffect(() => { load(); }, []);

    const refreshMoney = () => {
        api.get('/financials/summary').then(r => setSummary(r.data)).catch(() => {});
        api.get('/financials/clients').then(r => setFinClients(r.data)).catch(() => {});
    };

    /* Work orders */
    const onWoSaved = (wo, editing) => {
        setWorkOrders(prev => editing ? prev.map(w => w.id === wo.id ? wo : w) : [wo, ...prev]);
        refreshMoney();
    };
    const patchWo = async (id, body) => {
        try { const { data } = await api.patch(`/financials/work-orders/${id}`, body); setWorkOrders(prev => prev.map(w => w.id === id ? data : w)); refreshMoney(); }
        catch (e) { console.error(e); }
    };
    const deleteWo = async (id) => {
        if (!confirm('Delete this work order?')) return;
        try { await api.delete(`/financials/work-orders/${id}`); setWorkOrders(prev => prev.filter(w => w.id !== id)); refreshMoney(); }
        catch (e) { console.error(e); }
    };

    /* RFQs */
    const onRfqSaved = (r, editing) => {
        setRfqs(prev => editing ? prev.map(x => x.id === r.id ? r : x) : [r, ...prev]);
        refreshMoney();
    };
    const deleteRfq = async (id) => {
        if (!confirm('Delete this RFQ?')) return;
        try { await api.delete(`/snapshot/${id}`); setRfqs(prev => prev.filter(x => x.id !== id)); refreshMoney(); }
        catch (e) { console.error(e); }
    };

    /* Expenses */
    const onExpenseAdded = (r) => { setRecords(prev => [r, ...prev]); refreshMoney(); api.get('/financials/monthly').then(m => setMonthly(m.data)).catch(() => {}); };
    const deleteExpense = async (id) => {
        if (!confirm('Delete this expense?')) return;
        try { await api.delete(`/financials/${id}`); setRecords(prev => prev.filter(r => r.id !== id)); refreshMoney(); }
        catch (e) { console.error(e); }
    };

    /* Header action button depends on the active tab. */
    const headerAction = () => {
        if (openClient) return null;
        if (tab === 'clients')    return <button className="btn btn-primary" onClick={() => setModal({ kind: 'addclient' })}>+ Add Client</button>;
        if (tab === 'workorders') return <button className="btn btn-primary" onClick={() => setModal({ kind: 'wo', entry: null })}>+ New Work Order</button>;
        if (tab === 'rfqs')       return <button className="btn btn-primary" onClick={() => setModal({ kind: 'rfq', entry: null })}>+ New RFQ</button>;
        if (tab === 'expenses')   return <button className="btn btn-primary" onClick={() => setModal({ kind: 'expense' })}>+ New Expense</button>;
        return null;
    };

    return (
        <Layout>
            <div className="fin-page">
                <div className="fin-header">
                    <h1 className="page-title">Financials<PageHelp id="financials" /></h1>
                    {canManage && headerAction()}
                </div>

                <div className="fin-section-tabs" style={{ marginBottom: 18, flexWrap: 'wrap' }}>
                    {TOP_TABS.map(([k, label]) => (
                        <button key={k} className={`fin-tab ${tab === k ? 'active' : ''}`}
                            onClick={() => { setTab(k); setOpenClient(null); }}>
                            {label}
                        </button>
                    ))}
                </div>

                {loading ? (
                    <div className="fin-empty">Loading…</div>
                ) : tab === 'overview' ? (
                    <OverviewTab summary={summary} monthly={monthly} mrrData={mrrData} />
                ) : tab === 'clients' ? (
                    openClient ? (
                        <FinClientDetail
                            clientId={openClient.id}
                            clients={pickClients}
                            canManage={canManage}
                            isAdmin={isAdmin}
                            onBack={() => setOpenClient(null)}
                            onChanged={() => { refreshMoney(); api.get('/financials/work-orders').then(r => setWorkOrders(r.data)).catch(() => {}); api.get('/snapshot').then(r => setRfqs(r.data)).catch(() => {}); }}
                        />
                    ) : (
                        <FinClientsList clients={finClients} onOpen={setOpenClient} />
                    )
                ) : tab === 'workorders' ? (
                    <WorkOrdersTable orders={workOrders} canManage={canManage} isAdmin={isAdmin}
                        onEdit={w => setModal({ kind: 'wo', entry: w })} onPatch={patchWo} onDelete={deleteWo} onPrint={setPrintWo} />
                ) : tab === 'rfqs' ? (
                    <RfqsTable rfqs={rfqs} canManage={canManage}
                        onEdit={e => setModal({ kind: 'rfq', entry: e })} onDelete={deleteRfq} onPrint={setPrintRfq} />
                ) : tab === 'expenses' ? (
                    <ExpensesTable records={expenses} isAdmin={isAdmin} onDelete={deleteExpense} />
                ) : tab === 'fleet' ? (
                    <FleetTable invoices={fleet} />
                ) : (
                    <InventoryTable data={inventory} />
                )}
            </div>

            {modal?.kind === 'wo' && (
                <WorkOrderModal entry={modal.entry} clients={pickClients} onSaved={onWoSaved} onClose={() => setModal(null)} />
            )}
            {modal?.kind === 'rfq' && (
                <RfqModal entry={modal.entry} clients={pickClients} onSaved={onRfqSaved} onClose={() => setModal(null)} />
            )}
            {modal?.kind === 'expense' && (
                <ExpenseModal onSaved={onExpenseAdded} onClose={() => setModal(null)} />
            )}
            {modal?.kind === 'addclient' && (
                <AddClientModal
                    clients={pickClients}
                    existingIds={new Set((finClients || []).map(c => c.id))}
                    onAdded={(c) => { api.get('/financials/clients').then(r => setFinClients(r.data)).catch(() => {}); setOpenClient({ id: c.id, name: c.name }); }}
                    onClose={() => setModal(null)}
                />
            )}
            {printRfq && <EstimatePrint rfq={printRfq} onClose={() => setPrintRfq(null)} />}
            {printWo && <WorkOrderPrint wo={printWo} onClose={() => setPrintWo(null)} />}
        </Layout>
    );
}