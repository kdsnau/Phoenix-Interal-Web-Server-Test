import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import api from '../api/client';
import ChangePasswordModal from './ChangePasswordModal';
import './Layout.css';

const NAV = {
    technician: [
        { divider: 'Operations' },
        { path: '/dashboard', label: 'Dashboard' },
        { path: '/tickets',   label: 'Tickets'   },
        { path: '/calls',     label: 'Calls'     },
        { path: '/projects',  label: 'Projects'  },
        { path: '/team-calendar', label: 'Team Calendar' },
        { path: '/tech-notes', label: "Technician's Notes" },
        { divider: 'Field' },
        { path: '/clients',   label: 'Clients'   },
        { path: '/fleet',     label: 'Fleet'     },
        { path: '/inventory', label: 'Inventory' },
        { path: '/licenses',  label: 'Licenses'  },
        { path: '/cameras',   label: 'Cameras'   },
        { divider: 'Tools' },
        { path: '/ai',        label: 'AI'        },
        { path: '/messages',  label: 'Messages'  },
        { path: '/feedback',  label: 'Feedback'  },
    ],
    accounting: [
        { divider: 'Operations' },
        { path: '/dashboard',  label: 'Dashboard'  },
        { path: '/calls',      label: 'Calls'      },
        { path: '/projects',   label: 'Projects'   },
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
        { path: '/ai',         label: 'AI'         },
        { path: '/messages',   label: 'Messages'   },
        { path: '/feedback',   label: 'Feedback'   },
    ],
    admin: [
        { divider: 'Operations' },
        { path: '/dashboard',  label: 'Dashboard'  },
        { path: '/tickets',    label: 'Tickets'    },
        { path: '/calls',      label: 'Calls'      },
        { path: '/projects',   label: 'Projects'   },
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
        { path: '/ai',         label: 'AI'         },
        { path: '/messages',   label: 'Messages'   },
        { path: '/feedback',   label: 'Feedback'   },
        { divider: 'System' },
        { path: '/admin',      label: 'Admin'      },
        { path: '/vault',      label: 'Vault'      },
    ],
};

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

    /* Prevent body scroll while sidebar overlay is open */
    useEffect(() => {
        document.body.style.overflow = open ? 'hidden' : '';
        return () => { document.body.style.overflow = ''; };
    }, [open]);

    const handleLogout = () => { logout(); navigate('/login'); };
    const links = NAV[user?.role] || [];

    return (
        <div className="layout">

            {/* ── Mobile overlay (tap to close) ───────────────────── */}
            {open && <div className="sidebar-overlay" onClick={() => setOpen(false)} />}

            {/* ── Sidebar ─────────────────────────────────────────── */}
            <aside className={`sidebar ${open ? 'sidebar--open' : ''}`}>
                <div className="sidebar-brand">
                    <span className="brand-mark">PST</span>
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
                    <span className="mobile-brand-mark">PST</span>
                    <span className="mobile-brand-name">Phoenix SecTech</span>
                </div>

                {children}

                <div className="data-disclaimer">
                    Portal data is aggregated from connected systems — always verify critical information from primary sources before acting on it.
                </div>
            </main>

            {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} />}
        </div>
    );
}
