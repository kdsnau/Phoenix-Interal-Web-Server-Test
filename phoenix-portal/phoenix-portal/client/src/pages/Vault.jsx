import { useEffect, useState } from 'react';
import api from '../api/client';
import Layout from '../components/Layout';
import PageHelp from '../components/PageHelp';

/* Admin credential vault. The page re-prompts for the vault password on every
   visit; the password is held only in component memory while unlocked and is
   discarded when you leave the page (nothing secret is persisted client-side). */
export default function Vault() {
    const [phase, setPhase]       = useState('loading'); // loading | no-key | setup | locked | unlocked
    const [error, setError]       = useState('');
    const [pw, setPw]             = useState('');         // gate password, kept in memory while unlocked
    const [entries, setEntries]   = useState([]);
    const [revealed, setRevealed] = useState({});
    const [busy, setBusy]         = useState(false);

    const [setupPw, setSetupPw]   = useState('');
    const [setupPw2, setSetupPw2] = useState('');
    const [unlockPw, setUnlockPw] = useState('');
    const [genLabel, setGenLabel] = useState('');
    const [genUser, setGenUser]   = useState('');

    useEffect(() => {
        api.get('/vault/status')
            .then(r => setPhase(!r.data.keyOk ? 'no-key' : !r.data.configured ? 'setup' : 'locked'))
            .catch(() => setError('Failed to load vault status.'));
    }, []);

    const sortEntries = list => [...list].sort((a, b) => a.label.localeCompare(b.label));
    const onAuthFail = e => { if (e.response?.status === 401) lock(); };

    async function doSetup(e) {
        e.preventDefault(); setError('');
        if (setupPw.length < 8)     return setError('Password must be at least 8 characters.');
        if (setupPw !== setupPw2)   return setError('Passwords do not match.');
        try { await api.post('/vault/setup', { password: setupPw }); setSetupPw(''); setSetupPw2(''); setPhase('locked'); }
        catch (e) { setError(e.response?.data?.error || 'Setup failed.'); }
    }

    async function doUnlock(e) {
        e.preventDefault(); setError(''); setBusy(true);
        try {
            const { data } = await api.post('/vault/unlock', { password: unlockPw });
            setEntries(sortEntries(data.entries));
            setPw(unlockPw); setUnlockPw(''); setPhase('unlocked');
        } catch (e) { setError(e.response?.data?.error || 'Unlock failed.'); }
        finally { setBusy(false); }
    }

    function lock() { setPw(''); setEntries([]); setRevealed({}); setPhase('locked'); }

    async function generate(e) {
        e.preventDefault(); setError(''); setBusy(true);
        try {
            const { data } = await api.post('/vault/generate', { password: pw, label: genLabel, username: genUser });
            setEntries(prev => sortEntries([...prev, data]));
            setRevealed(r => ({ ...r, [data.id]: true }));
            setGenLabel(''); setGenUser('');
        } catch (e) { setError(e.response?.data?.error || 'Generate failed.'); onAuthFail(e); }
        finally { setBusy(false); }
    }

    async function regenerate(id) {
        setError('');
        try {
            const { data } = await api.post(`/vault/entries/${id}/regenerate`, { password: pw });
            setEntries(prev => prev.map(en => en.id === id ? { ...en, ...data } : en));
            setRevealed(r => ({ ...r, [id]: true }));
        } catch (e) { setError(e.response?.data?.error || 'Regenerate failed.'); onAuthFail(e); }
    }

    async function remove(id) {
        if (!confirm('Delete this entry? This cannot be undone.')) return;
        setError('');
        try { await api.post(`/vault/entries/${id}/delete`, { password: pw }); setEntries(prev => prev.filter(en => en.id !== id)); }
        catch (e) { setError(e.response?.data?.error || 'Delete failed.'); onAuthFail(e); }
    }

    return (
        <Layout>
            <div className="page-header">
                <h1 className="page-title">Vault<PageHelp id="vault" /></h1>
                {phase === 'unlocked' && <button className="btn btn-ghost" onClick={lock}>🔒 Lock</button>}
            </div>
            {error && <div className="error-msg">{error}</div>}

            {phase === 'loading' && <p style={{ color: 'var(--text-dim)' }}>Loading…</p>}

            {phase === 'no-key' && (
                <div className="error-msg">
                    The server's <code>VAULT_KEY</code> isn't configured. Add a 32-byte key to <code>server/.env</code> and restart the portal.
                </div>
            )}

            {phase === 'setup' && (
                <form onSubmit={doSetup} style={{ maxWidth: 420 }}>
                    <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 14 }}>
                        Set the vault password. You'll be asked for it every time you open this page.
                    </p>
                    <div className="form-group"><label className="form-label">New vault password</label>
                        <input type="password" value={setupPw} onChange={e => setSetupPw(e.target.value)} autoFocus /></div>
                    <div className="form-group"><label className="form-label">Confirm password</label>
                        <input type="password" value={setupPw2} onChange={e => setSetupPw2(e.target.value)} /></div>
                    <button className="btn btn-primary" type="submit">Set Password</button>
                </form>
            )}

            {phase === 'locked' && (
                <form onSubmit={doUnlock} style={{ maxWidth: 420 }}>
                    <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 14 }}>🔒 Enter the vault password to view stored credentials.</p>
                    <div className="form-group"><label className="form-label">Vault password</label>
                        <input type="password" value={unlockPw} onChange={e => setUnlockPw(e.target.value)} autoFocus /></div>
                    <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Unlocking…' : 'Unlock'}</button>
                </form>
            )}

            {phase === 'unlocked' && (
                <>
                    <form onSubmit={generate} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 20 }}>
                        <div className="form-group" style={{ margin: 0 }}><label className="form-label">Service</label>
                            <input value={genLabel} onChange={e => setGenLabel(e.target.value)} placeholder="e.g. DW Spectrum NVR" required /></div>
                        <div className="form-group" style={{ margin: 0 }}><label className="form-label">Username (optional)</label>
                            <input value={genUser} onChange={e => setGenUser(e.target.value)} placeholder="optional" /></div>
                        <button className="btn btn-primary" type="submit" disabled={busy}>+ Generate</button>
                    </form>

                    <div className="table-card">
                        <table className="data-table">
                            <thead><tr><th>Service</th><th>Username</th><th>Password</th><th>Updated</th><th></th></tr></thead>
                            <tbody>
                                {entries.length === 0 && (
                                    <tr><td colSpan={5} style={{ color: 'var(--text-dim)', textAlign: 'center', padding: 24 }}>No credentials yet. Generate one above.</td></tr>
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
                                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>{en.updated_at ? new Date(en.updated_at).toLocaleDateString() : ''}</td>
                                        <td>
                                            <div style={{ display: 'flex', gap: 6 }}>
                                                <button className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => regenerate(en.id)}>Regenerate</button>
                                                <button className="btn btn-danger" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => remove(en.id)}>Del</button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 12 }}>
                        Leaving this page locks the vault — you'll be asked for the password again next time.
                    </p>
                </>
            )}
        </Layout>
    );
}
