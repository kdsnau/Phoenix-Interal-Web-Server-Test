import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import Layout from '../components/Layout';

/* Role-specific stat renderers */
function AdminStats({ stats }) {
    const userCounts = Object.fromEntries(stats.users.map(u => [u.role, Number(u.count)]));
    const ticketCounts = Object.fromEntries(stats.tickets.map(t => [t.status, Number(t.count)]));
    return (
        <>
            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-label">Total Users</div>
                    <div className="stat-value accent">
                        {Object.values(userCounts).reduce((a,b) => a+b, 0)}
                    </div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Technicians</div>
                    <div className="stat-value">{userCounts.technician || 0}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Accounting</div>
                    <div className="stat-value">{userCounts.accounting || 0}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Open Tickets</div>
                    <div className="stat-value yellow">{ticketCounts.open || 0}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">In Progress</div>
                    <div className="stat-value blue">{ticketCounts.in_progress || 0}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Revenue</div>
                    <div className="stat-value green">
                        ${Number(stats.finance.total_income).toLocaleString()}
                    </div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Expenses</div>
                    <div className="stat-value red">
                        ${Number(stats.finance.total_expenses).toLocaleString()}
                    </div>
                </div>
            </div>
        </>
    );
}

function TechnicianStats({ tickets }) {
    const open = tickets.filter(t => t.status === 'open').length;
    const inprog = tickets.filter(t => t.status === 'in_progress').length;
    const resolved = tickets.filter(t => t.status === 'resolved').length;
    return (
        <div className="stats-grid">
            <div className="stat-card">
                <div className="stat-label">My Tickets</div>
                <div className="stat-value accent">{tickets.length}</div>
            </div>
            <div className="stat-card">
                <div className="stat-label">Open</div>
                <div className="stat-value yellow">{open}</div>
            </div>
            <div className="stat-card">
                <div className="stat-label">In Progress</div>
                <div className="stat-value blue">{inprog}</div>
            </div>
            <div className="stat-card">
                <div className="stat-label">Resolved</div>
                <div className="stat-value green">{resolved}</div>
            </div>
        </div>
    );
}

function AccountingStats({ summary }) {
    const net = Number(summary.net);
    return (
        <div className="stats-grid">
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

export default function Dashboard() {
    const { user } = useAuth();
    const [data, setData]     = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            try {
                if (user.role === 'admin') {
                    const { data } = await api.get('/admin/stats');
                    setData({ type: 'admin', payload: data });
                } else if (user.role === 'technician') {
                    const { data } = await api.get('/tickets');
                    setData({ type: 'technician', payload: data });
                } else {
                    const { data } = await api.get('/financials/summary');
                    setData({ type: 'accounting', payload: data });
                }
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
                    <span>{new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' })}</span>
                </h1>
            </div>

            {loading && <p style={{ color: 'var(--text-dim)' }}>Loading...</p>}

            {!loading && data?.type === 'admin'      && <AdminStats stats={data.payload} />}
            {!loading && data?.type === 'technician'  && <TechnicianStats tickets={data.payload} />}
            {!loading && data?.type === 'accounting'  && <AccountingStats summary={data.payload} />}

            <div style={{ marginTop: 24, padding: 20, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                    Session Info
                </div>
                <div style={{ color: 'var(--text)', fontSize: 13 }}>
                    Logged in as <strong style={{ color: 'var(--text-hi)' }}>{user.name}</strong>
                    {' · '}
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: 12 }}>{user.role}</span>
                    {' · '}
                    <span style={{ color: 'var(--text-dim)' }}>{user.email}</span>
                </div>
            </div>
        </Layout>
    );
}
