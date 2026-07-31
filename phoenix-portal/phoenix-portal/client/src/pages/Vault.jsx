import { useEffect, useState } from 'react';
import api from '../api/client';
import Layout from '../components/Layout';
import PageHelp from '../components/PageHelp';
import { useAuth } from '../context/AuthContext';

/* Permission roles an admin can grant a credential to (admins always have access). */
const ASSIGNABLE_ROLES = ['accounting', 'technician'];
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
const accessLabel = roles =>
    (!roles || roles.length === 0) ? 'Admins only' : `${roles.map(cap).join(', ')} + Admins`;

function RoleCheckboxes({ value, onChange }) {
    const toggle = role => {
        const set = new Set(value);
        set.has(role) ? set.delete(role) : set.add(role);
        onChange([...set]);
    };
    return (
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            {ASSIGNABLE_ROLES.map(r => (
                <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={value.includes(r)} onChange={() => toggle(r)} style={{ width: 'auto' }} /> {cap(r)}
                </label>
            ))}
        </div>
    );
}

/* Admin-only editor for a credential's label, username, and who can access it. */
function EntryEditModal({ entry, onSaved, onClose }) {
    const [label,    setLabel]    = useState(entry.label || '');
    const [username, setUsername] = useState(entry.username || '');
    const [roles,    setRoles]    = useState(entry.allowed_roles || []);
    const [error,    setError]    = useState('');
    const [saving,   setSaving]   = useState(false);

    async function submit(e) {
        e.preventDefault(); setError(''); setSaving(true);
        try {
            const { data } = await api.patch(`/vault/entries/${entry.id}`, { label, username, allowed_roles: roles });
            onSaved(data); onClose();
        } catch (err) { setError(err.response?.data?.error || 'Failed to save.'); setSaving(false); }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-title">Edit Credential</div>
                {error && <div className="error-msg">{error}</div>}
                <form onSubmit={submit}>
                    <div className="form-group"><label className="form-label">Service</label>
                        <input value={label} onChange={e => setLabel(e.target.value)} required autoFocus /></div>
                    <div className="form-group"><label className="form-label">Username</label>
                        <input value={username} onChange={e => setUsername(e.target.value)} placeholder="optional" /></div>
                    <div className="form-group"><label className="form-label">Who can access</label>
                        <RoleCheckboxes value={roles} onChange={setRoles} />
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>Admins always have access.</div></div>
                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

/* Credential vault. Everyone can open it and sees the credentials granted to
   their role; admins see all and manage them. Secrets are decrypted server-side
   and held only in component memory. */
export default function Vault() {
    const { user }  = useAuth();
    const isAdmin   = user?.role === 'admin';
    const [phase,    setPhase]    = useState('loading'); // loading | no-key | ready
    const [error,    setError]    = useState('');
    const [entries,  setEntries]  = useState([]);
    const [revealed, setRevealed] = useState({});
    const [busy,     setBusy]     = useState(false);
    const [genLabel, setGenLabel] = useState('');
    const [genUser,  setGenUser]  = useState('');
    const [genRoles, setGenRoles] = useState([]);
    const [editing,  setEditing]  = useState(null);

    const sortEntries = list => [...list].sort((a, b) => a.label.localeCompare(b.label));

    async function load() {
        try {
            const st = await api.get('/vault/status');
            if (!st.data.keyOk) { setPhase('no-key'); return; }
            const { data } = await api.get('/vault/entries');
            setEntries(sortEntries(data.entries));
            setPhase('ready');
        } catch { setError('Failed to load the vault.'); setPhase('ready'); }
    }
    useEffect(() => { load(); }, []);

    async function generate(e) {
        e.preventDefault(); setError(''); setBusy(true);
        try {
            const { data } = await api.post('/vault/generate', { label: genLabel, username: genUser, allowed_roles: genRoles });
            setEntries(prev => sortEntries([...prev, data]));
            setRevealed(r => ({ ...r, [data.id]: true }));
            setGenLabel(''); setGenUser(''); setGenRoles([]);
        } catch (err) { setError(err.response?.data?.error || 'Generate failed.'); }
        finally { setBusy(false); }
    }

    async function regenerate(id) {
        setError('');
        try {
            const { data } = await api.post(`/vault/entries/${id}/regenerate`, {});
            setEntries(prev => prev.map(en => en.id === id ? { ...en, ...data } : en));
            setRevealed(r => ({ ...r, [id]: true }));
        } catch (err) { setError(err.response?.data?.error || 'Regenerate failed.'); }
    }

    async function remove(id) {
        if (!confirm('Delete this entry? This cannot be undone.')) return;
        setError('');
        try { await api.delete(`/vault/entries/${id}`); setEntries(prev => prev.filter(en => en.id !== id)); }
        catch (err) { setError(err.response?.data?.error || 'Delete failed.'); }
    }

    const onEdited = data => setEntries(prev => sortEntries(prev.map(en => en.id === data.id ? { ...en, ...data } : en)));

    const cols = isAdmin ? 6 : 4;

    return (
        <Layout>
            <div className="page-header">
                <h1 className="page-title">Vault<PageHelp id="vault" /></h1>
            </div>
            {error && <div className="error-msg">{error}</div>}

            {phase === 'loading' && <p style={{ color: 'var(--text-dim)' }}>Loading…</p>}

            {phase === 'no-key' && (
                <div className="error-msg">
                    The server's <code>VAULT_KEY</code> isn't configured. Add a 32-byte key to <code>server/.env</code> and restart the portal.
                </div>
            )}

            {phase === 'ready' && (
                <>
                    {isAdmin ? (
                        <form onSubmit={generate} style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 20 }}>
                            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Service</label>
                                <input value={genLabel} onChange={e => setGenLabel(e.target.value)} placeholder="e.g. DW Spectrum NVR" required /></div>
                            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Username (optional)</label>
                                <input value={genUser} onChange={e => setGenUser(e.target.value)} placeholder="optional" /></div>
                            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Who can access</label>
                                <RoleCheckboxes value={genRoles} onChange={setGenRoles} /></div>
                            <button className="btn btn-primary" type="submit" disabled={busy}>+ Generate</button>
                        </form>
                    ) : (
                        <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 16 }}>
                            Credentials shared with your role ({user?.role}). Ask an admin if you need access to others.
                        </p>
                    )}

                    <div className="table-card">
                        <table className="data-table card-table">
                            <thead><tr>
                                <th>Service</th><th>Username</th><th>Password</th>
                                {isAdmin && <th>Access</th>}<th>Updated</th>{isAdmin && <th></th>}
                            </tr></thead>
                            <tbody>
                                {entries.length === 0 && (
                                    <tr><td colSpan={cols} style={{ color: 'var(--text-dim)', textAlign: 'center', padding: 24 }}>
                                        {isAdmin ? 'No credentials yet. Generate one above.' : 'No credentials are shared with your role yet.'}
                                    </td></tr>
                                )}
                                {entries.map(en => (
                                    <tr key={en.id}>
                                        <td style={{ color: 'var(--text-hi)' }}>{en.label}</td>
                                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>{en.username || '—'}</td>
                                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                                            {en.password == null ? (
                                                <span style={{ color: 'var(--red)' }}>⚠ decrypt error</span>
                                            ) : (
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                                    <span>{revealed[en.id] ? en.password : '•'.repeat(15)}</span>
                                                    <button className="btn btn-ghost" style={{ padding: '1px 6px', fontSize: 11 }} onClick={() => setRevealed(r => ({ ...r, [en.id]: !r[en.id] }))}>{revealed[en.id] ? 'Hide' : 'Show'}</button>
                                                    <button className="btn btn-ghost" style={{ padding: '1px 6px', fontSize: 11 }} onClick={() => navigator.clipboard?.writeText(en.password)}>Copy</button>
                                                </span>
                                            )}
                                        </td>
                                        {isAdmin && <td style={{ fontSize: 12, color: 'var(--text-dim)' }}>{accessLabel(en.allowed_roles)}</td>}
                                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>{en.updated_at ? new Date(en.updated_at).toLocaleDateString() : ''}</td>
                                        {isAdmin && (
                                            <td>
                                                <div style={{ display: 'flex', gap: 6 }}>
                                                    <button className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => setEditing(en)}>Edit</button>
                                                    <button className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => regenerate(en.id)}>Regenerate</button>
                                                    <button className="btn btn-danger" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => remove(en.id)}>Del</button>
                                                </div>
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {editing && <EntryEditModal entry={editing} onSaved={onEdited} onClose={() => setEditing(null)} />}
        </Layout>
    );
}
