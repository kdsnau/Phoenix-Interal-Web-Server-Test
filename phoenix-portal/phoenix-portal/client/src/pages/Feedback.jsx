import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import Layout from '../components/Layout';
import './Feedback.css';

const CATEGORIES = [
    { value: 'bug',         label: 'Bug Report',   desc: 'Something is broken or not working as expected.' },
    { value: 'feature',     label: 'Feature Request', desc: 'A new capability you would like to see.' },
    { value: 'improvement', label: 'Improvement',  desc: 'An existing feature that could work better.' },
    { value: 'general',     label: 'General',      desc: 'Anything else — questions, comments, ideas.' },
];

export default function Feedback() {
    const { user } = useAuth();
    const [category, setCategory] = useState('general');
    const [subject,  setSubject]  = useState('');
    const [message,  setMessage]  = useState('');
    const [loading,  setLoading]  = useState(false);
    const [sent,     setSent]     = useState(false);
    const [error,    setError]    = useState('');

    const submit = async (e) => {
        e.preventDefault();
        if (!subject.trim() || !message.trim()) return;
        setLoading(true);
        setError('');
        try {
            await api.post('/feedback', { category, subject, message });
            setSent(true);
            setSubject('');
            setMessage('');
            setCategory('general');
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to send. Try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Layout>
            <div className="page-header">
                <h1 className="page-title">Feedback</h1>
            </div>

            <p className="fb-subtitle">
                Report a bug, suggest a feature, or share any thoughts about the portal.
                Your submission goes directly to management.
            </p>

            {sent && (
                <div className="fb-success">
                    <span className="fb-success-icon">✓</span>
                    Feedback sent — thank you, {user.name}.
                    <button className="btn btn-ghost" style={{ marginLeft: 16, fontSize: 12 }} onClick={() => setSent(false)}>
                        Send another
                    </button>
                </div>
            )}

            {!sent && (
                <form className="fb-form" onSubmit={submit}>
                    {/* Category */}
                    <div className="fb-category-grid">
                        {CATEGORIES.map(c => (
                            <label key={c.value} className={`fb-category-card ${category === c.value ? 'selected' : ''}`}>
                                <input
                                    type="radio"
                                    name="category"
                                    value={c.value}
                                    checked={category === c.value}
                                    onChange={() => setCategory(c.value)}
                                />
                                <div className="fb-cat-label">{c.label}</div>
                                <div className="fb-cat-desc">{c.desc}</div>
                            </label>
                        ))}
                    </div>

                    {/* Subject */}
                    <div className="form-group">
                        <label className="form-label">Subject</label>
                        <input
                            value={subject}
                            onChange={e => setSubject(e.target.value)}
                            placeholder="One-line summary…"
                            maxLength={120}
                            required
                            disabled={loading}
                        />
                    </div>

                    {/* Message */}
                    <div className="form-group">
                        <label className="form-label">Message</label>
                        <textarea
                            className="fb-textarea"
                            rows={6}
                            value={message}
                            onChange={e => setMessage(e.target.value)}
                            placeholder="Describe the issue or idea in as much detail as you like…"
                            required
                            disabled={loading}
                        />
                    </div>

                    {/* Sender info (read-only) */}
                    <div className="fb-from">
                        Sending as <strong>{user.name}</strong>
                        <span className="fb-from-role">{user.role}</span>
                        <span className="fb-from-email">{user.email}</span>
                    </div>

                    {error && <div className="fb-error">{error}</div>}

                    <div className="modal-actions" style={{ justifyContent: 'flex-start', marginTop: 20 }}>
                        <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={loading || !subject.trim() || !message.trim()}
                        >
                            {loading ? 'Sending…' : 'Send Feedback'}
                        </button>
                    </div>
                </form>
            )}
        </Layout>
    );
}
