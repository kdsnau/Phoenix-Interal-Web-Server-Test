import { useState } from 'react';
import api from '../api/client';

/* Field-report form for a done ticket. Posts to the project-reports Slack channel
   (Job name = the ticket's client) and records it locally. Prefills the parts list
   from the ticket's inventory items. */
export default function ReportModal({ ticket, onClose, onSaved }) {
    const [work,       setWork]       = useState('');
    const [parts,      setParts]      = useState(ticket.parts_suggestion || '');
    const [arrival,    setArrival]    = useState('');
    const [returnTrip, setReturnTrip] = useState(false);
    const [photos,     setPhotos]     = useState([]);
    const [error,      setError]      = useState('');
    const [saving,     setSaving]     = useState(false);

    const jobName = ticket.client_name || ticket.title || 'Unknown';

    async function submit(e) {
        e.preventDefault();
        if (!work.trim()) { setError('Please describe the work completed.'); return; }
        setError(''); setSaving(true);
        try {
            const fd = new FormData();
            fd.append('ticket_id', ticket.id);
            fd.append('work', work);
            fd.append('parts', parts);
            fd.append('arrival', arrival);
            fd.append('return_trip', returnTrip ? 'true' : 'false');
            photos.forEach(f => fd.append('photos', f));
            const { data } = await api.post('/projects/report', fd);
            onSaved?.(data);
            onClose();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to submit report.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
                <div className="modal-title">Field Report</div>
                <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: -6, marginBottom: 12 }}>
                    Posting to <strong style={{ color: 'var(--text)' }}>{jobName}</strong>
                    {ticket.title && ticket.client_name ? ` · ${ticket.title}` : ''}
                </div>
                {error && <div className="error-msg">{error}</div>}
                <form onSubmit={submit}>
                    <div className="form-group">
                        <label className="form-label">What work was completed *</label>
                        <textarea value={work} onChange={e => setWork(e.target.value)} rows={4} autoFocus required style={{ resize: 'vertical' }} placeholder="Describe the service performed…" />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Parts &amp; supplies used</label>
                        <textarea value={parts} onChange={e => setParts(e.target.value)} rows={3} style={{ resize: 'vertical' }} placeholder="Prefilled from the ticket's items — edit as needed" />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Site arrival &amp; departure times</label>
                        <input value={arrival} onChange={e => setArrival(e.target.value)} placeholder="e.g. 9:00 AM – 11:30 AM" />
                    </div>
                    <div className="form-group">
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
                            <input type="checkbox" checked={returnTrip} onChange={e => setReturnTrip(e.target.checked)} style={{ width: 'auto' }} />
                            A return trip is required (job not complete)
                        </label>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Photos</label>
                        <input type="file" accept="image/*" multiple onChange={e => setPhotos([...e.target.files])} />
                        {photos.length > 0 && (
                            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>{photos.length} photo{photos.length !== 1 ? 's' : ''} attached</div>
                        )}
                    </div>
                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Posting…' : 'Post Report'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
