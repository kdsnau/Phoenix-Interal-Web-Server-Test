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
   Main Inventory page
   ----------------------------------------------------------------------- */
export default function Inventory() {
    const { user } = useAuth();
    const canEdit   = user.role === 'admin' || user.role === 'accounting';
    const canDelete = user.role === 'admin';

    const [items, setItems]       = useState([]);
    const [loading, setLoading]   = useState(true);
    const [catTab, setCatTab]     = useState('all');
    const [search, setSearch]     = useState('');
    const [showAdd, setShowAdd]   = useState(false);
    const [editItem, setEditItem] = useState(null);
    const [adjItem, setAdjItem]   = useState(null);

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
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.length === 0 && (
                                    <tr><td colSpan={7} className="alarm-empty">No items found.</td></tr>
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

                {showAdd   && <ItemModal onClose={() => setShowAdd(false)} onSave={handleAdd} />}
                {editItem  && <ItemModal item={editItem} onClose={() => setEditItem(null)} onSave={handleEdit} />}
                {adjItem   && <AdjustModal item={adjItem} onClose={() => setAdjItem(null)} onSave={handleAdjust} />}
            </div>
        </Layout>
    );
}
