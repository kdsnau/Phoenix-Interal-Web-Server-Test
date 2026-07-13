import { useEffect, useState } from 'react';
import api from '../api/client';
import useRoles from '../hooks/useRoles';
import RoleBadge from './RoleBadge';

const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };

/* Hours-worked ranking of technicians. Highlights the signed-in user's row. */
export default function Leaderboard({ currentUserId }) {
    const [period, setPeriod]   = useState('month');
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const { roleFor }           = useRoles();

    useEffect(() => {
        let alive = true;
        setLoading(true);
        api.get(`/profile/leaderboard?period=${period}`)
            .then(r => { if (alive) setEntries(r.data.entries || []); })
            .catch(() => { if (alive) setEntries([]); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [period]);

    return (
        <div className="dash-alerts" style={{ marginBottom: 24 }}>
            <div className="dash-section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Hours Leaderboard</span>
                <span style={{ display: 'flex', gap: 6 }}>
                    {[['month', 'This Month'], ['all', 'All Time']].map(([p, label]) => (
                        <button
                            key={p}
                            className="btn btn-ghost"
                            onClick={() => setPeriod(p)}
                            style={{ padding: '2px 10px', fontSize: 11, ...(period === p ? { background: 'var(--bg-3)', color: 'var(--text-hi)' } : {}) }}
                        >
                            {label}
                        </button>
                    ))}
                </span>
            </div>

            {loading ? (
                <div className="dash-alert-clear" style={{ padding: '14px 0' }}>Loading…</div>
            ) : entries.length === 0 ? (
                <div className="dash-alert-clear" style={{ padding: '14px 0' }}>No technician hours recorded yet.</div>
            ) : (
                <div className="table-card">
                    <table className="data-table">
                        <thead><tr><th style={{ width: 48 }}>#</th><th>Technician</th><th>Hours</th><th>Tickets</th></tr></thead>
                        <tbody>
                            {entries.map(e => {
                                const me = e.user_id === currentUserId;
                                return (
                                    <tr key={e.user_id} style={me ? { background: 'var(--bg-3)' } : undefined}>
                                        <td style={{ fontFamily: 'var(--font-mono)' }}>{MEDAL[e.rank] || e.rank}</td>
                                        <td style={{ color: 'var(--text-hi)', fontWeight: me ? 600 : 400 }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                                {e.name}
                                                <RoleBadge role={roleFor(e.user_id)} />
                                            </span>
                                            {me && <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}> · you</span>}
                                        </td>
                                        <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{e.hours.toFixed(1)} h</td>
                                        <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>{e.completed_tickets}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
