import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
    const { login } = useAuth();
    const nav = useNavigate();
    const [email, setEmail] = useState('admin@phoenixsectech.com');
    const [password, setPassword] = useState('');
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);

    async function submit(e) {
        e.preventDefault();
        setErr(''); setBusy(true);
        try {
            await login(email, password);
            nav('/');
        } catch (e) {
            setErr(e.message || 'Login failed');
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="login-wrap">
            <form className="panel login-card" onSubmit={submit}>
                <div className="brand" style={{ paddingLeft: 0 }}><span className="dot" /> Phoenix Door</div>
                <h2>Admin sign in</h2>
                {err && <div className="error" style={{ marginBottom: '.75rem' }}>{err}</div>}
                <label>Email</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
                <label>Password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <button className="btn primary" style={{ marginTop: '1rem', width: '100%' }} disabled={busy}>
                    {busy ? 'Signing in…' : 'Sign in'}
                </button>
            </form>
        </div>
    );
}
