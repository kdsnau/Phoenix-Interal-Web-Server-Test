import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import api from '../api/client';
import ChangePasswordModal from './ChangePasswordModal';
import './Layout.css';

export const NAV = {
    technician: [
        { divider: 'Operations' },
        { path: '/dashboard', label: 'Dashboard' },
        { path: '/tickets',   label: 'Tickets'   },
        { path: '/projects',  label: 'Reports'  },
        { path: '/team-calendar', label: 'Team Calendar' },
        { path: '/tech-notes', label: "Technician's Notes" },
        { divider: 'Field' },
        { path: '/clients',   label: 'Clients'   },
        { path: '/fleet',     label: 'Fleet'     },
        { path: '/inventory', label: 'Inventory' },
        { path: '/licenses',  label: 'Licenses'  },
        { path: '/cameras',   label: 'Cameras'   },
        { divider: 'Tools' },
        { path: '/messages',  label: 'Messages'  },
        { path: '/feedback',  label: 'Feedback'  },
        { divider: 'System' },
        { path: '/vault',     label: 'Vault'     },
    ],
    accounting: [
        { divider: 'Operations' },
        { path: '/dashboard',  label: 'Dashboard'  },
        { path: '/calls',      label: 'Calls'      },
        { path: '/projects',   label: 'Reports'   },
        { path: '/team-calendar', label: 'Team Calendar' },
        { path: '/tech-notes', label: "Technician's Notes" },
        { divider: 'Finance' },
        { path: '/financials', label: 'Financials' },
        { path: '/snapshot',   label: 'Snapshot'   },
        { path: '/timesheets', label: 'Timesheets' },
        { divider: 'Field' },
        { path: '/clients',    label: 'Clients'    },
        { path: '/fleet',      label: 'Fleet'      },
        { path: '/inventory',  label: 'Inventory'  },
        { path: '/licenses',   label: 'Licenses'   },
        { path: '/cameras',    label: 'Cameras'    },
        { divider: 'Tools' },
        { path: '/messages',   label: 'Messages'   },
        { path: '/feedback',   label: 'Feedback'   },
        { divider: 'System' },
        { path: '/vault',      label: 'Vault'      },
    ],
    admin: [
        { divider: 'Operations' },
        { path: '/dashboard',  label: 'Dashboard'  },
        { path: '/tickets',    label: 'Tickets'    },
        { path: '/calls',      label: 'Calls'      },
        { path: '/projects',   label: 'Reports'   },
        { path: '/team-calendar', label: 'Team Calendar' },
        { path: '/tech-notes', label: "Technician's Notes" },
        { divider: 'Field' },
        { path: '/clients',    label: 'Clients'    },
        { path: '/fleet',      label: 'Fleet'      },
        { path: '/inventory',  label: 'Inventory'  },
        { path: '/licenses',   label: 'Licenses'   },
        { path: '/cameras',    label: 'Cameras'    },
        { divider: 'Finance' },
        { path: '/financials', label: 'Financials' },
        { path: '/snapshot',   label: 'Snapshot'   },
        { path: '/timesheets', label: 'Timesheets' },
        { divider: 'Tools' },
        { path: '/messages',   label: 'Messages'   },
        { path: '/feedback',   label: 'Feedback'   },
        { divider: 'System' },
        { path: '/admin',      label: 'Admin'      },
        { path: '/vault',      label: 'Vault'      },
    ],
};

