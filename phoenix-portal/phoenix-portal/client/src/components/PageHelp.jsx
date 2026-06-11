import { useState } from 'react';
import './PageHelp.css';

/* Plain-language "how to use this page" content, kept central so every
   page just drops in <PageHelp id="..." />. Written for a brand-new hire. */
const HELP = {
    dashboard: {
        title: 'Dashboard',
        what: 'Your home screen — a quick snapshot of what is going on across the company.',
        steps: [
            'Glance at the numbers up top for tickets, revenue, and the team.',
            'Scroll down for recent activity and anything that needs attention.',
            'Use the menu on the left to jump to any other page.',
        ],
    },
    tickets: {
        title: 'Tickets',
        what: 'Service tickets — the record of work requests and jobs for clients.',
        steps: [
            'Each row is one ticket. Click it to open the details.',
            'Use the search box to find a ticket by client or title.',
            'Office staff create and edit tickets; technicians work the ones assigned to them and mark them complete.',
        ],
        tip: 'When a ticket is marked complete, any inventory items used on it are subtracted from stock.',
    },
    projects: {
        title: 'Projects',
        what: 'Bigger installation jobs — pulled from Slack submissions, plus any you add by hand.',
        steps: [
            'Each card is a project. Open one to see its details and notes.',
            'Finished projects are marked done; the rest are still in progress.',
            'Add a project manually with the button if it did not come from Slack.',
        ],
    },
    calendar: {
        title: 'Calendar',
        what: 'Everything that is scheduled — tickets with a date on them, laid out by when they are due.',
        steps: [
            'Items are sorted by date, soonest first.',
            'The colored tag tells you if something is today, tomorrow, or further out.',
            'Press Sync to pull in the latest scheduled tickets.',
        ],
    },
    clients: {
        title: 'Clients',
        what: 'Your customer hub — everything about each client in one place: their alarm panel, cameras, contract, tickets, and billing.',
        steps: [
            'Click a client to open their full record.',
            'Use the tabs inside to see the panel, contract, tickets, and billing.',
            'Search, or filter by service type (alarm, fire, and so on) up top.',
            'Admins can add a client with the + button.',
        ],
    },
    fleet: {
        title: 'Fleet',
        what: 'Your company vehicles and their paperwork — registration, tags, insurance, and who drives them.',
        steps: [
            'Each card is a vehicle. Click it for service notes, invoices, and the insurance card.',
            'Watch the tags-renewal date so registrations do not lapse.',
            'Admins can add a vehicle or assign a driver.',
        ],
    },
    inventory: {
        title: 'Inventory',
        what: 'Your parts and equipment stock — what you have on hand and how much.',
        steps: [
            'Each row is an item with its current quantity.',
            'Search to find a part fast.',
            'Update the count when stock comes in or goes out.',
        ],
    },
    cameras: {
        title: 'Camera Systems',
        what: 'Your camera systems (NVRs). Connect to a DW Spectrum recorder and view its cameras.',
        steps: [
            'Each system lists its cameras with a live snapshot.',
            'Click a camera for a larger, auto-refreshing live view.',
            'Admins add a system with + Add System — Direct for on-site, or DW Cloud for a remote site.',
        ],
    },
    financials: {
        title: 'Financials',
        what: 'The money view — income coming in and expenses going out.',
        steps: [
            'The numbers up top show totals at a glance.',
            'Browse the lists for individual transactions.',
            'Use it to keep an eye on the company cash flow.',
        ],
    },
    ai: {
        title: 'AI Assistant',
        what: 'An AI helper you can ask questions in plain English.',
        steps: [
            'Type a question and press send.',
            'It can summarize information or answer questions about your work.',
            'Treat its answers as a starting point — double-check anything important.',
        ],
    },
    messages: {
        title: 'Messages',
        what: 'Internal messages between you and your coworkers.',
        steps: [
            'Your inbox is on the left; click a conversation to read it.',
            'Type in the box and send to reply.',
            'Unread messages are highlighted.',
        ],
    },
    feedback: {
        title: 'Feedback',
        what: 'Tell the team what is working and what is not with this portal.',
        steps: [
            'Write your feedback in the box.',
            'Submit it — it goes straight to the team.',
            'Use it for bugs, ideas, or anything that would make the portal better.',
        ],
    },
    admin: {
        title: 'Admin',
        what: 'Admin controls — manage who can log in and what they can do.',
        steps: [
            'See the list of users and their roles.',
            'Add a user or change someone’s role.',
            'Only admins can see this page.',
        ],
    },
    compliance: {
        title: 'Compliance & Renewals',
        what: 'A running list of things coming due — inspections, permits, contracts, and vehicle tags — so nothing slips.',
        steps: [
            'Pick a time window (30 / 60 / 90 days, or All) up top.',
            'Red means overdue, yellow means due soon.',
            'Click any row to jump to that client or vehicle.',
        ],
    },
};

export default function PageHelp({ id }) {
    const [open, setOpen] = useState(false);
    const help = HELP[id];
    if (!help) return null;

    return (
        <>
            <button
                type="button"
                className="page-help-btn"
                onClick={() => setOpen(true)}
                title="How to use this page"
                aria-label="How to use this page"
            >?</button>

            {open && (
                <div className="modal-overlay" onClick={() => setOpen(false)}>
                    <div className="help-modal" onClick={e => e.stopPropagation()}>
                        <div className="help-modal-head">
                            <span className="help-modal-title">{help.title} — how to use this page</span>
                            <button className="help-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
                        </div>
                        <p className="help-what">{help.what}</p>
                        <ol className="help-steps">
                            {help.steps.map((s, i) => <li key={i}>{s}</li>)}
                        </ol>
                        {help.tip && <p className="help-tip">Tip: {help.tip}</p>}
                    </div>
                </div>
            )}
        </>
    );
}
