import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import Layout from '../components/Layout';
import PageHelp from '../components/PageHelp';
import Leaderboard from '../components/Leaderboard';
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
   Summary notes — at-a-glance cards for the signed-in user
   ----------------------------------------------------------------------- */
function NoteCard({ label, value, sub, color, to, onClick }) {
    const body = (
        <>
            <div className="stat-label">{label}</div>
            <div className="stat-value" style={color ? { color } : undefined}>{value}</div>
            {sub && (
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sub}
                </div>
            )}
        </>
    );
    if (to)      return <Link to={to} className="stat-card" style={{ textDecoration: 'none' }}>{body}</Link>;
    if (onClick) return <div className="stat-card" style={{ cursor: 'pointer' }} onClick={onClick}>{body}</div>;
    return <div className="stat-card">{body}</div>;
}

function SummaryNotes({ summary, posts, user, onOpenBoard }) {
    const s          = summary || {};
    const recent     = posts[0];
    const lb         = s.leaderboard;
    const unread     = s.unread_messages || { count: 0, senders: [] };
    const canTickets = user.role === 'technician' || user.role === 'admin';
    const roleLabel  = user.role.charAt(0).toUpperCase() + user.role.slice(1);

    return (
        <div className="stats-grid" style={{ marginBottom: 24 }}>
            <NoteCard label="Active Clients"   value={s.active_clients ?? '—'}   color="var(--accent)" to="/clients" sub="in the directory" />
            <NoteCard label="Tickets Assigned" value={s.assigned_tickets ?? '—'} color="var(--yellow)" to={canTickets ? '/tickets' : undefined} sub="open · assigned to you" />
            <NoteCard label="Technicians"      value={s.technicians ?? '—'}      to={user.role === 'admin' ? '/admin' : undefined} sub="on the team" />
            <NoteCard
                label="Most Recent Board Post"
                value={recent ? (recent.author_name || 'Admin') : '—'}
                color="var(--text-hi)"
                onClick={onOpenBoard}
                sub={recent ? `${recent.content} · ${timeAgo(recent.created_at)}` : 'No posts yet'}
            />
            <NoteCard
                label="Unread Messages"
                value={unread.count}
                color={unread.count > 0 ? 'var(--red)' : undefined}
                to="/messages"
                sub={unread.count > 0 ? `from ${unread.senders.join(', ')}` : 'all caught up'}
            />
            <NoteCard
                label="Leaderboard Position"
                value={lb ? `#${lb.rank}` : '—'}
                color="var(--accent)"
                to="/profile"
                sub={lb ? `of ${lb.total}` : 'unranked'}
            />
            <NoteCard label="Assigned Role" value={roleLabel} sub={user.name} />
        </div>
    );
}

/* -----------------------------------------------------------------------
   Main Dashboard
   ----------------------------------------------------------------------- */
export default function Dashboard() {
    const { user } = useAuth();
    const [summary,    setSummary]    = useState(null);
    const [alerts,     setAlerts]     = useState(null);
    const [reminders,  setReminders]  = useState(null);
    const [loading,    setLoading]    = useState(true);
    const [posts,      setPosts]      = useState([]);
    const [boardOpen,  setBoardOpen]  = useState(false);
    const [lastRead,   setLastRead]   = useState(() => localStorage.getItem('postBoardLastRead'));

    useEffect(() => {
        async function load() {
            try {
                const [summaryRes, alertsRes, remRes] = await Promise.all([
                    api.get('/dashboard/summary').catch(() => ({ data: null })),
                    api.get('/admin/alerts').catch(() => ({ data: null })),
                    api.get('/reminders').catch(() => ({ data: null })),
                ]);
                setSummary(summaryRes.data);
                setAlerts(alertsRes.data);
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
                    {/* Summary notes — at-a-glance cards for the signed-in user */}
                    <SummaryNotes summary={summary} posts={posts} user={user} onOpenBoard={openBoard} />

                    {/* Reminders — role-aware to-do list */}
                    {reminders && <RemindersSection data={reminders} />}

                    {/* Hours leaderboard */}
                    <Leaderboard currentUserId={user.id} />

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
