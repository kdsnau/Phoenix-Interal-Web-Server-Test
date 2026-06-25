import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const links = [
    ['/', 'Activity', '▦'],
    ['/users', 'Users', '◉'],
    ['/doors', 'Doors', '⊞'],
    ['/rules', 'Rules', '⚖'],
    ['/groups', 'Groups', '⧉'],
];

export default function Layout({ children }) {
    const { user, logout } = useAuth();
    const nav = useNavigate();

    return (
        <div className="layout">
            <aside className="sidebar">
                <div className="brand"><span className="dot" /> Phoenix Door</div>
                {links.map(([to, label, icon]) => (
                    <NavLink key={to} to={to} end={to === '/'} className="navlink">
                        <span aria-hidden>{icon}</span> {label}
                    </NavLink>
                ))}
                <div className="spacer" />
                <div className="muted" style={{ padding: '.5rem .7rem', fontSize: '.8rem' }}>
                    {user?.name}<br /><small>{user?.email}</small>
                </div>
                <button className="btn sm" onClick={() => { logout(); nav('/login'); }}>Log out</button>
            </aside>
            <main className="content">{children}</main>
        </div>
    );
}