/* Stroke icons for the mobile bottom tab bar (single <path>, multiple subpaths). */
const ICON = {
    home:    'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5',
    tickets: 'M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8ZM14 6v12',
    finance: 'M12 2v20M16.5 6H10a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H7',
    clients: 'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM21 20v-1a4 4 0 0 0-3-3.87M16 4.13a4 4 0 0 1 0 7.75',
    inbox:   'M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2Z',
    more:    'M4 6h16M4 12h16M4 18h16',
};
const TabIcon = ({ d }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

export default function Layout({ children }) {
    const { user, logout }      = useAuth();
    const navigate              = useNavigate();
    const location              = useLocation();
    const [open, setOpen]       = useState(false);
    const [pwOpen, setPwOpen]   = useState(false);
    const [msgUnread, setMsgUnread] = useState(0);

    /* Poll total unread message count for the sidebar badge. Refetches on every
       navigation (so it clears right after you read a thread) and every 30s. */
    useEffect(() => {
        let alive = true;
        const fetchUnread = () => api.get('/messages/unread')
            .then(r => { if (alive) setMsgUnread(r.data?.count || 0); })
            .catch(() => {});
        fetchUnread();
        const t = setInterval(fetchUnread, 30000);
        return () => { alive = false; clearInterval(t); };
    }, [location.pathname]);

    /* Close sidebar whenever the route changes (user tapped a link) */
    useEffect(() => { setOpen(false); }, [location.pathname]);

    /* Auto-fill data-label on every .card-table cell from its column headers, so a
       table only needs the `card-table` class to become labelled cards on mobile.
       Re-runs on navigation and whenever table content changes (async data loads).
       Only observes childList (never attributes), so setting data-label can't loop. */
    useEffect(() => {
        const label = () => {
            document.querySelectorAll('table.card-table').forEach((table) => {
                // One header row, expanded by colSpan so column indices line up.
                const headRow = table.querySelector('thead tr');
                if (!headRow) return;
                const heads = [];
                [...headRow.children].forEach((th) => {
                    const text = th.textContent.trim();
                    const span = Number(th.colSpan) || 1;
                    for (let i = 0; i < span; i += 1) heads.push(text);
                });
                table.querySelectorAll('tbody tr').forEach((tr) => {
                    let col = 0;
                    [...tr.children].forEach((td) => {
                        if (td.tagName !== 'TD') return;
                        const span = Number(td.colSpan) || 1;
                        // Only label single-column cells; advance by span so cells
                        // after a colSpan (e.g. total rows) still map to the right header.
                        if (span === 1 && !td.hasAttribute('data-label')) {
                            const text = heads[col];
                            if (text) td.setAttribute('data-label', text);
                        }
                        col += span;
                    });
                });
            });
        };
        label();
        let raf = 0;
        const obs = new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(label); });
        const root = document.querySelector('.main-content') || document.body;
        obs.observe(root, { childList: true, subtree: true });
        return () => { obs.disconnect(); cancelAnimationFrame(raf); };
    }, [location.pathname]);

    /* Prevent body scroll while sidebar overlay is open */
    useEffect(() => {
        document.body.style.overflow = open ? 'hidden' : '';
        return () => { document.body.style.overflow = ''; };
    }, [open]);

    const handleLogout = () => { logout(); navigate('/login'); };
    const links = NAV[user?.role] || [];

    /* Primary destinations for the mobile bottom tab bar (+ a More button that
       opens the full sidebar). The middle "work" tab is role-specific. */
    const bottomTabs = [
        { path: '/dashboard', label: 'Home', icon: 'home' },
        user?.role === 'accounting'
            ? { path: '/financials', label: 'Finance', icon: 'finance' }
            : { path: '/tickets', label: 'Tickets', icon: 'tickets' },
        { path: '/clients', label: 'Clients', icon: 'clients' },
        { path: '/messages', label: 'Inbox', icon: 'inbox', badge: msgUnread },
    ];

    return (
        <div className="layout">

            {/* ── Mobile overlay (tap to close) ───────────────────── */}
            {open && <div className="sidebar-overlay" onClick={() => setOpen(false)} />}

            {/* ── Sidebar ─────────────────────────────────────────── */}
            <aside className={`sidebar ${open ? 'sidebar--open' : ''}`}>
                <div className="sidebar-brand">
                    <img className="brand-mark" src="/logo-mark.png" alt="" width="95" height="128" />
                    <div>
                        <div className="brand-name">Phoenix</div>
                        <div className="brand-sub">Security &amp; Technology</div>
                    </div>
                    {/* ✕ close button — only visible on mobile */}
                    <button className="sidebar-close-btn" onClick={() => setOpen(false)} aria-label="Close menu">✕</button>
                </div>

                <nav className="sidebar-nav">
                    {links.map((item, i) =>
                        item.divider ? (
                            <div key={`divider-${i}`} className="nav-divider">{item.divider}</div>
                        ) : (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={`nav-link ${location.pathname === item.path ? 'active' : ''}`}
                            >
                                <span className="nav-indicator" />
                                {item.label}
                                {item.path === '/messages' && msgUnread > 0 && (
                                    <span style={{
                                        marginLeft: 'auto', background: 'var(--red)', color: '#fff',
                                        fontSize: 10, fontWeight: 700, minWidth: 18, height: 18, borderRadius: 9,
                                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px',
                                    }}>{msgUnread > 99 ? '99+' : msgUnread}</span>
                                )}
                            </Link>
                        )
                    )}
                </nav>

                <div className="sidebar-footer">
                    <Link to="/profile" className="user-info" style={{ textDecoration: 'none', cursor: 'pointer' }} title="View my profile">
                        <div className="user-name">{user?.name}</div>
                        <div className="user-role">{user?.role}</div>
                    </Link>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                        <button className="logout-btn" onClick={() => setPwOpen(true)}>Password</button>
                        <button className="logout-btn" onClick={handleLogout}>Logout</button>
                    </div>
                </div>
            </aside>

            {/* ── Main content ────────────────────────────────────── */}
            <main className="main-content">
                {/* Mobile top bar — hidden on desktop */}
                <div className="mobile-topbar">
                    <button className="hamburger" onClick={() => setOpen(true)} aria-label="Open menu">
                        <span /><span /><span />
                    </button>
                    <img className="mobile-brand-mark" src="/logo-mark.png" alt="" width="95" height="128" />
                    <span className="mobile-brand-name">Phoenix SecTech</span>
                </div>

                {children}

                <div className="data-disclaimer">
                    Portal data is aggregated from connected systems — always verify critical information from primary sources before acting on it.
                </div>
            </main>

            {/* ── Mobile bottom tab bar (hidden on desktop via CSS) ── */}
            <nav className="bottom-nav">
                {bottomTabs.map((t) => (
                    <Link
                        key={t.path}
                        to={t.path}
                        className={`bottom-tab ${location.pathname === t.path ? 'active' : ''}`}
                    >
                        <TabIcon d={ICON[t.icon]} />
                        <span className="bottom-tab-label">{t.label}</span>
                        {t.badge > 0 && (
                            <span className="bottom-tab-badge">{t.badge > 99 ? '99+' : t.badge}</span>
                        )}
                    </Link>
                ))}
                <button className="bottom-tab" onClick={() => setOpen(true)} aria-label="More menu">
                    <TabIcon d={ICON.more} />
                    <span className="bottom-tab-label">More</span>
                </button>
            </nav>

            {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} />}
        </div>
    );
}
