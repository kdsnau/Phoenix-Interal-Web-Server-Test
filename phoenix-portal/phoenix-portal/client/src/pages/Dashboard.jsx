import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import Layout from '../components/Layout';
import './Dashboard.css';

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
            <div className="stat-card">
                <div className="stat-label">Total Users</div>
                <div className="stat-value">{Object.values(userCounts).reduce((a, b) => a + b, 0)}</div>
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
    const [roleData, setRoleData] = useState(null);
    const [alerts,   setAlerts]   = useState(null);
    const [loading,  setLoading]  = useState(true);

    useEffect(() => {
        async function load() {
            try {
                const alertsFetch = api.get('/admin/alerts').catch(() => ({ data: null }));
                let roleFetch;
                if      (user.role === 'admin')      roleFetch = api.get('/admin/stats');
                else if (user.role === 'technician') roleFetch = api.get('/tickets');
                else                                 roleFetch = api.get('/financials/summary');

                const [alertsRes, roleRes] = await Promise.all([alertsFetch, roleFetch.catch(() => ({ data: null }))]);
                setAlerts(alertsRes.data);
                setRoleData(roleRes.data);
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [user.role]);

    return (
        <Layout>
            <div className="page-header">
                <h1 className="page-title">
                    Dashboard
                    <span>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
                </h1>
            </div>

            {loading && <p style={{ color: 'var(--text-dim)' }}>Loading…</p>}

            {!loading && (
                <>
                    {/* Role-specific stats */}
                    {user.role === 'admin'      && roleData && <AdminStats      stats={roleData}   mrr={alerts?.mrr || 0} openTickets={alerts?.openTickets || 0} />}
                    {user.role === 'technician' && roleData && <TechnicianStats tickets={roleData} />}
                    {user.role === 'accounting' && roleData && <AccountingStats summary={roleData} mrr={alerts?.mrr || 0} />}

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
        </Layout>
    );
}
