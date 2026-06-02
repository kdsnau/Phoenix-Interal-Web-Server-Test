import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import Layout from '../components/Layout';
import './Messages.css';

const ROLE_COLOR = { admin: 'tag-red', accounting: 'tag-blue', technician: 'tag-green' };

function Avatar({ name, size = 32 }) {
    return (
        <div className="msg-avatar" style={{ width: size, height: size, fontSize: size * 0.4 }}>
            {name?.[0]?.toUpperCase() ?? '?'}
        </div>
    );
}

function formatTime(ts) {
    if (!ts) return '';
    const d    = new Date(ts);
    const now  = new Date();
    const diff = Math.floor((now - d) / 60000);
    if (diff < 1)  return 'just now';
    if (diff < 60) return `${diff}m ago`;
    const h = Math.floor(diff / 60);
    if (h < 24)    return `${h}h ago`;
    if (h < 48)    return 'yesterday';
    return d.toLocaleDateString();
}

export default function Messages() {
    const { user }                    = useAuth();
    const [allUsers,   setAllUsers]   = useState([]);
    const [inbox,      setInbox]      = useState([]);
    const [thread,     setThread]     = useState([]);
    const [active,     setActive]     = useState(null);   /* { id, name, role } */
    const [search,     setSearch]     = useState('');
    const [compose,    setCompose]    = useState('');
    const [sending,    setSending]    = useState(false);
    const [newMode,    setNewMode]    = useState(false);
    const bottomRef                   = useRef(null);
    const pollRef                     = useRef(null);
    const composeRef                  = useRef(null);

    /* ---- initial load -------------------------------------------------- */
    useEffect(() => {
        api.get('/messages/users').then(r => setAllUsers(r.data)).catch(() => {});
        refreshInbox();
    }, []);

    const refreshInbox = async () => {
        const r = await api.get('/messages/inbox').catch(() => ({ data: [] }));
        setInbox(r.data);
    };

    /* ---- thread load + polling ----------------------------------------- */
    const loadThread = useCallback(async () => {
        if (!active) return;
        const r = await api.get(`/messages/thread/${active.id}`).catch(() => ({ data: [] }));
        setThread(r.data);
        api.patch(`/messages/read/${active.id}`).catch(() => {});
        refreshInbox();
    }, [active]);

    useEffect(() => {
        if (!active) { setThread([]); return; }
        loadThread();
        clearInterval(pollRef.current);
        pollRef.current = setInterval(loadThread, 5000);
        return () => clearInterval(pollRef.current);
    }, [active]);                                    // eslint-disable-line

    /* ---- auto-scroll on new message ------------------------------------ */
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [thread]);

    /* ---- open a conversation ------------------------------------------- */
    const openChat = (u) => {
        setActive({ id: u.id ?? u.other_id, name: u.name ?? u.other_name, role: u.role ?? u.other_role });
        setNewMode(false);
        setSearch('');
        setTimeout(() => composeRef.current?.focus(), 50);
    };

    /* ---- send ---------------------------------------------------------- */
    const send = async () => {
        if (!compose.trim() || !active || sending) return;
        setSending(true);
        try {
            await api.post('/messages', { to_id: active.id, body: compose.trim() });
            setCompose('');
            await loadThread();
        } catch (e) {
            alert(e.response?.data?.error || 'Failed to send.');
        } finally {
            setSending(false);
        }
    };

    const handleKey = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    };

    /* ---- filtered lists ------------------------------------------------ */
    const searchLower   = search.toLowerCase();
    const filteredUsers = allUsers.filter(u =>
        !search ||
        u.name.toLowerCase().includes(searchLower) ||
        u.email.toLowerCase().includes(searchLower)
    );
    const filteredInbox = inbox.filter(c =>
        !search || c.other_name.toLowerCase().includes(searchLower)
    );

    /* ---- render -------------------------------------------------------- */
    return (
        <Layout>
            <div className="page-header">
                <h1 className="page-title">Messages</h1>
            </div>
            <div className="msg-shell">

                {/* ══ Left sidebar ══════════════════════════════════════ */}
                <div className="msg-sidebar">
                    <div className="msg-sidebar-top">
                        <span className="msg-sidebar-title">Messages</span>
                        <button
                            className="btn btn-primary msg-new-btn"
                            onClick={() => { setNewMode(true); setSearch(''); }}
                        >
                            + New
                        </button>
                    </div>

                    <input
                        className="msg-search"
                        placeholder={newMode ? 'Find a user…' : 'Search…'}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        autoComplete="off"
                    />

                    <div className="msg-list">
                        {/* New message: user directory */}
                        {newMode && (
                            <>
                                <div className="msg-list-label">All Users</div>
                                {filteredUsers.map(u => (
                                    <button key={u.id} className="msg-user-row" onClick={() => openChat(u)}>
                                        <Avatar name={u.name} />
                                        <div className="msg-user-info">
                                            <div className="msg-row-name">{u.name}</div>
                                            <span className={`tag ${ROLE_COLOR[u.role]}`} style={{ fontSize: 10 }}>{u.role}</span>
                                        </div>
                                    </button>
                                ))}
                                {filteredUsers.length === 0 && (
                                    <div className="msg-empty">No users found.</div>
                                )}
                            </>
                        )}

                        {/* Inbox */}
                        {!newMode && (
                            <>
                                {filteredInbox.length === 0 && (
                                    <div className="msg-empty">
                                        {inbox.length === 0 ? 'No messages yet.' : 'No results.'}
                                    </div>
                                )}
                                {filteredInbox.map(c => (
                                    <button
                                        key={c.other_id}
                                        className={`msg-conv-row ${active?.id === c.other_id ? 'active' : ''}`}
                                        onClick={() => openChat(c)}
                                    >
                                        <div className="msg-conv-avatar-wrap">
                                            <Avatar name={c.other_name} />
                                            {c.unread_count > 0 && (
                                                <span className="msg-unread-dot">{c.unread_count}</span>
                                            )}
                                        </div>
                                        <div className="msg-conv-body">
                                            <div className="msg-conv-top">
                                                <span className="msg-row-name">{c.other_name}</span>
                                                <span className="msg-conv-time">{formatTime(c.last_at)}</span>
                                            </div>
                                            <div className="msg-conv-preview">{c.last_body}</div>
                                        </div>
                                    </button>
                                ))}
                            </>
                        )}
                    </div>
                </div>

                {/* ══ Main thread area ══════════════════════════════════ */}
                <div className="msg-main">
                    {!active ? (
                        <div className="msg-placeholder">
                            <div className="msg-placeholder-icon">✉</div>
                            <div className="msg-placeholder-text">Select a conversation or press <strong>+ New</strong> to start one.</div>
                        </div>
                    ) : (
                        <>
                            {/* Thread header */}
                            <div className="msg-thread-header">
                                <Avatar name={active.name} size={36} />
                                <div>
                                    <div className="msg-thread-name">{active.name}</div>
                                    <span className={`tag ${ROLE_COLOR[active.role]}`} style={{ fontSize: 10 }}>{active.role}</span>
                                </div>
                            </div>

                            {/* Messages */}
                            <div className="msg-thread">
                                {thread.length === 0 && (
                                    <div className="msg-empty" style={{ marginTop: 48, textAlign: 'center' }}>
                                        No messages yet — say hello!
                                    </div>
                                )}
                                {thread.map((m, i) => {
                                    const mine    = m.from_id === user.id;
                                    const prevMsg = thread[i - 1];
                                    const showDate = !prevMsg ||
                                        new Date(m.created_at).toDateString() !==
                                        new Date(prevMsg.created_at).toDateString();
                                    return (
                                        <div key={m.id}>
                                            {showDate && (
                                                <div className="msg-date-divider">
                                                    {new Date(m.created_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                                                </div>
                                            )}
                                            <div className={`msg-bubble-row ${mine ? 'mine' : 'theirs'}`}>
                                                {!mine && <Avatar name={m.from_name} size={28} />}
                                                <div className="msg-bubble-wrap">
                                                    <div className={`msg-bubble ${mine ? 'msg-bubble-mine' : 'msg-bubble-theirs'}`}>
                                                        {m.body}
                                                    </div>
                                                    <div className="msg-bubble-time">{formatTime(m.created_at)}</div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                                <div ref={bottomRef} />
                            </div>

                            {/* Compose */}
                            <div className="msg-compose">
                                <textarea
                                    ref={composeRef}
                                    className="msg-compose-input"
                                    rows={2}
                                    placeholder={`Message ${active.name}…  (Enter to send, Shift+Enter for newline)`}
                                    value={compose}
                                    onChange={e => setCompose(e.target.value)}
                                    onKeyDown={handleKey}
                                    disabled={sending}
                                />
                                <button
                                    className="btn btn-primary msg-send-btn"
                                    onClick={send}
                                    disabled={sending || !compose.trim()}
                                >
                                    {sending ? '…' : 'Send'}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </Layout>
    );
}
