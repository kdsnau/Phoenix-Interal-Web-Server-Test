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
    ],
    accounting: [
        { path: '/dashboard',  label: 'Dashboard'  },
        { path: '/financials', label: 'Financials' },
        { path: '/alarms',     label: 'Alarms'     },
        { path: '/fleet',      label: 'Fleet'      },
        { path: '/inventory',  label: 'Inventory'  },
        { path: '/projects',   label: 'Projects'   },
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
    ],
};

export default function Layout({ children }) {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const handleLogout = () => { logout(); navigate('/login'); };
    const links = NAV[user?.role] || [];

    return (
        <div className="layout">
            <aside className="sidebar">
                <div className="sidebar-brand">
                    <span className="brand-mark">PST</span>
                    <div>
                        <div className="brand-name">Phoenix</div>
                        <div className="brand-sub">Security &amp; Technology</div>
                    </div>
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

            <main className="main-content">
                {children}
                <div className="data-disclaimer">
                    Portal data is aggregated from connected systems — always verify critical information from primary sources before acting on it.
                </div>
            </main>
        </div>
    );
}
