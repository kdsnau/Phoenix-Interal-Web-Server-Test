import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import './Layout.css';

const NAV = {
    technician: [
        { path: '/dashboard', label: 'Dashboard' },
        { path: '/tickets',   label: 'Tickets'   },
        { path: '/alarms',    label: 'Alarms'    },
        { path: '/fleet',     label: 'Fleet'     },
        { path: '/inventory', label: 'Inventory' },
        { path: '/projects',  label: 'Projects'  },
        { path: '/ai',        label: 'AI'        },
        { path: '/messages',  label: 'Messages'  },
        { path: '/feedback',  label: 'Feedback'  },
    ],
    accounting: [
        { path: '/dashboard',  label: 'Dashboard'  },
        { path: '/financials', label: 'Financials' },
        { path: '/alarms',     label: 'Alarms'     },
        { path: '/fleet',      label: 'Fleet'      },
        { path: '/inventory',  label: 'Inventory'  },
        { path: '/projects',   label: 'Projects'   },
        { path: '/ai',         label: 'AI'         },
        { path: '/messages',   label: 'Messages'   },
        { path: '/feedback',   label: 'Feedback'   },
    ],
    admin: [
        { path: '/dashboard',  label: 'Dashboard'  },
        { path: '/tickets',    label: 'Tickets'    },
        { path: '/financials', label: 'Financials' },
        { path: '/alarms',     label: 'Alarms'     },
        { path: '/fleet',      label: 'Fleet'      },
        { path: '/inventory',  label: 'Inventory'  },
        { path: '/projects',   label: 'Projects'   },
        { path: '/admin',      label: 'Admin'      },
        { path: '/ai',         label: 'AI'         },
        { path: '/messages',   label: 'Messages'   },
        { path: '/feedback',   label: 'Feedback'   },
    ],
};

export default function Layout({ children }) {
    const { user, logout }      = useAuth();
    const navigate              = useNavigate();
    const location              = useLocation();
    const [open, setOpen]       = useState(false);

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
                    {links.map(({ path, label }) => (
                        <Link
                            key={path}
                            to={path}
                            className={`nav-link ${location.pathname === path ? 'active' : ''}`}
                        >
                            <span className="nav-indicator" />
                            {label}
                        </Link>
                    ))}
                </nav>

                <div className="sidebar-footer">
                    <div className="user-info">
                        <div className="user-name">{user?.name}</div>
                        <div className="user-role">{user?.role}</div>
                    </div>
                    <button className="logout-btn" onClick={handleLogout}>Logout</button>
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
        </div>
    );
}
