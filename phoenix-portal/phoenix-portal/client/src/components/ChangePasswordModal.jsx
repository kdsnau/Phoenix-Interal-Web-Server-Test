import { useState } from 'react';
import api from '../api/client';

export default function ChangePasswordModal({ onClose }) {
    const [current, setCurrent] = useState('');
    const [next,    setNext]    = useState('');
    const [confirm, setConfirm] = useState('');
    const [error,   setError]   = useState('');
    const [done,    setDone]    = useState(false);
    const [loading, setLoading] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        setError('');
        if (next.length < 8)  { setError('New password must be at least 8 characters.'); return; }
        if (next !== confirm) { setError('New passwords do not match.'); return; }
        setLoading(true);
        try {
            await api.post('/auth/change-password', { current_password: current, new_password: next });
            setDone(true);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to change password.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
                <div className="modal-title">Change Password</div>
                {done ? (
                    <>
                        <div style={{ color: 'var(--green)', marginBottom: 20 }}>✓ Your password has been updated.</div>
                        <div className="modal-actions">
                            <button className="btn btn-primary" onClick={onClose}>Done</button>
                        </div>
                    </>
                ) : (
                    <form onSubmit={submit}>
                        {error && <div className="error-msg">{error}</div>}
                        <div className="form-group">
                            <label className="form-label">Current Password</label>
                            <input type="password" value={current} onChange={e => setCurrent(e.target.value)}
                                   required autoFocus autoComplete="current-password" />
                        </div>
                        <div className="form-group">
                            <label className="form-label">New Password</label>
                            <input type="password" value={next} onChange={e => setNext(e.target.value)}
                                   required autoComplete="new-password" />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Confirm New Password</label>
                            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                                   required autoComplete="new-password" />
                        </div>
                        <div className="modal-actions">
                            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={loading}>
                                {loading ? 'Saving…' : 'Update Password'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
