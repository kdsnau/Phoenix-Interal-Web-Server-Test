import { useEffect, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import Layout from '../components/Layout';
import './Fleet.css';

const VEHICLE_IMAGES = {
    'Nissan NV200':           'https://images.unsplash.com/photo-1632245889029-e406faaa34cd?w=400&q=80',
    'Nissan NV2500':          'https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?w=400&q=80',
    'Nissan NV200 Cargo Van': 'https://images.unsplash.com/photo-1632245889029-e406faaa34cd?w=400&q=80',
    'Nissan Frontier':        'https://images.unsplash.com/photo-1558618047-f4e60cec3c41?w=400&q=80',
    'Tesla Model Y':          'https://images.unsplash.com/photo-1619767886558-efdc259cde1a?w=400&q=80',
    'Trailer Utility':        'https://images.unsplash.com/photo-1586005660802-5f4e8e3b2d4e?w=400&q=80',
};

const PLACEHOLDER = 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=400&q=80';

function getImage(make, model) {
    return VEHICLE_IMAGES[`${make} ${model}`] || PLACEHOLDER;
}

const NOTE_TAG = { service: 'tag-blue', repair: 'tag-yellow', misc: 'tag-dim' };

function VehicleCard({ vehicle, onClick }) {
    const daysUntilTags = vehicle.tags_renewal
        ? Math.ceil((new Date(vehicle.tags_renewal) - new Date()) / 86400000)
        : null;
    const openIssues = Number(vehicle.open_issues) || 0;

    return (
        <div className="vehicle-card" onClick={() => onClick(vehicle)}>
            <div className="vehicle-card-img">
                <img
                    src={getImage(vehicle.make, vehicle.model)}
                    alt={vehicle.name}
                    onError={e => { e.target.src = PLACEHOLDER; }}
                />
            </div>
            <div className="vehicle-card-body">
                <div className="vehicle-card-name">{vehicle.name}</div>
                <div className="vehicle-card-sub">{vehicle.year} {vehicle.make} {vehicle.model}</div>
                {vehicle.driver && (
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>
                        👤 {vehicle.driver}
                    </div>
                )}
                <div className="vehicle-card-meta">
                    <span>{Number(vehicle.mileage).toLocaleString()} mi</span>
                    {openIssues > 0 && (
                        <span className={`tag ${openIssues >= 4 ? 'tag-red' : 'tag-yellow'}`}>
                            {openIssues} open issue{openIssues !== 1 ? 's' : ''}
                        </span>
                    )}
                    {daysUntilTags !== null && (
                        <span className={`tag ${daysUntilTags < 0 ? 'tag-red' : daysUntilTags < 30 ? 'tag-yellow' : 'tag-green'}`}>
                            Tags: {daysUntilTags < 0 ? 'EXPIRED' : `${daysUntilTags}d`}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}

function SlackFeed({ vehicleId, name, make, model, slackName }) {
    const [messages, setMessages] = useState([]);
    const [loading, setLoading]   = useState(true);
    const [error, setError]       = useState('');

    useEffect(() => {
        api.get(`/slack/vehicle/${vehicleId}`, { params: { name, make, model, slackName } })
            .then(r => setMessages(r.data.messages))
            .catch(() => setError('Could not load Slack messages.'))
            .finally(() => setLoading(false));
    }, [vehicleId]);

    return (
        <section className="fleet-section">
            <div className="fleet-section-title">Slack Feed</div>
            {loading && <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>Loading...</div>}
            {error   && <div style={{ color: 'var(--red)', fontSize: 13 }}>{error}</div>}
            {!loading && !error && messages.length === 0 && (
                <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>No messages mentioning this vehicle.</div>
            )}
            <div className="fleet-notes-list">
                {messages.map(m => (
                    <div key={m.ts} className="fleet-note">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span className="tag tag-dim">Slack</span>
                            <span style={{ fontSize: 12, color: 'var(--text-hi)', fontWeight: 500 }}>{m.user}</span>
                            <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>
                                {new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                        </div>
                        <div
                            style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}
                            dangerouslySetInnerHTML={{ __html: m.html }}
                        />
                    </div>
                ))}
            </div>
        </section>
    );
}

/* ── Add inventory item to vehicle modal ──────────────────────────────── */
function AddVehicleInvModal({ vehicleId, onClose, onAdd }) {
    const [allItems, setAllItems]   = useState([]);
    const [search, setSearch]       = useState('');
    const [selectedId, setSelectedId] = useState('');
    const [quantity, setQuantity]   = useState(1);
    const [notes, setNotes]         = useState('');
    const [loading, setLoading]     = useState(false);

    useEffect(() => {
        api.get('/inventory').then(r => setAllItems(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    }, []);

    const filtered = allItems.filter(i =>
        !search || i.name.toLowerCase().includes(search.toLowerCase()) || (i.sku || '').toLowerCase().includes(search.toLowerCase())
    );

    const selected = allItems.find(i => i.id === Number(selectedId));

    const submit = async (e) => {
        e.preventDefault();
        if (!selectedId) return;
        setLoading(true);
        try {
            await onAdd(Number(selectedId), quantity, notes || null);
            onClose();
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
                <div className="modal-title">Add Inventory to Vehicle</div>
                <form onSubmit={submit}>
                    <div className="form-group">
                        <label className="form-label">Search Item</label>
                        <input
                            placeholder="Filter by name or SKU…"
                            value={search}
                            onChange={e => { setSearch(e.target.value); setSelectedId(''); }}
                            autoFocus
                        />
                    </div>
                    {search && (
                        <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 12 }}>
                            {filtered.length === 0 && (
                                <div style={{ padding: '10px 14px', fontSize: 13, color: 'var(--text-dim)' }}>No items found.</div>
                            )}
                            {filtered.map(i => (
                                <div
                                    key={i.id}
                                    onClick={() => { setSelectedId(String(i.id)); setSearch(i.name); }}
                                    style={{
                                        padding: '8px 14px', cursor: 'pointer', fontSize: 13,
                                        background: selectedId === String(i.id) ? 'var(--bg-3)' : 'transparent',
                                        color: 'var(--text-hi)',
                                        borderBottom: '1px solid var(--border)',
                                    }}
                                >
                                    <strong>{i.name}</strong>
                                    {i.sku && <span style={{ color: 'var(--text-dim)', marginLeft: 8, fontSize: 11 }}>{i.sku}</span>}
                                    <span style={{ float: 'right', fontSize: 11, color: 'var(--text-dim)' }}>{i.category}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    {selected && (
                        <div style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 10, fontFamily: 'var(--font-mono)' }}>
                            ✓ Selected: {selected.name} (stock: {selected.quantity} {selected.unit})
                        </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Qty on Vehicle</label>
                            <input type="number" min="0" value={quantity} onChange={e => setQuantity(Number(e.target.value))} required />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Notes (optional)</label>
                            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. stored in rear cabinet" />
                        </div>
                    </div>
                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={!selectedId || loading}>
                            {loading ? 'Adding…' : 'Add to Vehicle'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function VehicleDetail({ vehicleId, onClose }) {
    const [v, setV]                         = useState(null);
    const [loading, setLoading]             = useState(true);
    const [showInsurance, setShowInsurance] = useState(false);
    const [editMileage, setEditMileage]     = useState('');
    const [editReg,     setEditReg]         = useState('');
    const [editTags,    setEditTags]        = useState('');
    const [editDriver,  setEditDriver]      = useState('');
    const [saving, setSaving]               = useState(false);
    const [noteCategory, setNoteCategory]   = useState('service');
    const [noteContent, setNoteContent]     = useState('');
    const [addingNote, setAddingNote]       = useState(false);
    const [invDesc, setInvDesc]             = useState('');
    const [invAmount, setInvAmount]         = useState('');
    const [invDate, setInvDate]             = useState('');
    const [addingInv, setAddingInv]         = useState(false);
    const [sending, setSending]             = useState('');
    const [msg, setMsg]                     = useState('');
    const [showResolved, setShowResolved]   = useState(false);
    const [showInvModal, setShowInvModal]   = useState(false);

    const load = async () => {
        try {
            const { data } = await api.get(`/fleet/${vehicleId}`);
            setV(data);
            setEditMileage(data.mileage);
            setEditReg(data.registration || '');
            setEditTags(data.tags_renewal ? data.tags_renewal.slice(0, 10) : '');
            setEditDriver(data.driver || '');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, [vehicleId]);

    const saveVehicle = async () => {
        setSaving(true);
        try {
            const { data } = await api.patch(`/fleet/${vehicleId}`, {
                mileage:      Number(editMileage),
                registration: editReg      || null,
                tags_renewal: editTags     || null,
                driver:       editDriver   || null,
            });
            setV(prev => ({ ...prev, ...data }));
            setMsg('Saved.');
            setTimeout(() => setMsg(''), 2000);
        } finally {
            setSaving(false);
        }
    };

    const addNote = async (e) => {
        e.preventDefault();
        setAddingNote(true);
        try {
            const { data } = await api.post(`/fleet/${vehicleId}/notes`, { category: noteCategory, content: noteContent });
            setV(prev => ({ ...prev, notes: [data, ...prev.notes] }));
            setNoteContent('');
        } finally {
            setAddingNote(false);
        }
    };

    const deleteNote = async (noteId) => {
        await api.delete(`/fleet/${vehicleId}/notes/${noteId}`);
        setV(prev => ({ ...prev, notes: prev.notes.filter(n => n.id !== noteId) }));
    };

    const resolveNote = async (noteId, resolved) => {
        const { data } = await api.patch(`/fleet/${vehicleId}/notes/${noteId}`, { resolved });
        setV(prev => ({ ...prev, notes: prev.notes.map(n => n.id === noteId ? data : n) }));
    };

    const addVehicleInv = async (itemId, quantity, notes) => {
        const { data } = await api.post(`/fleet/${vehicleId}/inventory`, { inventory_item_id: itemId, quantity, notes });
        setV(prev => ({
            ...prev,
            inventory: prev.inventory.some(i => i.id === data.id)
                ? prev.inventory.map(i => i.id === data.id ? data : i)
                : [...prev.inventory, data],
        }));
    };

    const adjustVehicleInv = async (assignId, quantity) => {
        const { data } = await api.patch(`/fleet/${vehicleId}/inventory/${assignId}`, { quantity });
        setV(prev => ({ ...prev, inventory: prev.inventory.map(i => i.id === assignId ? data : i) }));
    };

    const removeVehicleInv = async (assignId) => {
        await api.delete(`/fleet/${vehicleId}/inventory/${assignId}`);
        setV(prev => ({ ...prev, inventory: prev.inventory.filter(i => i.id !== assignId) }));
    };

    const addInvoice = async (e) => {
        e.preventDefault();
        setAddingInv(true);
        try {
            const { data } = await api.post(`/fleet/${vehicleId}/invoices`, {
                description: invDesc, amount: Number(invAmount), invoice_date: invDate,
            });
            setV(prev => ({ ...prev, invoices: [data, ...prev.invoices] }));
            setInvDesc(''); setInvAmount(''); setInvDate('');
        } finally {
            setAddingInv(false);
        }
    };

    const deleteInvoice = async (invId) => {
        await api.delete(`/fleet/${vehicleId}/invoices/${invId}`);
        setV(prev => ({ ...prev, invoices: prev.invoices.filter(i => i.id !== invId) }));
    };

    const sendEmail = async (type) => {
        setSending(type);
        setMsg('');
        try {
            const { data } = await api.post(`/fleet/${vehicleId}/${type}`);
            setMsg(data.message);
            if (type === 'send-service-email') await load();
        } catch {
            setMsg('Email failed — check SMTP config.');
        } finally {
            setSending('');
            setTimeout(() => setMsg(''), 4000);
        }
    };

    if (loading) return (
        <div className="modal-overlay">
            <div className="modal" style={{ textAlign: 'center', color: 'var(--text-dim)' }}>Loading...</div>
        </div>
    );

    const daysUntilTags = v.tags_renewal
        ? Math.ceil((new Date(v.tags_renewal) - new Date()) / 86400000)
        : null;

    const totalInvoices = (v.invoices || []).reduce((sum, i) => sum + Number(i.amount), 0);

    return (
        <>
        <div className="modal-overlay fleet-overlay" onClick={onClose}>
            <div className="fleet-detail" onClick={e => e.stopPropagation()}>
                <div className="fleet-detail-header">
                    <img
                        className="fleet-detail-img"
                        src={getImage(v.make, v.model)}
                        alt={v.name}
                        onError={e => { e.target.src = PLACEHOLDER; }}
                    />
                    <div className="fleet-detail-title">
                        <div className="fleet-detail-name">{v.name}</div>
                        <div className="fleet-detail-sub">{v.year} {v.make} {v.model}</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
                            ID: {v.vehicle_id}
                        </div>
                    </div>
                    <button className="fleet-close" onClick={onClose}>✕</button>
                </div>

                <div className="fleet-detail-body">

                    <section className="fleet-section">
                        <div className="fleet-section-title">Vehicle Info</div>
                        <div className="fleet-fields">
                            <div className="fleet-field">
                                <label className="form-label">Mileage</label>
                                <input type="number" value={editMileage} onChange={e => setEditMileage(e.target.value)} />
                            </div>
                            <div className="fleet-field">
                                <label className="form-label">Registration</label>
                                <input value={editReg} onChange={e => setEditReg(e.target.value)} />
                            </div>
                            <div className="fleet-field">
                                <label className="form-label">Tags Renewal</label>
                                <input type="date" value={editTags} onChange={e => setEditTags(e.target.value)} />
                            </div>
                            <div className="fleet-field">
                                <label className="form-label">Driver</label>
                                <input value={editDriver} onChange={e => setEditDriver(e.target.value)} placeholder="Assigned driver" />
                            </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                            <button className="btn btn-primary" onClick={saveVehicle} disabled={saving}>
                                {saving ? 'Saving...' : 'Save Changes'}
                            </button>
                            {daysUntilTags !== null && (
                                <span className={`tag ${daysUntilTags < 0 ? 'tag-red' : daysUntilTags < 30 ? 'tag-yellow' : 'tag-green'}`}>
                                    Tags {daysUntilTags < 0 ? 'EXPIRED' : `due in ${daysUntilTags}d`}
                                </span>
                            )}
                            {msg && <span style={{ fontSize: 12, color: 'var(--green)' }}>{msg}</span>}
                        </div>
                    </section>

                    <section className="fleet-section">
                        <div className="fleet-section-title">Notifications</div>
                        <div className="fleet-notif-row">
                            <div>
                                <div style={{ fontSize: 13, color: 'var(--text-hi)', fontWeight: 500 }}>Service Reminder</div>
                                <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                                    Every 3 months · Next due: {v.next_due_at ? new Date(v.next_due_at).toLocaleDateString() : 'N/A'}
                                    {v.last_sent_at && ` · Last sent: ${new Date(v.last_sent_at).toLocaleDateString()}`}
                                </div>
                            </div>
                            <button className="btn btn-ghost" onClick={() => sendEmail('send-service-email')} disabled={sending === 'send-service-email'}>
                                {sending === 'send-service-email' ? 'Sending...' : 'Send Now'}
                            </button>
                        </div>
                        <div className="fleet-notif-row" style={{ marginTop: 10 }}>
                            <div>
                                <div style={{ fontSize: 13, color: 'var(--text-hi)', fontWeight: 500 }}>Tags Renewal Reminder</div>
                                <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                                    Annual · Due: {v.tags_renewal ? new Date(v.tags_renewal).toLocaleDateString() : 'Not set'}
                                </div>
                            </div>
                            <button className="btn btn-ghost" onClick={() => sendEmail('send-tags-email')} disabled={sending === 'send-tags-email'}>
                                {sending === 'send-tags-email' ? 'Sending...' : 'Send Now'}
                            </button>
                        </div>
                        {msg && <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 8 }}>{msg}</div>}
                    </section>

                    <section className="fleet-section">
                        <div className="fleet-section-title">Insurance</div>
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button className="btn btn-ghost" onClick={() => setShowInsurance(!showInsurance)}>
                                {showInsurance ? 'Hide Insurance' : 'View Insurance'}
                            </button>
                            <a className="btn btn-ghost" href="/placeholder-insurance.png" download="insurance.png" style={{ textDecoration: 'none' }}>
                                Download
                            </a>
                        </div>
                        {showInsurance && (
                            <div className="fleet-insurance-preview">
                                <div style={{
                                    background: 'var(--bg-3)',
                                    border: '1px dashed var(--border-hi)',
                                    borderRadius: 'var(--radius)',
                                    padding: 40,
                                    textAlign: 'center',
                                    color: 'var(--text-dim)',
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: 12,
                                    marginTop: 12,
                                }}>
                                    [ Insurance document placeholder ]<br />
                                    <span style={{ fontSize: 11, marginTop: 6, display: 'block' }}>
                                        Upload insurance image to server/uploads/ to display here
                                    </span>
                                </div>
                            </div>
                        )}
                    </section>

                    <section className="fleet-section">
                        <div className="fleet-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>
                                Notes
                                {v.notes.filter(n => !n.resolved).length > 0 && (
                                    <span style={{ marginLeft: 8, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--yellow)', fontWeight: 400 }}>
                                        {v.notes.filter(n => !n.resolved).length} open
                                    </span>
                                )}
                            </span>
                            <button
                                className="btn btn-ghost"
                                style={{ fontSize: 11, padding: '3px 10px' }}
                                onClick={() => setShowResolved(s => !s)}
                            >
                                {showResolved ? 'Hide resolved' : 'Show resolved'}
                            </button>
                        </div>
                        <form onSubmit={addNote} style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                            <select value={noteCategory} onChange={e => setNoteCategory(e.target.value)} style={{ width: 'auto', flexShrink: 0 }}>
                                <option value="service">Service</option>
                                <option value="repair">Repair</option>
                                <option value="misc">Misc</option>
                            </select>
                            <input
                                value={noteContent}
                                onChange={e => setNoteContent(e.target.value)}
                                placeholder="Add a note..."
                                required
                                style={{ flex: 1, minWidth: 200 }}
                            />
                            <button type="submit" className="btn btn-primary" disabled={addingNote}>
                                {addingNote ? 'Adding...' : 'Add'}
                            </button>
                        </form>
                        <div className="fleet-notes-list">
                            {v.notes.filter(n => showResolved || !n.resolved).length === 0 && (
                                <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>
                                    {v.notes.length === 0 ? 'No notes yet.' : 'All issues resolved.'}
                                </div>
                            )}
                            {v.notes.filter(n => showResolved || !n.resolved).map(n => (
                                <div key={n.id} className={`fleet-note ${n.resolved ? 'fleet-note--resolved' : ''}`}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                        <span className={`tag ${n.resolved ? 'tag-green' : NOTE_TAG[n.category]}`}>
                                            {n.resolved ? '✓ resolved' : n.category}
                                        </span>
                                        <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                                            {new Date(n.created_at).toLocaleDateString()}
                                        </span>
                                        {n.resolved && n.resolved_at && (
                                            <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                                                → {new Date(n.resolved_at).toLocaleDateString()}
                                            </span>
                                        )}
                                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                                            <button
                                                onClick={() => resolveNote(n.id, !n.resolved)}
                                                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: n.resolved ? 'var(--text-dim)' : 'var(--green)', fontSize: 11, cursor: 'pointer', padding: '1px 8px' }}
                                            >
                                                {n.resolved ? 'Reopen' : 'Resolve'}
                                            </button>
                                            <button onClick={() => deleteNote(n.id)} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 12, cursor: 'pointer', padding: '0 4px' }}>✕</button>
                                        </div>
                                    </div>
                                    <div style={{ fontSize: 13, color: n.resolved ? 'var(--text-dim)' : 'var(--text)', textDecoration: n.resolved ? 'line-through' : 'none' }}>{n.content}</div>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="fleet-section">
                        <div className="fleet-section-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Invoices</span>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--green)', fontWeight: 400 }}>
                                Total: ${totalInvoices.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </span>
                        </div>
                        <form onSubmit={addInvoice} style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                            <input value={invDesc} onChange={e => setInvDesc(e.target.value)} placeholder="Description" required style={{ flex: 2, minWidth: 160 }} />
                            <input type="number" value={invAmount} onChange={e => setInvAmount(e.target.value)} placeholder="Amount" min="0.01" step="0.01" required style={{ width: 110, flexShrink: 0 }} />
                            <input type="date" value={invDate} onChange={e => setInvDate(e.target.value)} required style={{ width: 140, flexShrink: 0 }} />
                            <button type="submit" className="btn btn-primary" disabled={addingInv}>
                                {addingInv ? 'Adding...' : 'Add'}
                            </button>
                        </form>
                        <div className="table-card">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Description</th>
                                        <th>Amount</th>
                                        <th>Date</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {v.invoices.length === 0 && (
                                        <tr><td colSpan={4} style={{ color: 'var(--text-dim)', textAlign: 'center', padding: 20 }}>No invoices yet.</td></tr>
                                    )}
                                    {v.invoices.map(inv => (
                                        <tr key={inv.id}>
                                            <td style={{ color: 'var(--text-hi)' }}>{inv.description}</td>
                                            <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>
                                                ${Number(inv.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                            </td>
                                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>
                                                {new Date(inv.invoice_date).toLocaleDateString()}
                                            </td>
                                            <td>
                                                <button className="btn btn-danger" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => deleteInvoice(inv.id)}>Del</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>
                    {/* ── Vehicle Inventory ── */}
                    <section className="fleet-section">
                        <div className="fleet-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>
                                Inventory
                                {(v.inventory || []).length > 0 && (
                                    <span style={{ marginLeft: 8, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }}>
                                        {(v.inventory || []).length} item{(v.inventory || []).length !== 1 ? 's' : ''}
                                    </span>
                                )}
                            </span>
                            <button className="btn btn-primary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => setShowInvModal(true)}>
                                + Add Item
                            </button>
                        </div>

                        {(v.inventory || []).length === 0 ? (
                            <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>No inventory assigned to this vehicle yet.</div>
                        ) : (
                            <div className="table-card">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Item</th>
                                            <th>Category</th>
                                            <th>Qty on Vehicle</th>
                                            <th>Notes</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(v.inventory || []).map(item => (
                                            <tr key={item.id}>
                                                <td>
                                                    <div style={{ fontWeight: 500, color: 'var(--text-hi)' }}>{item.item_name}</div>
                                                    {item.sku && <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{item.sku}</div>}
                                                </td>
                                                <td><span className="tag tag-dim">{item.category}</span></td>
                                                <td>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                        <button
                                                            onClick={() => adjustVehicleInv(item.id, Math.max(0, item.quantity - 1))}
                                                            style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', width: 24, height: 24, cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
                                                        >−</button>
                                                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, minWidth: 24, textAlign: 'center' }}>
                                                            {item.quantity}
                                                        </span>
                                                        <button
                                                            onClick={() => adjustVehicleInv(item.id, item.quantity + 1)}
                                                            style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', width: 24, height: 24, cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
                                                        >+</button>
                                                        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{item.unit}</span>
                                                    </div>
                                                </td>
                                                <td style={{ fontSize: 12, color: 'var(--text-dim)' }}>{item.notes || '—'}</td>
                                                <td>
                                                    <button
                                                        className="btn btn-danger"
                                                        style={{ padding: '3px 8px', fontSize: 11 }}
                                                        onClick={() => removeVehicleInv(item.id)}
                                                    >
                                                        Remove
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </section>

                    <SlackFeed vehicleId={v.vehicle_id} name={v.name} make={v.make} model={v.model} slackName={v.slack_name} />
                </div>
            </div>
        </div>

        {showInvModal && (
            <AddVehicleInvModal
                vehicleId={vehicleId}
                onClose={() => setShowInvModal(false)}
                onAdd={addVehicleInv}
            />
        )}
        </>
    );
}

/* ── Add vehicle modal ────────────────────────────────────────────────── */
function NewVehicleModal({ onClose, onCreated }) {
    const [form, setForm] = useState({
        name: '', vehicle_id: '', make: '', model: '',
        year: '', mileage: '0', tags_renewal: '', slack_name: '', driver: '',
    });
    const [error,  setError]  = useState('');
    const [saving, setSaving] = useState(false);

    function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

    async function submit(e) {
        e.preventDefault();
        setError('');
        setSaving(true);
        try {
            const { data } = await api.post('/fleet', form);
            onCreated(data);
            onClose();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to create vehicle.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
                <div className="modal-title">Add Vehicle</div>
                {error && <div className="error-msg">{error}</div>}
                <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Display Name *</label>
                            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. NV200 #3" required autoFocus />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Unit # (Vehicle ID) *</label>
                            <input value={form.vehicle_id} onChange={e => set('vehicle_id', e.target.value)} placeholder="e.g. NV200-3" required />
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Make</label>
                            <input value={form.make} onChange={e => set('make', e.target.value)} placeholder="Nissan" />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Model</label>
                            <input value={form.model} onChange={e => set('model', e.target.value)} placeholder="NV200" />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Year</label>
                            <input type="number" value={form.year} onChange={e => set('year', e.target.value)} placeholder="2022" min="1990" max="2030" />
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Starting Mileage</label>
                            <input type="number" value={form.mileage} onChange={e => set('mileage', e.target.value)} min="0" />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Tags Renewal</label>
                            <input type="date" value={form.tags_renewal} onChange={e => set('tags_renewal', e.target.value)} />
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Driver</label>
                            <input value={form.driver} onChange={e => set('driver', e.target.value)} placeholder="Assigned driver" />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Slack Name</label>
                            <input value={form.slack_name} onChange={e => set('slack_name', e.target.value)} placeholder="e.g. NV200 #3" />
                        </div>
                    </div>
                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>
                            {saving ? 'Adding…' : 'Add Vehicle'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default function Fleet() {
    const { user }                      = useAuth();
    const [vehicles, setVehicles]       = useState([]);
    const [loading, setLoading]         = useState(true);
    const [selectedId, setSelectedId]   = useState(null);
    const [showAddVehicle, setShowAddVehicle] = useState(false);
    const [importing, setImporting]   = useState(false);
    const [importMsg, setImportMsg]   = useState('');

    useEffect(() => {
        api.get('/fleet')
            .then(r => setVehicles(r.data))
            .finally(() => setLoading(false));
    }, []);

    const runImport = async () => {
        setImporting(true);
        setImportMsg('');
        try {
            const { data } = await api.post('/import/run');
            setImportMsg(`Imported ${data.imported} record${data.imported !== 1 ? 's' : ''}, skipped ${data.skipped} duplicate${data.skipped !== 1 ? 's' : ''}.`);
        } catch (err) {
            setImportMsg(err.response?.data?.error || 'Import failed.');
        } finally {
            setImporting(false);
            setTimeout(() => setImportMsg(''), 5000);
        }
    };

    return (
        <Layout>
            <div className="page-header">
                <h1 className="page-title">Fleet <span>{vehicles.length} vehicles</span></h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {importMsg && <span style={{ fontSize: 12, color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>{importMsg}</span>}
                    <button className="btn btn-ghost" onClick={runImport} disabled={importing}>
                        {importing ? 'Importing...' : '↓ Import from Report'}
                    </button>
                    {user.role === 'admin' && (
                        <button className="btn btn-primary" onClick={() => setShowAddVehicle(true)}>
                            + Add Vehicle
                        </button>
                    )}
                </div>
            </div>
            {loading && <p style={{ color: 'var(--text-dim)' }}>Loading...</p>}
            {!loading && (
                <div className="fleet-grid">
                    {vehicles.map(v => (
                        <VehicleCard key={v.id} vehicle={v} onClick={v => setSelectedId(v.id)} />
                    ))}
                </div>
            )}
            {selectedId && (
                <VehicleDetail vehicleId={selectedId} onClose={() => setSelectedId(null)} />
            )}
            {showAddVehicle && (
                <NewVehicleModal
                    onClose={() => setShowAddVehicle(false)}
                    onCreated={v => {
                        setVehicles(prev => [...prev, { ...v, open_issues: 0 }]);
                        setShowAddVehicle(false);
                    }}
                />
            )}
        </Layout>
    );
}
