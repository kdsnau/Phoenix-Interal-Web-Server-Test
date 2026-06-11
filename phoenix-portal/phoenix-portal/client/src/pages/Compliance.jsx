import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import Layout from '../components/Layout';
import PageHelp from '../components/PageHelp';
import './Compliance.css';

/* What each renewal category looks like in the UI */
const CATEGORY_META = {
    inspection:   { label: 'Inspection',   tag: 'tag-blue'   },
    permit:       { label: 'Permit',       tag: 'tag-yellow' },
    contract:     { label: 'Contract',     tag: 'tag-green'  },
    vehicle_tags: { label: 'Vehicle Tags', tag: 'tag-dim'    },
};

/* Look-ahead windows. key 0 = no upper bound ("All") */
const WINDOWS = [
    { key: 30, label: 'Next 30 days' },
    { key: 60, label: 'Next 60 days' },
    { key: 90, label: 'Next 90 days' },
    { key: 0,  label: 'All' },
];

function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
    });
}

/* Status badge derived from days-until (negative = overdue) */
function statusFor(days) {
    if (days < 0)   return { tag: 'tag-red',    label: `${Math.abs(days)}d overdue` };
    if (days === 0) return { tag: 'tag-red',    label: 'Due today' };
    if (days <= 30) return { tag: 'tag-yellow', label: `${days}d` };
    return            { tag: 'tag-blue',   label: `${days}d` };
}

export default function Compliance() {
    const navigate = useNavigate();
    const [items,   setItems]   = useState([]);
    const [loading, setLoading] = useState(true);
    const [range,   setRange]   = useState(90);   // selected look-ahead window
    const [cat,     setCat]     = useState('all');

    useEffect(() => {
        setLoading(true);
        api.get('/compliance/renewals')
            .then(r => setItems(Array.isArray(r.data) ? r.data : []))
            .catch(() => setItems([]))
            .finally(() => setLoading(false));
    }, []);

    /* Apply the time window (overdue items always pass when range > 0) */
    const windowed = useMemo(
        () => items.filter(it => range === 0 || it.days_until <= range),
        [items, range]
    );

    /* Then apply the category chip */
    const filtered = useMemo(
        () => windowed.filter(it => cat === 'all' || it.category === cat),
        [windowed, cat]
    );

    const counts = useMemo(() => ({
        overdue:  windowed.filter(it => it.days_until < 0).length,
        dueSoon:  windowed.filter(it => it.days_until >= 0 && it.days_until <= 30).length,
        upcoming: windowed.filter(it => it.days_until > 30).length,
    }), [windowed]);

    const catCounts = useMemo(() => {
        const m = { all: windowed.length };
        for (const k of Object.keys(CATEGORY_META)) {
            m[k] = windowed.filter(it => it.category === k).length;
        }
        return m;
    }, [windowed]);

    function openItem(it) {
        navigate(it.link_type === 'vehicle' ? '/fleet' : '/clients');
    }

    return (
        <Layout>
            <div className="comp-page">
                <div className="comp-header">
                    <h1 className="page-title">Compliance &amp; Renewals<PageHelp id="compliance" /></h1>
                    <div className="comp-windows">
                        {WINDOWS.map(w => (
                            <button
                                key={w.key}
                                className={`comp-window ${range === w.key ? 'active' : ''}`}
                                onClick={() => setRange(w.key)}
                            >
                                {w.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Summary cards */}
                <div className="comp-summary">
                    <div className="comp-stat comp-stat--overdue">
                        <div className="comp-stat-num">{counts.overdue}</div>
                        <div className="comp-stat-label">Overdue</div>
                    </div>
                    <div className="comp-stat comp-stat--soon">
                        <div className="comp-stat-num">{counts.dueSoon}</div>
                        <div className="comp-stat-label">Due in 30 days</div>
                    </div>
                    <div className="comp-stat comp-stat--upcoming">
                        <div className="comp-stat-num">{counts.upcoming}</div>
                        <div className="comp-stat-label">Upcoming</div>
                    </div>
                </div>

                {/* Category filter */}
                <div className="comp-cats">
                    <button
                        className={`comp-cat ${cat === 'all' ? 'active' : ''}`}
                        onClick={() => setCat('all')}
                    >
                        All <span className="comp-cat-count">{catCounts.all}</span>
                    </button>
                    {Object.entries(CATEGORY_META).map(([k, meta]) => (
                        <button
                            key={k}
                            className={`comp-cat ${cat === k ? 'active' : ''}`}
                            onClick={() => setCat(k)}
                        >
                            {meta.label} <span className="comp-cat-count">{catCounts[k]}</span>
                        </button>
                    ))}
                </div>

                {/* List */}
                {loading ? (
                    <div className="comp-empty">Loading…</div>
                ) : filtered.length === 0 ? (
                    <div className="comp-empty">Nothing coming due in this window.</div>
                ) : (
                    <div className="comp-list">
                        {filtered.map((it, i) => {
                            const st   = statusFor(it.days_until);
                            const meta = CATEGORY_META[it.category] || { label: it.category, tag: 'tag-dim' };
                            return (
                                <button
                                    key={`${it.category}-${it.link_id}-${i}`}
                                    className="comp-row"
                                    onClick={() => openItem(it)}
                                    title={`Open in ${it.link_type === 'vehicle' ? 'Fleet' : 'Clients'}`}
                                >
                                    <span className={`tag ${st.tag} comp-status`}>{st.label}</span>
                                    <span className={`tag ${meta.tag} comp-cat-tag`}>{meta.label}</span>
                                    <div className="comp-main">
                                        <span className="comp-entity">{it.entity}</span>
                                        <span className="comp-detail">
                                            {it.title}{it.detail ? ` · ${it.detail}` : ''}
                                        </span>
                                    </div>
                                    <span className="comp-date">{fmtDate(it.due_date)}</span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </Layout>
    );
}
