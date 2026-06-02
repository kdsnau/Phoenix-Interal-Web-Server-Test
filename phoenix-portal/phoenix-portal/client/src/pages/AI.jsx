import { useState } from 'react';
import api from '../api/client';
import Layout from '../components/Layout';
import './AI.css';

const QUICK = [
    'Give me a full status summary of the company.',
    'Summarize recent project activity from Slack.',
    'Which vehicles have open maintenance issues?',
    'What does the financial picture look like right now?',
    'Which clients have no billing amount set?',
];

export default function AI() {
    const [question, setQuestion] = useState('');
    const [answer,   setAnswer]   = useState('');
    const [loading,  setLoading]  = useState(false);
    const [error,    setError]    = useState('');
    const [elapsed,  setElapsed]  = useState(null);

    const ask = async (q) => {
        const text = (q ?? question).trim();
        if (!text || loading) return;
        setLoading(true);
        setAnswer('');
        setError('');
        setElapsed(null);
        const t0 = Date.now();
        try {
            const { data } = await api.post('/ai/query', { question: text });
            setAnswer(data.answer);
            setElapsed(((Date.now() - t0) / 1000).toFixed(1));
        } catch (e) {
            setError(e.response?.data?.error || 'Request failed.');
        } finally {
            setLoading(false);
        }
    };

    const handleKey = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); }
    };

    return (
        <Layout>
            <div className="page-header">
                <h1 className="page-title">AI Assistant</h1>
            </div>

            <p className="ai-subtitle">
                Ask anything about clients, fleet, financials, tickets, or projects.
                Data is fetched live from the portal database.
            </p>

            {/* Quick-action chips */}
            <div className="ai-quick-row">
                {QUICK.map(q => (
                    <button
                        key={q}
                        className="btn btn-ghost ai-chip"
                        disabled={loading}
                        onClick={() => { setQuestion(q); ask(q); }}
                    >
                        {q}
                    </button>
                ))}
            </div>

            {/* Input */}
            <div className="ai-input-row">
                <textarea
                    className="ai-textarea"
                    rows={2}
                    placeholder="Type a question and press Enter…"
                    value={question}
                    onChange={e => setQuestion(e.target.value)}
                    onKeyDown={handleKey}
                    disabled={loading}
                />
                <button
                    className="btn btn-primary ai-submit"
                    onClick={() => ask()}
                    disabled={loading || !question.trim()}
                >
                    {loading ? 'Thinking…' : 'Ask'}
                </button>
            </div>

            {/* Loading */}
            {loading && (
                <div className="ai-loading">
                    <span className="ai-spinner" />
                    Querying portal data and generating summary…
                </div>
            )}

            {/* Error */}
            {error && <div className="ai-error">{error}</div>}

            {/* Answer */}
            {answer && (
                <div className="ai-answer">
                    <div className="ai-answer-meta">
                        Response
                        {elapsed && <span className="ai-elapsed">{elapsed}s</span>}
                    </div>
                    <div className="ai-answer-body">{answer}</div>
                    <button
                        className="btn btn-ghost ai-clear"
                        onClick={() => { setAnswer(''); setQuestion(''); setElapsed(null); }}
                    >
                        Clear
                    </button>
                </div>
            )}
        </Layout>
    );
}
