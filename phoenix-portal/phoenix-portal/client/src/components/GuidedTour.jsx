import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import './GuidedTour.css';

/* A dependency-free, Canvas-style guided tour.
   Props:
     steps  — [{ selector?, title, body }]. A step with no selector (or whose
              target isn't on screen, e.g. the sidebar on mobile) shows a
              centered card with no spotlight.
     onClose — called when the user finishes or skips.  */
const PAD = 8;   // breathing room around the spotlight

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export default function GuidedTour({ steps, onClose }) {
    const [i, setI]       = useState(0);
    const [hole, setHole] = useState(null);   // {top,left,width,height} in viewport px, or null
    const [card, setCard] = useState({ top: 0, left: 0 });
    const cardRef = useRef(null);
    const step = steps[i] || {};
    const last = i === steps.length - 1;

    /* Locate the current step's target (if any) and whether it's actually visible. */
    const measure = useCallback(() => {
        const el = step.selector && document.querySelector(step.selector);
        if (el) {
            const r = el.getBoundingClientRect();
            const vw = window.innerWidth, vh = window.innerHeight;
            const onScreen = r.width > 0 && r.height > 0 && r.right > 4 && r.left < vw - 4 && r.bottom > 4 && r.top < vh - 4;
            if (onScreen) { setHole({ top: r.top, left: r.left, width: r.width, height: r.height }); return; }
        }
        setHole(null);
    }, [step.selector]);

    /* On step change: bring the target into view, then measure (again after the
       smooth scroll settles). */
    useEffect(() => {
        const el = step.selector && document.querySelector(step.selector);
        if (el) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        measure();
        const t = setTimeout(measure, 300);
        return () => clearTimeout(t);
    }, [i, measure, step.selector]);

    /* Keep the spotlight glued to the target through resizes / scrolls. */
    useEffect(() => {
        const on = () => measure();
        window.addEventListener('resize', on);
        window.addEventListener('scroll', on, true);
        return () => { window.removeEventListener('resize', on); window.removeEventListener('scroll', on, true); };
    }, [measure]);

    /* Lock body scroll while the tour is up. */
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, []);

    /* Place the card near the target: to the side for narrow (sidebar) targets,
       otherwise below, otherwise above; centered when there's no spotlight. */
    useLayoutEffect(() => {
        const cw = cardRef.current?.offsetWidth  || 340;
        const ch = cardRef.current?.offsetHeight || 190;
        const vw = window.innerWidth, vh = window.innerHeight, M = 14;
        if (!hole) { setCard({ top: clamp((vh - ch) / 2, M, vh - ch - M), left: clamp((vw - cw) / 2, M, vw - cw - M) }); return; }
        const right = hole.left + hole.width, bottom = hole.top + hole.height;
        let top, left;
        if (hole.width < 340 && right + cw + M + PAD < vw) {          // room to the right (sidebar case)
            left = right + M + PAD;
            top  = clamp(hole.top + hole.height / 2 - ch / 2, M, vh - ch - M);
        } else if (bottom + ch + M + PAD < vh) {                      // below
            top  = bottom + M + PAD;
            left = clamp(hole.left + hole.width / 2 - cw / 2, M, vw - cw - M);
        } else {                                                      // above
            top  = clamp(hole.top - ch - M - PAD, M, vh - ch - M);
            left = clamp(hole.left + hole.width / 2 - cw / 2, M, vw - cw - M);
        }
        setCard({ top, left });
    }, [hole, i]);

    const next   = useCallback(() => (last ? onClose() : setI(n => n + 1)), [last, onClose]);
    const prev   = useCallback(() => setI(n => Math.max(0, n - 1)), []);

    /* Keyboard: →/Enter next, ← back, Esc close. */
    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowRight' || e.key === 'Enter') next();
            else if (e.key === 'ArrowLeft') prev();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [next, prev, onClose]);

    const frame = hole && {
        top:   Math.max(0, hole.top - PAD),
        left:  Math.max(0, hole.left - PAD),
        width:  hole.width + PAD * 2,
        height: hole.height + PAD * 2,
    };

    return (
        <div className="tour-root" role="dialog" aria-modal="true" aria-label="Guided tour">
            {frame ? (
                <>
                    <div className="tour-mask" style={{ top: 0, left: 0, width: '100vw', height: frame.top }} />
                    <div className="tour-mask" style={{ top: frame.top + frame.height, left: 0, width: '100vw', height: `calc(100vh - ${frame.top + frame.height}px)` }} />
                    <div className="tour-mask" style={{ top: frame.top, left: 0, width: frame.left, height: frame.height }} />
                    <div className="tour-mask" style={{ top: frame.top, left: frame.left + frame.width, width: `calc(100vw - ${frame.left + frame.width}px)`, height: frame.height }} />
                    <div className="tour-hole-block" style={{ top: frame.top, left: frame.left, width: frame.width, height: frame.height }} />
                    <div className="tour-ring" style={{ top: frame.top, left: frame.left, width: frame.width, height: frame.height }} />
                </>
            ) : (
                <div className="tour-mask tour-mask--full" />
            )}

            <div ref={cardRef} className="tour-card" style={{ top: card.top, left: card.left }}>
                <div className="tour-step-count">{i + 1} / {steps.length}</div>
                <div className="tour-card-title">{step.title}</div>
                <div className="tour-card-body">{step.body}</div>
                <div className="tour-card-actions">
                    <button className="tour-skip" onClick={onClose}>{last ? '' : 'Skip tour'}</button>
                    <div className="tour-nav-btns">
                        {i > 0 && <button className="btn btn-ghost tour-btn" onClick={prev}>Back</button>}
                        <button className="btn btn-primary tour-btn" onClick={next}>{last ? 'Finish' : 'Next'}</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
