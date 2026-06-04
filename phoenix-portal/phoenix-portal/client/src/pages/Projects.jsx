import { useState, useEffect, useRef } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import Layout from '../components/Layout';
import './Projects.css';

/* -----------------------------------------------------------------------
   Image component — fetches Slack private images via the proxy endpoint
   and uses a blob URL so <img> can display them without auth headers.
   ----------------------------------------------------------------------- */
function ProjectImage({ fileId, name }) {
    const [src, setSrc]     = useState(null);
    const [error, setError] = useState(false);
    const blobRef           = useRef(null);

    useEffect(() => {
        api.get(`/projects/image/${fileId}`, { responseType: 'blob' })
            .then(r => {
                const url = URL.createObjectURL(r.data);
                blobRef.current = url;
                setSrc(url);
            })
            .catch(() => setError(true));

        return () => { if (blobRef.current) URL.revokeObjectURL(blobRef.current); };
    }, [fileId]);

    if (error) return <div className="proj-img-placeholder">Image unavailable</div>;
    if (!src)  return <div className="proj-img-placeholder">Loading…</div>;
    return <img className="proj-img" src={src} alt={name || 'Project image'} />;
}

/* -----------------------------------------------------------------------
   Individual visit card inside the detail panel
   ----------------------------------------------------------------------- */
