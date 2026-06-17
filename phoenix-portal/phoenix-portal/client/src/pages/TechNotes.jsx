import { useEffect, useState } from 'react';
import api from '../api/client';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';

const TABS = [
    { key: 'dw',  label: 'DW Spectrum' },
    { key: 'dmp', label: 'DMP Setup Parameters' },
    { key: 'ens', label: 'ENS' },
];

/* Render a line, turning [label](url) and bare URLs into clickable links. */
function renderLine(line) {
    const re = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)|(https?:\/\/[^\s]+)/g;
    const out = [];
    let last = 0, m, key = 0;
    while ((m = re.exec(line)) !== null) {
        if (m.index > last) out.push(line.slice(last, m.index));
        const href = m[2] || m[3];
        const text = m[1] || m[3];
        out.push(<a key={key++} href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{text}</a>);
        last = re.lastIndex;
    }
    if (last < line.length) out.push(line.slice(last));
    return out.length ? out : ' ';   // keep blank lines from collapsing
}

const renderNotes = text =>
    String(text || '').split('\n').map((line, i) => <div key={i}>{renderLine(line)}</div>);

export default function TechNotes() {
    const { user } = useAuth();
    const isAdmin  = user.role === 'admin';

    const [sections, setSections] = useState(null);
    const [tab, setTab]           = useState('dw');
    const [editing, setEditing]   = useState(false);
    const [draft, setDraft]       = useState('');
    const [saving, setSaving]     = useState(false);
    const [error, setError]       = useState('');

    useEffect(() => {
        api.get('/tech-notes')
            .then(r => setSections(r.data.sections))
            .catch(() => setError('Failed to load notes.'));
    }, []);

    const switchTab = (k) => { setTab(k); setEditing(false); setError(''); };

    const startEdit = () => { setDraft(sections[tab] || ''); setEditing(true); setError(''); };

    const save = async () => {
        setSaving(true); setError('');
        try {
            await api.put('/tech-notes', { section: tab, content: draft });
            setSections(s => ({ ...s, [tab]: draft }));
            setEditing(false);
        } catch (e) {
            setError(e.response?.data?.error || 'Save failed.');
        } finally { setSaving(false); }
    };

    return (
        <Layout>
            <div className="page-header">
                <h1 className="page-title">Technician&apos;s Notes</h1>
                {isAdmin && sections && !editing && (
                    <button className="btn btn-ghost" onClick={startEdit}>✎ Edit</button>
                )}
            </div>

            <div className="alarm-service-tabs" style={{ marginBottom: 20 }}>
                {TABS.map(t => (
                    <button key={t.key} className={`alarm-tab ${tab === t.key ? 'active' : ''}`} onClick={() => switchTab(t.key)}>{t.label}</button>
                ))}
            </div>

            {error && <div className="error-msg">{error}</div>}

            {!sections ? (
                <p style={{ color: 'var(--text-dim)' }}>Loading…</p>
            ) : editing ? (
                <div style={{ maxWidth: 760 }}>
                    <textarea
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        rows={16}
                        style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.6, resize: 'vertical' }}
                    />
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', margin: '6px 0 10px' }}>
                        Links: write <code>[label](https://…)</code> or paste a bare URL. Blank lines and line breaks are preserved.
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                        <button className="btn btn-ghost" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
                    </div>
                </div>
            ) : (
                <div className="table-card" style={{ padding: 24, lineHeight: 1.9, maxWidth: 760, fontSize: 15, color: 'var(--text)' }}>
                    {renderNotes(sections[tab])}
                </div>
            )}
        </Layout>
    );
}
