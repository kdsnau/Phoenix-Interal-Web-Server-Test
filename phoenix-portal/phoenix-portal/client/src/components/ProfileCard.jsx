const ROLE_TAG = { admin: 'tag-red', accounting: 'tag-blue', technician: 'tag-green' };

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
export default function ProfileCard({ data }) {
    if (!data) return null;
    const { user, stats, ticketsByType = [], vehicles = [], inventory = [], recentTickets = [] } = data;

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
            </div>

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
