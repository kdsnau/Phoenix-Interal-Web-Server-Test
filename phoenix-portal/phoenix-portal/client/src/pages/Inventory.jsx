import { useState, useEffect } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import Layout from '../components/Layout';
import './Inventory.css';

const CATEGORIES = ['all', 'equipment', 'cable', 'hardware', 'tools', 'consumables', 'other'];

/* -----------------------------------------------------------------------
   Add / Edit item modal
   ----------------------------------------------------------------------- */
function ItemModal({ item, onClose, onSave }) {
    const [form, setForm] = useState({
        name:          item?.name          || '',
        sku:           item?.sku           || '',
        category:      item?.category      || 'equipment',
        quantity:      item?.quantity      ?? 0,
        min_threshold: item?.min_threshold ?? 0,
        unit:          item?.unit          || 'ea',
        location:      item?.location      || '',
        notes:         item?.notes         || '',
    });

    function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

    async function handleSubmit(e) {
        e.preventDefault();
        await onSave(form);
        onClose();
    }

    return (
        <div className="inv-modal-overlay" onClick={onClose}>
            <div className="inv-modal" onClick={e => e.stopPropagation()}>
                <div className="inv-modal-header">
                    <h2>{item ? 'Edit Item' : 'Add Item'}</h2>
                    <button className="inv-modal-close" onClick={onClose}>✕</button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className="inv-form-row2">
                        <label>Name *<input className="inv-input" value={form.name} onChange={e => set('name', e.target.value)} required /></label>
                        <label>SKU<input className="inv-input" value={form.sku} onChange={e => set('sku', e.target.value)} /></label>
                    </div>
                    <div className="inv-form-row3">
                        <label>Category
                            <select className="inv-select" value={form.category} onChange={e => set('category', e.target.value)}>
                                {CATEGORIES.filter(c => c !== 'all').map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </label>
                        <label>Unit<input className="inv-input" value={form.unit} onChange={e => set('unit', e.target.value)} /></label>
                        <label>Location<input className="inv-input" value={form.location} onChange={e => set('location', e.target.value)} /></label>
                    </div>
                    <div className="inv-form-row2">
                        <label>Quantity<input className="inv-input" type="number" min="0" value={form.quantity} onChange={e => set('quantity', Number(e.target.value))} /></label>
                        <label>Low Stock Threshold<input className="inv-input" type="number" min="0" value={form.min_threshold} onChange={e => set('min_threshold', Number(e.target.value))} /></label>
                    </div>
                    <label>Notes<textarea className="inv-input inv-textarea" value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} /></label>
                    <div className="inv-modal-footer">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary">{item ? 'Save' : 'Add Item'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

/* -----------------------------------------------------------------------
   Adjust quantity modal (all roles)
   ----------------------------------------------------------------------- */
function AdjustModal({ item, onClose, onSave }) {
    const [qty, setQty] = useState(item.quantity);

    async function handleSubmit(e) {
        e.preventDefault();
        await onSave(qty);
        onClose();
    }

    return (
        <div className="inv-modal-overlay" onClick={onClose}>
            <div className="inv-modal-sm" onClick={e => e.stopPropagation()}>
                <div className="inv-modal-header">
                    <h2>Adjust: {item.name}</h2>
                    <button className="inv-modal-close" onClick={onClose}>✕</button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className="inv-adjust-row">
                        <button type="button" className="inv-adj-btn" onClick={() => setQty(q => Math.max(0, q - 1))}>−</button>
                        <input
                            className="inv-adj-input"
                            type="number" min="0"
                            value={qty}
                            onChange={e => setQty(Math.max(0, Number(e.target.value)))}
                        />
                        <button type="button" className="inv-adj-btn" onClick={() => setQty(q => q + 1)}>+</button>
                    </div>
                    <div className="inv-modal-footer">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary">Save</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

/* -----------------------------------------------------------------------
   Assign to vehicle modal
   ----------------------------------------------------------------------- */
function AssignVehicleModal({ item, onClose, onAssigned }) {
    const [vehicles,     setVehicles]     = useState([]);
    const [assignments,  setAssignments]  = useState([]);
    const [vehicleInput, setVehicleInput] = useState('');
    const [selectedVId,  setSelectedVId]  = useState('');
    const [quantity,     setQuantity]     = useState(1);
    const [notes,        setNotes]        = useState('');
    const [saving,       setSaving]       = useState(false);

    useEffect(() => {
        api.get('/inventory/vehicles').then(r => setVehicles(Array.isArray(r.data) ? r.data : [])).catch(() => {});
        api.get(`/inventory/${item.id}/assignments`).then(r => setAssignments(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    }, [item.id]);

    /* When the user types a vehicle name, try to find a matching vehicle */
    const handleVehicleInput = (val) => {
        setVehicleInput(val);
        const match = vehicles.find(v => v.name.toLowerCase() === val.toLowerCase());
        setSelectedVId(match ? String(match.id) : '');
    };

    const handleAssign = async (e) => {
        e.preventDefault();
        if (!selectedVId) return;
        setSaving(true);
        try {
            const { data } = await api.post(`/inventory/${item.id}/assign`, {
                vehicle_id: Number(selectedVId),
                quantity,
                notes: notes || null,
            });
            setAssignments(prev => {
                const exists = prev.findIndex(a => a.id === data.id);
                return exists >= 0 ? prev.map((a, i) => i === exists ? data : a) : [...prev, data];
            });
            setVehicleInput('');
            setSelectedVId('');
            setQuantity(1);
            setNotes('');
            if (onAssigned) onAssigned();
        } finally {
            setSaving(false);
        }
    };

    const handleRemove = async (assignId) => {
        await api.delete(`/inventory/assignments/${assignId}`);
        setAssignments(prev => prev.filter(a => a.id !== assignId));
        if (onAssigned) onAssigned();
    };

    const handleAdjust = async (assignId, qty) => {
        const { data } = await api.patch(`/inventory/assignments/${assignId}`, { quantity: qty });
        setAssignments(prev => prev.map(a => a.id === assignId ? data : a));
    };

    return (
        <div className="inv-modal-overlay" onClick={onClose}>
            <div className="inv-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
                <div className="inv-modal-header">
                    <h2>Vehicle Assignments — {item.name}</h2>
                    <button className="inv-modal-close" onClick={onClose}>✕</button>
                </div>

                {/* Current assignments */}
                {assignments.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                            Currently Assigned
                        </div>
                        {assignments.map(a => (
                            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                                <span style={{ flex: 1, fontSize: 13, color: 'var(--text-hi)', fontWeight: 500 }}>
                                    🚗 {a.vehicle_name}
                                </span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <button onClick={() => handleAdjust(a.id, Math.max(0, a.quantity - 1))}
                                        style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', width: 22, height: 22, cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>−</button>
                                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, minWidth: 28, textAlign: 'center' }}>{a.quantity}</span>
                                    <button onClick={() => handleAdjust(a.id, a.quantity + 1)}
                                        style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', width: 22, height: 22, cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>+</button>
                                </div>
                                {a.notes && <span style={{ fontSize: 11, color: 'var(--text-dim)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.notes}</span>}
                                <button onClick={() => handleRemove(a.id)}
                                    style={{ background: 'none', border: 'none', color: 'var(--red)', fontSize: 13, cursor: 'pointer', padding: '0 4px' }}>✕</button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Add new assignment */}
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                    Assign to Vehicle
                </div>
                <form onSubmit={handleAssign}>
                    <div className="inv-form-row2" style={{ marginBottom: 10 }}>
                        <label style={{ position: 'relative' }}>
                            Vehicle Name
                            <input
                                className="inv-input"
                                list="inv-vehicle-list"
                                placeholder="Type vehicle name…"
                                value={vehicleInput}
                                onChange={e => handleVehicleInput(e.target.value)}
                                autoComplete="off"
                            />
                            <datalist id="inv-vehicle-list">
                                {vehicles.map(v => (
                                    <option key={v.id} value={v.name}>{v.year} {v.make} {v.model}</option>
                                ))}
                            </datalist>
                        </label>
                        <label>
                            Quantity
                            <input className="inv-input" type="number" min="1" value={quantity} onChange={e => setQuantity(Number(e.target.value))} />
                        </label>
                    </div>
                    <label style={{ marginBottom: 12, display: 'block' }}>
                        Notes (optional)
                        <input className="inv-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. stored in rear compartment" />
                    </label>
                    {vehicleInput && !selectedVId && (
                        <div style={{ fontSize: 12, color: 'var(--yellow)', marginBottom: 8 }}>
                            ⚠ Select a vehicle from the list
                        </div>
                    )}
                    <div className="inv-modal-footer">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Done</button>
                        <button type="submit" className="btn btn-primary" disabled={!selectedVId || saving}>
                            {saving ? 'Assigning…' : 'Assign'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

/* -----------------------------------------------------------------------
   Main Inventory page
   ----------------------------------------------------------------------- */
export default function Inventory() {
    const { user } = useAuth();
    const canEdit   = user.role === 'admin' || user.role === 'accounting';
    const canDelete = user.role === 'admin';

    const [items, setItems]           = useState([]);
    const [loading, setLoading]       = useState(true);
    const [catTab, setCatTab]         = useState('all');
    const [search, setSearch]         = useState('');
    const [showAdd, setShowAdd]       = useState(false);
    const [editItem, setEditItem]     = useState(null);
    const [adjItem, setAdjItem]       = useState(null);
    const [assignItem, setAssignItem] = useState(null);

    function fetchItems() {
        setLoading(true);
        const params = {};
        if (catTab !== 'all') params.category = catTab;
        if (search) params.search = search;
        api.get('/inventory', { params })
            .then(r => setItems(r.data))
            .finally(() => setLoading(false));
    }

    useEffect(() => { fetchItems(); }, [catTab, search]);

    async function handleAdd(form) {
        await api.post('/inventory', form);
        fetchItems();
    }

    async function handleEdit(form) {
        await api.patch(`/inventory/${editItem.id}`, form);
        fetchItems();
    }

    async function handleAdjust(qty) {
        await api.patch(`/inventory/${adjItem.id}`, { quantity: qty });
        fetchItems();
    }

    async function handleDelete(id) {
        if (!confirm('Delete this item?')) return;
        await api.delete(`/inventory/${id}`);
        fetchItems();
    }

    const lowCount = items.filter(i => i.quantity > 0 && i.quantity <= i.min_threshold).length;
    const outCount = items.filter(i => i.quantity === 0).length;
    const totalVal = items.reduce((s, i) => s + i.quantity, 0);

    return (
        <Layout>
            <div className="inv-page">
                <div className="inv-header">
                    <h1 className="page-title">Inventory</h1>
                    {canEdit && (
                        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Item</button>
                    )}
                </div>

                {/* Stats */}
                <div className="stats-grid" style={{ marginBottom: '20px' }}>
                    <div className="stat-card"><div className="stat-label">Total Items</div><div className="stat-value">{items.length}</div></div>
                    <div className="stat-card"><div className="stat-label">Total Units</div><div className="stat-value">{totalVal}</div></div>
                    <div className="stat-card"><div className="stat-label">Low Stock</div><div className="stat-value" style={{ color: 'var(--yellow)' }}>{lowCount}</div></div>
                    <div className="stat-card"><div className="stat-label">Out of Stock</div><div className="stat-value" style={{ color: 'var(--red)' }}>{outCount}</div></div>
                </div>

                {/* Alert banner */}
                {(lowCount > 0 || outCount > 0) && (
                    <div className="inv-alert">
                        {outCount > 0 && <span>⚠ {outCount} item{outCount > 1 ? 's' : ''} out of stock</span>}
                        {lowCount > 0 && <span>⚠ {lowCount} item{lowCount > 1 ? 's' : ''} running low</span>}
                    </div>
                )}

                {/* Toolbar */}
                <div className="inv-toolbar">
                    <div className="alarm-service-tabs">
                        {CATEGORIES.map(c => (
                            <button key={c} className={`alarm-tab ${catTab === c ? 'active' : ''}`} onClick={() => setCatTab(c)}>
                                {c === 'all' ? 'All' : c.charAt(0).toUpperCase() + c.slice(1)}
                            </button>
                        ))}
                    </div>
                    <input
                        className="alarm-search"
                        placeholder="Search items…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>

                {/* Table */}
                {loading ? (
                    <div className="alarm-empty">Loading…</div>
                ) : (
                    <div className="inv-table-wrap">
                        <table className="inv-table">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>SKU</th>
                                    <th>Category</th>
                                    <th>Qty</th>
                                    <th>Unit</th>
                                    <th>Location</th>
                                    <th>Vehicles</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.length === 0 && (
                                    <tr><td colSpan={8} className="alarm-empty">No items found.</td></tr>
                                )}
                                {items.map(item => {
                                    const isOut = item.quantity === 0;
                                    const isLow = !isOut && item.quantity <= item.min_threshold;
                                    return (
                                        <tr key={item.id} className={isOut ? 'inv-row-out' : isLow ? 'inv-row-low' : ''}>
                                            <td className="inv-name">{item.name}</td>
                                            <td className="inv-dim">{item.sku || '—'}</td>
                                            <td><span className="tag-dim">{item.category}</span></td>
                                            <td>
                                                <span className={`inv-qty ${isOut ? 'inv-qty-out' : isLow ? 'inv-qty-low' : 'inv-qty-ok'}`}>
                                                    {item.quantity} {item.min_threshold > 0 && <span className="inv-threshold">/ {item.min_threshold}</span>}
                                                </span>
                                            </td>
                                            <td className="inv-dim">{item.unit}</td>
                                            <td className="inv-dim">{item.location || '—'}</td>
                                            <td>
                                                <button
                                                    className="inv-btn-sm"
                                                    style={{ color: item.vehicle_count > 0 ? 'var(--accent)' : undefined }}
                                                    onClick={() => setAssignItem(item)}
                                                >
                                                    🚗 {item.vehicle_count > 0 ? item.vehicle_count : 'Assign'}
                                                </button>
                                            </td>
                                            <td className="inv-actions">
                                                <button className="inv-btn-sm" onClick={() => setAdjItem(item)}>Adjust</button>
                                                {canEdit && <button className="inv-btn-sm" onClick={() => setEditItem(item)}>Edit</button>}
                                                {canDelete && <button className="inv-btn-sm inv-btn-del" onClick={() => handleDelete(item.id)}>Delete</button>}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {showAdd    && <ItemModal onClose={() => setShowAdd(false)} onSave={handleAdd} />}
                {editItem   && <ItemModal item={editItem} onClose={() => setEditItem(null)} onSave={handleEdit} />}
                {adjItem    && <AdjustModal item={adjItem} onClose={() => setAdjItem(null)} onSave={handleAdjust} />}
                {assignItem && (
                    <AssignVehicleModal
                        item={assignItem}
                        onClose={() => setAssignItem(null)}
                        onAssigned={fetchItems}
                    />
                )}
            </div>
        </Layout>
    );
}
