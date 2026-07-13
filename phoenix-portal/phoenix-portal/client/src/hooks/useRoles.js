import { useState, useEffect } from 'react';
import api from '../api/client';

/* Shared, session-cached lookup of every user's custom job title, so any list
   that shows people's names can badge them without its own fetch. One network
   call to /roles/people per session; mounted components re-render when it lands. */

const norm = s => String(s || '').trim().toLowerCase();

let cache    = null;   // { byId: Map<number, role|null>, byName: Map<string, role|null> }
let inflight = null;
const subs   = new Set();

function loadOnce() {
    if (cache || inflight) return;
    inflight = api.get('/roles/people')
        .then(r => {
            const byId = new Map(), byName = new Map();
            for (const p of r.data || []) {
                const role = p.job_role_name ? { name: p.job_role_name, color: p.job_role_color } : null;
                byId.set(p.id, role);
                if (p.name) byName.set(norm(p.name), role);
            }
            cache = { byId, byName };
        })
        .catch(() => { cache = { byId: new Map(), byName: new Map() }; })
        .finally(() => { inflight = null; subs.forEach(fn => fn()); });
}

export default function useRoles() {
    const [, bump] = useState(0);
    useEffect(() => {
        if (cache) return;                       // already loaded — no subscription needed
        const fn = () => bump(n => n + 1);
        subs.add(fn);
        loadOnce();
        return () => subs.delete(fn);
    }, []);
    return {
        roleFor:     id   => (cache && id != null ? cache.byId.get(id)     : null) || null,
        roleForName: name => (cache && name       ? cache.byName.get(norm(name)) : null) || null,
        ready:       !!cache,
    };
}
