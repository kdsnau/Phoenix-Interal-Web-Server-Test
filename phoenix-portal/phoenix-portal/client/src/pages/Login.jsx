import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import './Login.css';

export default function Login() {
    const [email, setEmail]       = useState('');
    const [password, setPassword] = useState('');
    const [error, setError]       = useState('');
    const [loading, setLoading]   = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const { data } = await api.post('/auth/login', { email, password });
            login(data.token, data.user);
            navigate('/dashboard');
        } catch (err) {
            setError(err.response?.data?.error || 'Login failed.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-page">
            <div className="login-left">
                <div className="login-brand">
                    <span className="login-mark">PST</span>
                    <div>
                        <div className="login-brand-name">Phoenix Security</div>
                        <div className="login-brand-sub">&amp; Technology</div>
                    </div>
                </div>
                <div className="login-tagline">
                    Internal Operations Portal
                </div>
                <div className="login-grid-bg" aria-hidden="true" />
            </div>

            <div className="login-right">
                <form className="login-form" onSubmit={handleSubmit}>
                    <h1 className="login-title">Sign in</h1>
                    <p className="login-desc">Access your workspace</p>

                    {error && <div className="error-msg">{error}</div>}

                    <div className="form-group">
                        <label className="form-label">Email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            placeholder="you@phoenixsectech.com"
                            required
                            autoFocus
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label">Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="••••••••"
                            required
                        />
                    </div>

                    <button
                        type="submit"
                        className="btn btn-primary login-submit"
                        disabled={loading}
                    >
                        {loading ? 'Signing in...' : 'Sign in →'}
                    </button>
                </form>
            </div>
        </div>
    );
}
