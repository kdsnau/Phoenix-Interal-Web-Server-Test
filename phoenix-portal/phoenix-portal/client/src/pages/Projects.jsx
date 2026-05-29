import { useState, useEffect, useRef } from 'react';
import api from '../api/client';
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
   Project detail overlay — shows all visits for a project
   ----------------------------------------------------------------------- */
function ProjectDetail({ project, onClose, onComplete }) {
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
   Main Projects page
   ----------------------------------------------------------------------- */
const FILTER_TABS = ['all', 'in_progress', 'completed'];

export default function Projects() {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading]   = useState(true);
    const [filter, setFilter]     = useState('all');
    const [search, setSearch]     = useState('');
    const [selected, setSelected] = useState(null);

    useEffect(() => {
        api.get('/projects')
            .then(r => setProjects(r.data))
            .finally(() => setLoading(false));
    }, []);

    /* Keep the card list in the same order the server uses */
    const sortProjects = arr => [...arr].sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return b.lastVisit - a.lastVisit;
    });

    const markComplete = async (project, e) => {
        if (e) e.stopPropagation();
        const newCompleted = !project.completed;

        /* Optimistic update — re-sort so the card moves to the right section */
        setProjects(prev =>
            sortProjects(prev.map(p => p.name === project.name ? { ...p, completed: newCompleted } : p))
        );
        setSelected(prev =>
            prev?.name === project.name ? { ...prev, completed: newCompleted } : prev
        );

        try {
            await api.patch(`/projects/${encodeURIComponent(project.name)}/complete`, {
                completed: newCompleted,
            });
        } catch {
            /* Revert on failure */
            setProjects(prev =>
                sortProjects(prev.map(p => p.name === project.name ? { ...p, completed: !newCompleted } : p))
            );
            setSelected(prev =>
                prev?.name === project.name ? { ...prev, completed: !newCompleted } : prev
            );
        }
    };

    const visible = projects.filter(p => {
        if (filter === 'in_progress' && p.completed)  return false;
        if (filter === 'completed'   && !p.completed) return false;
        if (search) {
            const q = search.toLowerCase();
            return p.name.toLowerCase().includes(q)
                || (p.rfq || '').toLowerCase().includes(q);
        }
        return true;
    });

    return (
        <Layout>
            <div className="proj-page">
                <div className="proj-page-header">
                    <h1 className="page-title">Projects</h1>
                    <input
                        className="alarm-search"
                        placeholder="Search by name or RFQ#…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
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
                                {t === 'all'         ? projects.length :
                                 t === 'in_progress' ? projects.filter(p => !p.completed).length :
                                                       projects.filter(p =>  p.completed).length}
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
                                key={p.name}
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
                    />
                )}
            </div>
        </Layout>
    );
}
