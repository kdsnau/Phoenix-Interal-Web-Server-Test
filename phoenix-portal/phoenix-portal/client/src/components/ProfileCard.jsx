import { useState } from 'react';
import api from '../api/client';

const ROLE_TAG = { admin: 'tag-red', accounting: 'tag-blue', technician: 'tag-green' };

function NoteEditor({ initial }) {
    const [note, setNote]     = useState(initial || '');
    const [saving, setSaving] = useState(false);
    const [msg, setMsg]       = useState('');
    const save = async () => {
        setSaving(true); setMsg('');
        try { await api.put('/profile/note', { note }); setMsg('Saved.'); }
        catch { setMsg('Save failed.'); }
        finally { setSaving(false); }
    };
    return (
        <div>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
                placeholder="Add a note for yourself…" style={{ width: '100%', resize: 'vertical' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                <button className="btn btn-primary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={save} disabled={saving}>
                    {saving ? 'Saving…' : 'Save Note'}
                </button>
                {msg && <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{msg}</span>}
            </div>
        </div>
    );
}

/* Admin-only PTO allotment editor. Shows a live remaining preview as you type. */
function PtoEditor({ userId, pto }) {
    const [days, setDays]     = useState(String(pto.allotment));
    const [saving, setSaving] = useState(false);
    const [msg, setMsg]       = useState('');
    const remaining = Math.max(0, Number(days || 0) - pto.used);
    const save = async () => {
        setSaving(true); setMsg('');
        try { await api.patch(`/profile/${userId}/pto`, { pto_days: Number(days) }); setMsg('Saved.'); }
        catch (e) { setMsg(e.response?.data?.error || 'Save failed.'); }
        finally { setSaving(false); }
    };
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <input type="number" min="0" step="0.5" value={days} onChange={e => setDays(e.target.value)} style={{ width: 90 }} />
            <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>days/yr · {pto.used} used · {remaining} remaining</span>
            <button className="btn btn-primary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
            </button>
            {msg && <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{msg}</span>}
        </div>
    );
}

function StatCard({ label, value, accent }) {
    return (
        <div style={{
            background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 6,
            padding: '14px 16px', minWidth: 0,
        }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: accent || 'var(--text-hi)', fontFamily: 'var(--font-mono)' }}>{value}</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>{label}</div>
        </div>
    );
}

function Section({ title, children }) {
    return (
        <div style={{ marginTop: 22 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>{title}</div>
            {children}
        </div>
    );
}

const fmtHours = h => `${Number(h || 0).toFixed(1)} h`;
const fmtDate  = d => d ? new Date(d).toLocaleDateString() : '—';

/* Reusable read-only profile view — used by the My Profile page and the admin
   "view user" modal. Takes the payload from GET /api/profile[/:id]. */
export default function ProfileCard({ data, editable = false, canEditPto = false }) {
    if (!data) return null;
    const { user, stats, placement, ticketsByType = [], vehicles = [], inventory = [], recentTickets = [] } = data;

    return (
        <div>
            {/* Identity */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                          background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '14px 18px' }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-hi)' }}>{user.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{user.email}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <span className={`tag ${ROLE_TAG[user.role] || ''}`}>{user.role}</span>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>Joined {fmtDate(user.created_at)}</div>
                </div>
            </div>

            {/* Headline stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginTop: 16 }}>
                <StatCard label="Hours Worked"      value={fmtHours(stats.hours_worked)} accent="var(--accent)" />
                <StatCard label="Tickets Completed" value={stats.completed}              accent="var(--green)" />
                <StatCard label="Open Tickets"      value={stats.open} />
                <StatCard label="Total Assigned"    value={stats.total_assigned} />
                {stats.calls_taken > 0 && (
                    <StatCard label="Calls Taken" value={stats.calls_taken} accent="var(--green)" />
                )}
                {placement && (
                    <StatCard label="Rank (This Month)" value={`#${placement.rank} / ${placement.total}`} accent="var(--accent)" />
                )}
                {data.pto && (
                    <StatCard label="PTO Remaining" value={`${data.pto.remaining} / ${data.pto.allotment} d`}
                        accent={data.pto.remaining <= 3 ? 'var(--red)' : 'var(--green)'} />
                )}
            </div>

            {/* PTO — everyone sees the counter above; admins set the yearly allotment here */}
            {canEditPto && data.pto && (
                <Section title="Paid Time Off (admin)">
                    <PtoEditor userId={user.id} pto={data.pto} />
                </Section>
            )}

            {/* Notes — private to the user; only shown/editable on their own profile */}
            {editable && (
                <Section title="Notes">
                    <NoteEditor initial={user.profile_note} />
                </Section>
            )}

            {/* Ticket type breakdown */}
            {ticketsByType.length > 0 && (
                <Section title="Tickets by Type">
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {ticketsByType.map(t => (
                            <span key={t.type} style={{
                                fontSize: 12, border: '1px solid var(--border)', borderRadius: 4,
                                padding: '4px 10px', color: 'var(--text)',
                            }}>
                                {t.type} <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>· {t.count}</span>
                            </span>
                        ))}
                    </div>
                </Section>
            )}

            {/* Vehicle */}
            <Section title="Assigned Vehicle">
                {vehicles.length === 0 ? (
                    <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>No vehicle assigned.</div>
                ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                        {vehicles.map(v => (
                            <div key={v.id} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '12px 14px', minWidth: 200 }}>
                                <div style={{ fontWeight: 600, color: 'var(--text-hi)' }}>{v.name}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                                    {[v.year, v.make, v.model].filter(Boolean).join(' ') || '—'}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: 6 }}>
                                    {v.vehicle_id || '—'}{v.mileage != null ? ` · ${Number(v.mileage).toLocaleString()} mi` : ''}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </Section>

            {/* Inventory usage */}
            <Section title="Inventory Used">
                {inventory.length === 0 ? (
                    <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>No inventory used yet.</div>
                ) : (
                    <div className="table-card">
                        <table className="data-table">
                            <thead><tr><th>Item</th><th>Qty Used</th><th>Tickets</th></tr></thead>
                            <tbody>
                                {inventory.map((it, i) => (
                                    <tr key={i}>
                                        <td>{it.item_name}{it.sku && <span style={{ color: 'var(--text-dim)', fontSize: 11 }}> · {it.sku}</span>}</td>
                                        <td style={{ fontFamily: 'var(--font-mono)' }}>{it.total_qty}{it.unit ? ` ${it.unit}` : ''}</td>
                                        <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>{it.ticket_count}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Section>

            {/* Recent completed tickets */}
            <Section title="Recent Completed Tickets">
                {recentTickets.length === 0 ? (
                    <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>No completed tickets yet.</div>
                ) : (
                    <div className="table-card">
                        <table className="data-table">
                            <thead><tr><th>Title</th><th>Type</th><th>Client</th><th>Date</th><th>Hours</th></tr></thead>
                            <tbody>
                                {recentTickets.map(t => (
                                    <tr key={t.id}>
                                        <td style={{ color: 'var(--text-hi)' }}>{t.title}</td>
                                        <td style={{ fontSize: 11, color: 'var(--text-dim)' }}>{t.ticket_type}</td>
                                        <td style={{ fontSize: 12, color: 'var(--text-dim)' }}>{t.client_name || '—'}</td>
                                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>{fmtDate(t.event_end || t.event_start)}</td>
                                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{t.hours != null ? fmtHours(t.hours) : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Section>
        </div>
    );
}
