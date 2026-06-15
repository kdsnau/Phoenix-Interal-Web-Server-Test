import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import Layout from '../components/Layout';
import PageHelp from '../components/PageHelp';
import './Dashboard.css';

const SEV = {
    overdue: { tag: 'tag-red',    label: 'Overdue' },
    soon:    { tag: 'tag-yellow', label: 'Soon'    },
    info:    { tag: 'tag-dim',    label: 'Info'    },
};

function fmtReminderDate(ts) {
    if (!ts) return null;
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* Role-aware to-do list for the signed-in user. */
function RemindersSection({ data }) {
    const list = data?.reminders || [];
    const c = data?.counts || { overdue: 0, soon: 0, info: 0 };
    const shown = list.slice(0, 12);
    return (
        <div className="dash-alerts" style={{ marginBottom: 24 }}>
            <div className="dash-section-label">
                Reminders
                {c.overdue > 0 && <span className="tag tag-red"    style={{ marginLeft: 8 }}>{c.overdue} overdue</span>}
                {c.soon    > 0 && <span className="tag tag-yellow" style={{ marginLeft: 6 }}>{c.soon} soon</span>}
            </div>
            {list.length === 0 ? (
                <div className="dash-alert-clear" style={{ padding: '14px 0' }}>✓ You're all caught up — no reminders.</div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {shown.map((r, i) => (
                        <Link key={i} to={r.link} style={{
                            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                            background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 4,
                        }}>
                            <span className={`tag ${SEV[r.severity]?.tag || 'tag-dim'}`} style={{ flexShrink: 0 }}>
                                {SEV[r.severity]?.label || r.severity}
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', flexShrink: 0, width: 92 }}>
                                {r.category}
                            </span>
                            <span style={{ color: 'var(--text-hi)', fontWeight: 500, flexShrink: 0 }}>{r.title}</span>
                            <span style={{ fontSize: 12, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {r.detail}{r.date ? ` · ${fmtReminderDate(r.date)}` : ''}
                            </span>
                        </Link>
                    ))}
                    {list.length > shown.length && (
                        <div style={{ fontSize: 12, color: 'var(--text-dim)', paddingLeft: 4 }}>
                            +{list.length - shown.length} more
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

/* -----------------------------------------------------------------------
   Helpers
   ----------------------------------------------------------------------- */
function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7)  return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* -----------------------------------------------------------------------
   Post Board side panel
   ----------------------------------------------------------------------- */
function PostBoard({ user, onClose }) {
    const [posts,   setPosts]   = useState([]);
    const [content, setContent] = useState('');
    const [posting, setPosting] = useState(false);

    useEffect(() => {
        api.get('/posts').then(r => setPosts(r.data)).catch(() => {});
    }, []);

    async function submit(e) {
        e.preventDefault();
        if (!content.trim()) return;
        setPosting(true);
        try {
            const { data } = await api.post('/posts', { content });
            setPosts(prev => [data, ...prev]);
            setContent('');
        } catch (err) {
            console.error(err);
        } finally {
            setPosting(false);
        }
    }

    async function deletePost(id) {
        if (!confirm('Delete this post?')) return;
        await api.delete(`/posts/${id}`);
        setPosts(prev => prev.filter(p => p.id !== id));
    }

    return (
        <div className="board-overlay" onClick={onClose}>
            <div className="board-panel" onClick={e => e.stopPropagation()}>

                <div className="board-header">
                    <div className="board-title">📋 Notice Board</div>
                    <button className="proj-close-btn" onClick={onClose}>✕</button>
                </div>

                {user.role === 'admin' && (
                    <form className="board-compose" onSubmit={submit}>
                        <textarea
                            className="board-textarea"
                            value={content}
                            onChange={e => setContent(e.target.value)}
                            placeholder="Write a notice for the team…"
                            rows={3}
                        />
                        <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={posting || !content.trim()}
                            style={{ alignSelf: 'flex-end' }}
                        >
                            {posting ? 'Posting…' : 'Post'}
                        </button>
                    </form>
                )}

                <div className="board-posts">
                    {posts.length === 0 && (
                        <div className="board-empty">No notices yet.</div>
                    )}
                    {posts.map(post => (
                        <div key={post.id} className="board-post">
                            <div className="board-post-meta">
                                <span className="board-post-author">{post.author_name || 'Admin'}</span>
                                <span className="board-post-time">{timeAgo(post.created_at)}</span>
                                {user.role === 'admin' && (
                                    <button className="board-delete" onClick={() => deletePost(post.id)} title="Delete">✕</button>
                                )}
                            </div>
                            <div className="board-post-content">{post.content}</div>
                        </div>
                    ))}
                </div>

            </div>
        </div>
    );
}

/* -----------------------------------------------------------------------
   Alert panel — one of the three alert columns
   ----------------------------------------------------------------------- */
function AlertPanel({ title, items, emptyMsg, renderItem }) {
    return (
        <div className="dash-alert-panel">
            <div className="dash-alert-title">{title}</div>
            {items.length === 0 ? (
                <div className="dash-alert-clear">✓ {emptyMsg}</div>
            ) : (
                <div className="dash-alert-list">
                    {items.map((item, i) => renderItem(item, i))}
                </div>
            )}
        </div>
    );
}

/* -----------------------------------------------------------------------
   Role-specific stat rows
   ----------------------------------------------------------------------- */
function AdminStats({ stats, mrr, openTickets }) {
    const userCounts   = Object.fromEntries(stats.users.map(u => [u.role, Number(u.count)]));
    const ticketCounts = Object.fromEntries(stats.tickets.map(t => [t.status, Number(t.count)]));
    return (
        <div className="stats-grid">
            <div className="stat-card">
                <div className="stat-label">MRR</div>
                <div className="stat-value accent">${Number(mrr).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
            </div>
            <div className="stat-card">
                <div className="stat-label">Open Tickets</div>
                <div className="stat-value yellow">{openTickets}</div>
            </div>
            <div className="stat-card">
                <div className="stat-label">Revenue</div>
                <div className="stat-value green">${Number(stats.finance.total_income).toLocaleString()}</div>
            </div>
            <div className="stat-card">
                <div className="stat-label">Expenses</div>
                <div className="stat-value red">${Number(stats.finance.total_expenses).toLocaleString()}</div>
            </div>
            <div className="stat-card">
                <div className="stat-label">Technicians</div>
                <div className="stat-value">{userCounts.technician || 0}</div>
            </div>
        </div>
    );
}

function TechnicianStats({ tickets }) {
    const open    = tickets.filter(t => t.status === 'open').length;
    const inprog  = tickets.filter(t => t.status === 'in_progress').length;
    const resolved = tickets.filter(t => t.status === 'resolved').length;
    return (
        <div className="stats-grid">
            <div className="stat-card"><div className="stat-label">My Tickets</div><div className="stat-value accent">{tickets.length}</div></div>
            <div className="stat-card"><div className="stat-label">Open</div><div className="stat-value yellow">{open}</div></div>
            <div className="stat-card"><div className="stat-label">In Progress</div><div className="stat-value blue">{inprog}</div></div>
            <div className="stat-card"><div className="stat-label">Resolved</div><div className="stat-value green">{resolved}</div></div>
        </div>
    );
}

function AccountingStats({ summary, mrr }) {
    const net = Number(summary.net);
    return (
        <div className="stats-grid">
            <div className="stat-card">
                <div className="stat-label">MRR</div>
                <div className="stat-value accent">${Number(mrr).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
            </div>
            <div className="stat-card">
                <div className="stat-label">Total Income</div>
                <div className="stat-value green">${Number(summary.total_income).toLocaleString()}</div>
            </div>
            <div className="stat-card">
                <div className="stat-label">Total Expenses</div>
                <div className="stat-value red">${Number(summary.total_expenses).toLocaleString()}</div>
            </div>
            <div className="stat-card">
                <div className="stat-label">Net</div>
                <div className={`stat-value ${net >= 0 ? 'green' : 'red'}`}>
                    {net < 0 ? '-' : ''}${Math.abs(net).toLocaleString()}
                </div>
            </div>
        </div>
    );
}

/* -----------------------------------------------------------------------
   Main Dashboard
   ----------------------------------------------------------------------- */
export default function Dashboard() {
    const { user } = useAuth();
    const [roleData,   setRoleData]   = useState(null);
    const [alerts,     setAlerts]     = useState(null);
    const [reminders,  setReminders]  = useState(null);
    const [loading,    setLoading]    = useState(true);
    const [posts,      setPosts]      = useState([]);
    const [boardOpen,  setBoardOpen]  = useState(false);
    const [lastRead,   setLastRead]   = useState(() => localStorage.getItem('postBoardLastRead'));

    useEffect(() => {
        async function load() {
            try {
                const alertsFetch    = api.get('/admin/alerts').catch(() => ({ data: null }));
                const remindersFetch = api.get('/reminders').catch(() => ({ data: null }));
                let roleFetch;
                if      (user.role === 'admin')      roleFetch = api.get('/admin/stats');
                else if (user.role === 'technician') roleFetch = api.get('/tickets');
                else                                 roleFetch = api.get('/financials/summary');

                const [alertsRes, roleRes, remRes] = await Promise.all([
                    alertsFetch, roleFetch.catch(() => ({ data: null })), remindersFetch,
                ]);
                setAlerts(alertsRes.data);
                setRoleData(roleRes.data);
                setReminders(remRes.data);
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [user.role]);

    useEffect(() => {
        api.get('/posts').then(r => setPosts(r.data)).catch(() => {});
    }, []);

    const unreadCount = posts.filter(p => !lastRead || new Date(p.created_at) > new Date(lastRead)).length;
    const hasUnread   = unreadCount > 0;

    function openBoard() {
        const now = new Date().toISOString();
        localStorage.setItem('postBoardLastRead', now);
        setLastRead(now);
        setBoardOpen(true);
    }

    return (
        <Layout>
            <div className="page-header">
                <h1 className="page-title">
                    Dashboard
                    <span>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
                    <PageHelp id="dashboard" />
                </h1>
                <button
                    className={`btn btn-ghost board-btn ${hasUnread ? 'board-btn--unread' : ''}`}
                    onClick={openBoard}
                >
                    📋 Board
                    {hasUnread && <span className="board-badge">{unreadCount}</span>}
                </button>
            </div>

            {loading && <p style={{ color: 'var(--text-dim)' }}>Loading…</p>}

            {!loading && (
                <>
                    {/* Role-specific stats */}
                    {user.role === 'admin'      && roleData && <AdminStats      stats={roleData}   mrr={alerts?.mrr || 0} openTickets={alerts?.openTickets || 0} />}
                    {user.role === 'technician' && roleData && <TechnicianStats tickets={roleData} />}
                    {user.role === 'accounting' && roleData && <AccountingStats summary={roleData} mrr={alerts?.mrr || 0} />}

                    {/* Reminders — role-aware to-do list */}
                    {reminders && <RemindersSection data={reminders} />}

                    {/* Alerts section */}
                    {alerts && (
                        <div className="dash-alerts">
                            <div className="dash-section-label">Alerts</div>
                            <div className="dash-alerts-grid">

                                <AlertPanel
                                    title="Open Vehicle Issues"
                                    emptyMsg="All vehicles clear"
                                    items={alerts.vehicleIssues}
                                    renderItem={v => (
                                        <div key={v.id} className="dash-alert-row">
                                            <span className="dash-alert-name">{v.name}</span>
                                            <span className={`tag ${v.open_issues >= 4 ? 'tag-red' : 'tag-yellow'}`}>
                                                {v.open_issues} open
                                            </span>
                                        </div>
                                    )}
                                />

                                <AlertPanel
                                    title="Permits Expiring (60d)"
                                    emptyMsg="No permits expiring soon"
                                    items={alerts.permitsExpiring}
                                    renderItem={c => {
                                        const days = Number(c.days_until);
                                        return (
                                            <div key={c.id} className="dash-alert-row">
                                                <span className="dash-alert-name">{c.name}</span>
                                                <span className={`tag ${days < 0 ? 'tag-red' : 'tag-yellow'}`}>
                                                    {days < 0 ? 'EXPIRED' : `${days}d`}
                                                </span>
                                            </div>
                                        );
                                    }}
                                />

                                <AlertPanel
                                    title="Tags Expiring (30d)"
                                    emptyMsg="All tags current"
                                    items={alerts.tagsExpiring}
                                    renderItem={v => {
                                        const days = Number(v.days_until);
                                        return (
                                            <div key={v.id} className="dash-alert-row">
                                                <span className="dash-alert-name">{v.name}</span>
                                                <span className={`tag ${days < 0 ? 'tag-red' : 'tag-yellow'}`}>
                                                    {days < 0 ? 'EXPIRED' : `${days}d`}
                                                </span>
                                            </div>
                                        );
                                    }}
                                />

                            </div>
                        </div>
                    )}

                    {/* Session info */}
                    <div className="dash-session">
                        Logged in as <strong>{user.name}</strong>
                        {' · '}
                        <span className="dash-session-role">{user.role}</span>
                        {' · '}
                        <span className="dash-session-email">{user.email}</span>
                    </div>
                </>
            )}
            {boardOpen && (
                <PostBoard user={user} onClose={() => setBoardOpen(false)} />
            )}
        </Layout>
    );
}
