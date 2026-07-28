import { useState, useEffect, useMemo } from 'react';
import api from '../api/client';

/* Field-report form for a done ticket. Collects the full set of fields the
   project-reports Slack channel is read for, plus optional linked inventory items
   (which become pending stock-change requests for admin/accounting to approve).
   Posts to that channel and records the report locally. */
export default function ReportModal({ ticket, onClose, onSaved }) {
    const [jobName,     setJobName]     = useState(ticket.client_name || ticket.title || '');
    const [rfq,         setRfq]         = useState('');
    const [technicians, setTechnicians] = useState(ticket.technicians || '');
    const [arrival,     setArrival]     = useState('');
    const [work,        setWork]        = useState('');
    const [parts,       setParts]       = useState(ticket.parts_suggestion || '');
    const [returnTrip,  setReturnTrip]  = useState(false);
    const [photos,      setPhotos]      = useState([]);
    const [invCatalog,  setInvCatalog]  = useState([]);
    const [invItems,    setInvItems]    = useState([]);   // [{ inventory_item_id, name, sku, qty }]
    const [pickOpen,    setPickOpen]    = useState(false);
    const [q,           setQ]           = useState('');
    const [error,       setError]       = useState('');
    const [saving,      setSaving]      = useState(false);

    useEffect(() => {
        api.get('/inventory', { params: { active: true } })
            .then(r => setInvCatalog(Array.isArray(r.data) ? r.data : []))
            .catch(() => {});
    }, []);

    const matches = useMemo(() => {
        const s = q.trim().toLowerCase();
        const list = invCatalog || [];
        return (s ? list.filter(it => [it.name, it.sku, it.mpn].some(v => v && String(v).toLowerCase().includes(s))) : list).slice(0, 40);
    }, [q, invCatalog]);

    const addItem = it => {
        setInvItems(prev => [...prev, { inventory_item_id: it.id, name: it.name, sku: it.sku, qty: 1 }]);
        setPickOpen(false); setQ('');
    };
    const setQty = (i, v) => setInvItems(prev => prev.map((r, idx) => idx === i ? { ...r, qty: v } : r));
    const delItem = i => setInvItems(prev => prev.filter((_, idx) => idx !== i));

    async function submit(e) {
        e.preventDefault();
        if (!work.trim()) { setError('Please describe the work completed.'); return; }
        setError(''); setSaving(true);
        try {
            const fd = new FormData();
            fd.append('ticket_id', ticket.id);
            fd.append('job_name', jobName);
            fd.append('rfq', rfq);
            fd.append('technicians', technicians);
            fd.append('arrival', arrival);
            fd.append('work', work);
            fd.append('parts', parts);
            fd.append('return_trip', returnTrip ? 'true' : 'false');
            fd.append('line_items', JSON.stringify(invItems.map(it => ({ inventory_item_id: it.inventory_item_id, qty: Number(it.qty) || 0, name: it.name, sku: it.sku }))));
            photos.forEach(f => fd.append('photos', f));
            const { data } = await api.post('/projects/report', fd);
            onSaved?.(data);
            onClose();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to submit report.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
                <div className="modal-title">Field Report</div>
                <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: -6, marginBottom: 12 }}>
                    Ticket #{ticket.id}{ticket.title ? ` · ${ticket.title}` : ''} — posts to the project-reports channel.
                </div>
                {error && <div className="error-msg">{error}</div>}
                <form onSubmit={submit}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Job name</label>
                            <input value={jobName} onChange={e => setJobName(e.target.value)} placeholder="Client / project" />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">RFQ # / Work Order #</label>
                            <input value={rfq} onChange={e => setRfq(e.target.value)} placeholder="optional" />
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Technician(s)</label>
                            <input value={technicians} onChange={e => setTechnicians(e.target.value)} placeholder="who was on site" />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Site arrival &amp; departure times</label>
                            <input value={arrival} onChange={e => setArrival(e.target.value)} placeholder="e.g. 9:00 AM – 11:30 AM" />
                        </div>
                    </div>
                    <div className="form-group" style={{ marginTop: 14 }}>
                        <label className="form-label">What work was completed *</label>
                        <textarea value={work} onChange={e => setWork(e.target.value)} rows={4} autoFocus required style={{ resize: 'vertical' }} placeholder="Describe the service performed…" />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Parts &amp; supplies used</label>
                        <textarea value={parts} onChange={e => setParts(e.target.value)} rows={2} style={{ resize: 'vertical' }} placeholder="Free-text notes — edit as needed" />
                    </div>

                    {/* Linked inventory — becomes pending stock changes on submit. */}
                    <div className="form-group">
                        <label className="form-label">Inventory items used <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>— deducts stock once an admin approves</span></label>
                        {invItems.map((r, i) => {
                            const inv = invCatalog.find(x => x.id === r.inventory_item_id);
                            const short = inv && Number(r.qty) > Number(inv.quantity);
                            return (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {r.name}{r.sku ? <span style={{ color: 'var(--text-dim)' }}> · {r.sku}</span> : null}
                                        {inv && <span style={{ color: short ? 'var(--red)' : 'var(--text-dim)', fontSize: 11 }}> · {Number(inv.quantity)} on hand</span>}
                                    </span>
                                    <input type="number" min="1" step="1" value={r.qty} onChange={e => setQty(i, e.target.value)} style={{ width: 64, fontSize: 12 }} />
                                    <button type="button" className="btn btn-ghost" style={{ padding: '2px 6px', color: 'var(--red)' }} onClick={() => delItem(i)}>✕</button>
                                </div>
                            );
                        })}
                        <div style={{ position: 'relative' }}>
                            <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setPickOpen(o => !o)}>📦 Link inventory item</button>
                            {pickOpen && (
                                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, marginTop: 4, background: 'var(--bg-2)', border: '1px solid var(--border-hi)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.35)', padding: 8, maxHeight: 260, overflowY: 'auto' }}>
                                    <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search inventory by name, SKU, MPN…" style={{ fontSize: 12, width: '100%', marginBottom: 6 }} />
                                    {matches.length === 0 ? (
                                        <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: '6px 4px' }}>No matching items.</div>
                                    ) : matches.map(it => (
                                        <button type="button" key={it.id} onClick={() => addItem(it)}
                                            style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 6, padding: '6px 8px', cursor: 'pointer', fontSize: 12, color: 'var(--text)' }}
                                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-3)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                <span style={{ fontWeight: 600 }}>{it.name}</span>{(it.sku || it.mpn) && <span style={{ color: 'var(--text-dim)' }}> · {it.sku || it.mpn}</span>}
                                            </span>
                                            <span style={{ color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{Number(it.quantity)} on hand</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="form-group">
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
                            <input type="checkbox" checked={returnTrip} onChange={e => setReturnTrip(e.target.checked)} style={{ width: 'auto' }} />
                            A return trip is required (job not complete)
                        </label>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Photos</label>
                        <input type="file" accept="image/*" multiple onChange={e => setPhotos([...e.target.files])} />
                        {photos.length > 0 && (
                            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>{photos.length} photo{photos.length !== 1 ? 's' : ''} attached</div>
                        )}
                    </div>
                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Posting…' : 'Post Report'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