function VisitCard({ visit }) {
    const date = new Date(visit.date).toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });

    return (
        <div className="proj-visit">
            <div className="proj-visit-date">{date}</div>
            {visit._sourceName && (
                <div className="proj-field">
                    <div className="proj-label">Reported as</div>
                    <div className="proj-value proj-source-name">{visit._sourceName}</div>
                </div>
            )}
            {visit.technicians && (
                <div className="proj-field">
                    <div className="proj-label">Technicians</div>
                    <div className="proj-value">{visit.technicians}</div>
                </div>
            )}
            {visit.arrival && (
                <div className="proj-field">
                    <div className="proj-label">Site Times</div>
                    <div className="proj-value">{visit.arrival}</div>
                </div>
            )}
            {visit.work && (
                <div className="proj-field">
                    <div className="proj-label">Work Completed</div>
                    <div className="proj-value proj-work">{visit.work}</div>
                </div>
            )}
            {visit.parts && (
                <div className="proj-field">
                    <div className="proj-label">Parts & Supplies</div>
                    <div className="proj-value">{visit.parts}</div>
                </div>
            )}
            <div className="proj-field">
                <div className="proj-label">Status</div>
                <div className="proj-value">
                    <span className={visit.completed ? 'tag tag-green' : 'tag tag-yellow'}>
                        {visit.completed ? 'Complete' : 'Return Required'}
                    </span>
                </div>
            </div>
            {visit.images && visit.images.length > 0 && (
                <div className="proj-field">
                    <div className="proj-label">Photos</div>
                    <div className="proj-images">
                        {visit.images.map(img => (
                            <ProjectImage key={img.fileId} fileId={img.fileId} name={img.name} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

/* -----------------------------------------------------------------------
   Add manual project modal
   ----------------------------------------------------------------------- */
function NewProjectModal({ onClose, onCreated }) {
    const [form, setForm] = useState({ name: '', rfq: '', notes: '' });
    const [error,  setError]  = useState('');
    const [saving, setSaving] = useState(false);

    function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

    async function submit(e) {
        e.preventDefault();
        setError('');
        setSaving(true);
        try {
            const { data } = await api.post('/projects', form);
            onCreated(data);
            onClose();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to create project.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
                <div className="modal-title">Add Project</div>
                {error && <div className="error-msg">{error}</div>}
                <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div className="form-group">
                        <label className="form-label">Project Name *</label>
                        <input value={form.name} onChange={e => set('name', e.target.value)} required autoFocus placeholder="e.g. Terros Health - Phoenix" />
                    </div>
                    <div className="form-group">
                        <label className="form-label">RFQ # (optional)</label>
                        <input value={form.rfq} onChange={e => set('rfq', e.target.value)} placeholder="e.g. RFQ-2024-042" />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Notes / Description (optional)</label>
                        <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} placeholder="Scope, location, details…" style={{ resize: 'vertical' }} />
                    </div>
                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>
                            {saving ? 'Adding…' : 'Add Project'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

/* -----------------------------------------------------------------------
   Project detail overlay — shows all visits for a project
   ----------------------------------------------------------------------- */
function ProjectDetail({ project, onClose, onComplete, onDelete }) {
    return (
        <div className="proj-overlay" onClick={onClose}>
            <div className="proj-detail" onClick={e => e.stopPropagation()}>
                <div className="proj-detail-header">
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="proj-detail-name">{project.name}</div>
                        {project.rfq && <div className="proj-detail-rfq">RFQ# {project.rfq}</div>}
                    </div>
                    <button
                        className={`btn proj-complete-btn ${project.completed ? 'proj-complete-btn--done' : 'proj-complete-btn--wip'}`}
                        onClick={e => { e.stopPropagation(); onComplete(project, e); }}
                        title={project.completed ? 'Reopen project' : 'Mark project as complete'}
                    >
                        {project.completed ? '↩ Reopen' : '✓ Mark Complete'}
                    </button>
                    {project._manualId && (
                        <button
                            className="btn"
                            style={{ background: 'rgba(224,82,82,0.15)', color: 'var(--red)', border: '1px solid rgba(224,82,82,0.3)', fontSize: 12 }}
                            onClick={e => { e.stopPropagation(); onDelete(project); }}
                            title="Delete this manually-added project"
                        >
                            🗑 Delete
                        </button>
                    )}
                    <button className="proj-close-btn" onClick={onClose}>✕</button>
                </div>
                <div className="proj-detail-body">
                    {project.visits.map((v, i) => <VisitCard key={v.ts || i} visit={v} />)}
                </div>
            </div>
        </div>
    );
}

/* -----------------------------------------------------------------------
   Project summary card
   ----------------------------------------------------------------------- */
function ProjectCard({ project, onClick, onComplete }) {
    const lastDate = new Date(Number(project.lastVisit) * 1000).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
    });

    return (
        <div className={`proj-card ${project.completed ? 'proj-card--done' : ''}`} onClick={onClick}>
            <div className={`proj-card-bar ${project.completed ? 'proj-bar-done' : 'proj-bar-wip'}`} />
            <div className="proj-card-body">
                <div className="proj-card-name">{project.name}</div>
                {project.rfq && <div className="proj-card-rfq">RFQ# {project.rfq}</div>}
                <div className="proj-card-meta">
                    <span className={`tag ${project.completed ? 'tag-green' : 'tag-yellow'}`}>
                        {project.completed ? 'Complete' : 'In Progress'}
                    </span>
                    <span className="tag tag-dim">{project.visits.length} visit{project.visits.length !== 1 ? 's' : ''}</span>
                    <span className="tag tag-dim">Last: {lastDate}</span>
                </div>
            </div>
            <div className="proj-card-actions">
                <button
                    className={`proj-complete-btn ${project.completed ? 'proj-complete-btn--done' : 'proj-complete-btn--wip'}`}
                    onClick={e => { e.stopPropagation(); onComplete(project, e); }}
                    title={project.completed ? 'Reopen project' : 'Mark as complete'}
                >
                    {project.completed ? '↩ Reopen' : '✓ Complete'}
                </button>
            </div>
        </div>
    );
}

/* -----------------------------------------------------------------------
   Fuzzy grouping helpers — clusters projects with shared name tokens
   ----------------------------------------------------------------------- */
const STOP_WORDS = new Set([
    'the','a','an','and','or','of','in','at','for','to','by',
    'inc','llc','ltd','co','dba','new','old',
]);

function getTokens(name) {
    return name.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOP_WORDS.has(w))
        /* Basic plural/possessive stemming so "sisters" and "sister's" both
           resolve to "sister" and count as the same token when merging. */
        .map(w => w.endsWith('s') && w.length > 3 ? w.slice(0, -1) : w);
}

function groupAndMerge(list) {
    if (list.length === 0) return [];

    /* Union-Find */
    const parent = list.map((_, i) => i);
    function find(x) { return parent[x] === x ? x : (parent[x] = find(parent[x])); }
    function union(x, y) { parent[find(x)] = find(y); }

    /* Pre-compute token sets for each project */
    const tokenSets = list.map(p => new Set(getTokens(p.name)));

    /* Only merge projects that share 2+ meaningful tokens.
       Never merge manually-added projects with anything. */
    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            if (list[i]._manual || list[j]._manual) continue;
            const shared = [...tokenSets[i]].filter(t => tokenSets[j].has(t)).length;
            if (shared >= 2) union(i, j);
        }
    }

    /* Collect groups */
    const groupMap = {};
    list.forEach((p, i) => {
        const root = find(i);
        if (!groupMap[root]) groupMap[root] = [];
        groupMap[root].push(p);
    });

    /* Merge each group into a single project object */
    const merged = Object.values(groupMap).map(group => {
        if (group.length === 1) return group[0];

        /* Primary = most recently active member */
        const primary = [...group].sort((a, b) => b.lastVisit - a.lastVisit)[0];

        /* Combine all visits, newest first — tag each with its source job name */
        const allVisits = group
            .flatMap(p => (p.visits || []).map(v => ({ ...v, _sourceName: p.name })))
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        /* Combine unique RFQ numbers */
        const rfqs = [...new Set(group.map(p => p.rfq).filter(Boolean))].join(', ');

        return {
            ...primary,
            names:     group.map(p => p.name),
            visits:    allVisits,
            lastVisit: Math.max(...group.map(p => p.lastVisit)),
            /* Most recent visit across the whole group is authoritative */
            completed: allVisits[0]?.completed ?? primary.completed,
            rfq:       rfqs || primary.rfq,
        };
    });

    /* Sort: in-progress before completed, then most recent first */
    return merged.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return b.lastVisit - a.lastVisit;
    });
}

/* -----------------------------------------------------------------------
   Main Projects page
   ----------------------------------------------------------------------- */
const FILTER_TABS = ['all', 'in_progress', 'completed'];

export default function Projects() {
    const { user }                          = useAuth();
    const [projects, setProjects]           = useState([]);
    const [loading, setLoading]             = useState(true);
    const [filter, setFilter]               = useState('all');
    const [search, setSearch]               = useState('');
    const [selected, setSelected]           = useState(null);
    const [showAddProject, setShowAddProject] = useState(false);

    useEffect(() => {
        api.get('/projects')
            .then(r => setProjects(r.data))
            .finally(() => setLoading(false));
    }, []);

    const markComplete = async (project, e) => {
        if (e) e.stopPropagation();
        /* Merged projects carry a names[] array; single projects just use name */
        const names       = project.names || [project.name];
        const newCompleted = !project.completed;

        /* Optimistic update on raw state */
        setProjects(prev =>
            prev.map(p => names.includes(p.name) ? { ...p, completed: newCompleted } : p)
        );
        setSelected(prev => {
            if (!prev) return null;
            const prevNames = prev.names || [prev.name];
            return prevNames.some(n => names.includes(n)) ? { ...prev, completed: newCompleted } : prev;
        });

        try {
            await Promise.all(names.map(name =>
                api.patch(`/projects/${encodeURIComponent(name)}/complete`, { completed: newCompleted })
            ));
        } catch {
            /* Revert on failure */
            setProjects(prev =>
                prev.map(p => names.includes(p.name) ? { ...p, completed: !newCompleted } : p)
            );
            setSelected(prev => {
                if (!prev) return null;
                const prevNames = prev.names || [prev.name];
                return prevNames.some(n => names.includes(n)) ? { ...prev, completed: !newCompleted } : prev;
            });
        }
    };

    const deleteManual = async (project) => {
        if (!confirm(`Delete "${project.name}"? This cannot be undone.`)) return;
        try {
            await api.delete(`/projects/manual/${project._manualId}`);
            setProjects(prev => prev.filter(p => p._manualId !== project._manualId));
            setSelected(null);
        } catch (e) { console.error(e); }
    };

    /* Merge all projects for counts, then filter for display */
    const allMerged = groupAndMerge(projects);
    const visible   = allMerged.filter(p => {
        if (filter === 'in_progress' && p.completed)  return false;
        if (filter === 'completed'   && !p.completed) return false;
        if (search) {
            const q = search.toLowerCase();
            return (p.names || [p.name]).some(n => n.toLowerCase().includes(q))
                || (p.rfq || '').toLowerCase().includes(q);
        }
        return true;
    });

    return (
        <Layout>
            <div className="proj-page">
                <div className="proj-page-header">
                    <h1 className="page-title">Projects</h1>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    {user.role === 'admin' && (
                        <button className="btn btn-primary" onClick={() => setShowAddProject(true)}>
                            + Add Project
                        </button>
                    )}
                    <input
                        className="alarm-search"
                        placeholder="Search by name or RFQ#…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                    </div>
                </div>

                <div className="alarm-service-tabs" style={{ marginBottom: '24px' }}>
                    {FILTER_TABS.map(t => (
                        <button
                            key={t}
                            className={`alarm-tab ${filter === t ? 'active' : ''}`}
                            onClick={() => setFilter(t)}
                        >
                            {t === 'all' ? 'All' : t === 'in_progress' ? 'In Progress' : 'Completed'}
                            <span className="alarm-tab-count">
                                {t === 'all'         ? allMerged.length :
                                 t === 'in_progress' ? allMerged.filter(p => !p.completed).length :
                                                       allMerged.filter(p =>  p.completed).length}
                            </span>
                        </button>
                    ))}
                </div>

                {loading ? (
                    <div className="alarm-empty">Loading project reports…</div>
                ) : visible.length === 0 ? (
                    <div className="alarm-empty">No projects found.</div>
                ) : (
                    <div className="proj-grid">
                        {visible.map(p => (
                            <ProjectCard
                                key={p.names ? p.names.join('|') : p.name}
                                project={p}
                                onClick={() => setSelected(p)}
                                onComplete={markComplete}
                            />
                        ))}
                    </div>
                )}

                {selected && (
                    <ProjectDetail
                        project={selected}
                        onClose={() => setSelected(null)}
                        onComplete={markComplete}
                        onDelete={deleteManual}
                    />
                )}
                {showAddProject && (
                    <NewProjectModal
                        onClose={() => setShowAddProject(false)}
                        onCreated={() => {
                            setShowAddProject(false);
                            api.get('/projects').then(r => setProjects(r.data));
                        }}
                    />
                )}
            </div>
        </Layout>
    );
}
