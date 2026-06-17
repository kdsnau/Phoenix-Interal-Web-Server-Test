import { useEffect, useState } from 'react';
import api from '../api/client';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';

export default function Calls() {
    const { user } = useAuth();
    const [data, setData]       = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState('');
    const [channel, setChannel] = useState('');
    const [chMsg, setChMsg]     = useState('');
    const [cat, setCat]         = useState('all');   // category filter

    const load = () => {
        setLoading(true);
        api.get('/calls')
            .then(r => { setData(r.data); setError(''); })
            .catch(e => { setData(e.response?.data || null); setError(e.response?.data?.error || 'Failed to load calls.'); })
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        load();
        if (user.role === 'admin') api.get('/calls/channel').then(r => setChannel(r.data.channel || '')).catch(() => {});
    }, []);

    async function saveChannel() {
        setChMsg('Saving…');
        try { await api.put('/calls/channel', { channel }); setChMsg('Saved.'); load(); }
        catch (e) { setChMsg(e.response?.data?.error || 'Save failed.'); }
    }

    const allCalls   = data?.calls || [];
    const categories = [...new Set(allCalls.map(c => c.category).filter(Boolean))];
    const calls      = cat === 'all' ? allCalls : allCalls.filter(c => c.category === cat);

    /* Tally "calls taken" by receiver, respecting the active category filter. */
    const tally = {};
    for (const c of calls) { const who = c.receiver || 'Unassigned'; tally[who] = (tally[who] || 0) + 1; }
    const byPerson = Object.entries(tally).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

    return (
        <Layout>
            <div className="page-header">
                <h1 className="page-title">
                    Customer-Service Calls
                    {data?.configured && <span>{calls.length} recent</span>}
                </h1>
            </div>

            {user.role === 'admin' && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
                    <label className="form-label" style={{ margin: 0 }}>Slack channel ID</label>
                    <input value={channel} onChange={e => setChannel(e.target.value)} placeholder="e.g. C0123ABC456"
                        style={{ width: 220, fontFamily: 'var(--font-mono)', fontSize: 12 }} />
                    <button className="btn btn-primary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={saveChannel}>Save</button>
                    {chMsg && <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{chMsg}</span>}
                </div>
            )}

            {loading ? (
                <p style={{ color: 'var(--text-dim)' }}>Loading…</p>
            ) : error ? (
                <div className="error-msg">{error}</div>
            ) : !data?.configured ? (
                <p style={{ color: 'var(--text-dim)' }}>
                    No Slack channel configured for calls yet.{user.role === 'admin' ? ' Set the channel ID above.' : ' Ask an admin to set it.'}
                </p>
            ) : (
                <>
                    {/* Category filter */}
                    {categories.length > 0 && (
                        <div className="alarm-service-tabs" style={{ marginBottom: 16 }}>
                            {['all', ...categories].map(c => (
                                <button key={c} className={`alarm-tab ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>
                                    {c === 'all' ? 'All' : c}{' '}
                                    <span className="alarm-tab-count">{c === 'all' ? allCalls.length : allCalls.filter(x => x.category === c).length}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Calls taken, by receiver */}
                    <div className="dash-section-label" style={{ marginBottom: 10 }}>Calls Taken</div>
                    {byPerson.length === 0 ? (
                        <div style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 20 }}>No calls in the channel yet.</div>
                    ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
                            {byPerson.map(p => (
                                <span key={p.name} style={{
                                    fontSize: 13, border: '1px solid var(--border)', borderRadius: 4,
                                    padding: '6px 12px', background: 'var(--bg-2)', color: 'var(--text-hi)',
                                }}>
                                    {p.name} <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>· {p.count}</span>
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Recent calls */}
                    <div className="dash-section-label" style={{ marginBottom: 10 }}>Recent Calls</div>
                    <div className="table-card">
                        <table className="data-table">
                            <thead><tr><th style={{ width: 150 }}>When</th><th style={{ width: 160 }}>Category</th><th style={{ width: 140 }}>Taken By</th><th>Details</th></tr></thead>
                            <tbody>
                                {calls.length === 0 && (
                                    <tr><td colSpan={4} style={{ color: 'var(--text-dim)', textAlign: 'center', padding: 24 }}>No calls found.</td></tr>
                                )}
                                {calls.map((c, i) => (
                                    <tr key={c.ts || i}>
                                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>
                                            {new Date(c.date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                        </td>
                                        <td style={{ fontSize: 12 }}>
                                            <span className="tag tag-blue">{c.category}</span>
                                        </td>
                                        <td style={{ color: 'var(--text-hi)' }}>{c.receiver || '—'}</td>
                                        <td style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{c.text}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </Layout>
    );
}
