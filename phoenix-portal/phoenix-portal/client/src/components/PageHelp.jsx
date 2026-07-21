import { useState } from 'react';
import './PageHelp.css';

/* Plain-language "how to use this page" content, kept central so every
   page just drops in <PageHelp id="..." />. Written for a brand-new hire. */
const HELP = {
    dashboard: {
        title: 'Dashboard',
        what: 'Your home screen — a quick read on what needs your attention and what is happening across the company.',
        steps: [
            'Check Reminders up top: red is overdue, yellow is due soon — click one to jump straight to it.',
            'Open the Board for company notices, and post one yourself.',
            'Scroll for the team leaderboard and, if you are the assigned driver, your vehicle’s weekly check.',
            'New here? Hit “Take a tour” for a guided walkthrough of everything you can access.',
        ],
        tip: 'The left menu only shows pages your role can use — so everything you see, you can open.',
    },
    tickets: {
        title: 'Tickets',
        what: 'Service tickets — the record of every work request and job for a client.',
        steps: [
            'Each row is one ticket. Use the status tabs (Open, In Progress, Resolved, Closed, Drafts) to filter.',
            'Office staff create and assign tickets; technicians work the ones assigned to them and set the status.',
            'Add a Scope of Work, schedule it, link a client, and list any inventory items used.',
            'Started one but not ready to finish? Click off the window and it is saved as a draft.',
        ],
        tip: 'When a ticket is marked Resolved or Closed, items flagged “used” are subtracted from inventory stock.',
    },
    calls: {
        title: 'Customer-Service Calls',
        what: 'A log of recent customer-service calls, pulled automatically from your Slack calls channel.',
        steps: [
            'Each row is a call — who it was about, the category, and who took it.',
            'Filter by category with the tabs to see just one kind.',
            'Admins set which Slack channel the calls come from, up top.',
        ],
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
    'team-calendar': {
        title: 'Team Calendar',
        what: 'The whole team’s schedule in a month grid — jobs, meetings, time off, and daily notes together.',
        steps: [
            'Click any day or item to see what is on. Scheduled tickets show up here automatically.',
            'Request time off, and admins approve or deny it from the same view.',
            'Add meetings and per-day notes so everyone is on the same page.',
        ],
        tip: 'Click a ticket on the calendar to edit it in place, or jump straight to it on the Tickets page.',
    },
    'tech-notes': {
        title: "Technician's Notes",
        what: 'The technicians’ reference shelf — how-tos, part numbers, procedures, and handy links in one place.',
        steps: [
            'Pick a section with the tabs across the top.',
            'Read through the notes; links open in a new tab.',
            'Admins can edit any section with the Edit button.',
        ],
    },
    clients: {
        title: 'Clients',
        what: 'Your customer hub — everything about each client in one place: alarm panel, cameras, tickets, billing, Slack, and site map.',
        steps: [
            'Search, or filter by service type (Alarm, Fire, Access, and so on). Install-only project clients have their own tab.',
            'Click a client to open their record, then use the inner tabs for the panel, tickets, cameras, and more.',
            'Admins can add a client with +, and rename one by clicking its name.',
            'Group a customer’s locations together with Multi-Location on the System tab.',
        ],
        tip: 'Set a client’s recurring bill on the Admin → Billing tab; it flows into Financials as recurring revenue.',
    },
    fleet: {
        title: 'Fleet',
        what: 'Your company vehicles and their paperwork — registration, tags, insurance, and who drives them.',
        steps: [
            'Each card is a vehicle. Click it for service notes, invoices, and the insurance card.',
            'Watch the tags-renewal date so registrations do not lapse.',
            'Admins add a vehicle or assign a driver; the assigned driver files a quick weekly check.',
        ],
    },
    inventory: {
        title: 'Inventory',
        what: 'Your parts and equipment stock — what is on hand and how much.',
        steps: [
            'Each row is an item with its current quantity and price.',
            'Search to find a part fast, or filter by category.',
            'Counts drop automatically when items are marked used on a completed ticket.',
        ],
    },
    licenses: {
        title: 'Licenses',
        what: 'Software and service licenses you pay for — seats in use versus owned, and when each renews.',
        steps: [
            'Each row is a license with a used / total seat count — bump it up or down as seats change.',
            'Renewal dates flag when something is coming due.',
            'License keys are hidden from non-admins.',
        ],
    },
    cameras: {
        title: 'Camera Systems',
        what: 'Your camera systems (NVRs). Connect to a DW Spectrum recorder and view its cameras.',
        steps: [
            'Each system lists its cameras with a live snapshot.',
            'Click a camera for a larger, auto-refreshing live view.',
            'Admins add a system with + Add System — Direct for on-site, or DW Cloud for a remote site.',
            'Link a system to a client and its cameras show on that client’s Cameras tab.',
        ],
    },
    financials: {
        title: 'Financials',
        what: 'The money view — what has been invoiced, paid, and is still owed, plus expenses and recurring revenue.',
        steps: [
            'The cards up top show totals at a glance: invoiced, paid, balance due, expenses, net, and MRR.',
            'The chart tracks income versus expenses over the last 12 months.',
            'Use the tabs for work orders, expenses, fleet costs, client billing, MRR, and inventory value.',
        ],
        tip: 'Billing data is imported from QuickBooks, so the invoice and payment figures mirror your books.',
    },
    snapshot: {
        title: 'Snapshot',
        what: 'Your quote and RFQ pipeline — what customers have requested, what is in progress, and what has been invoiced.',
        steps: [
            'Switch tabs to see in-progress work versus quoted / invoiced entries.',
            'Each row tracks the customer, RFQ, and notes.',
            'Accounting and admins add or edit entries with + Add Entry.',
        ],
    },
    timesheets: {
        title: 'Timesheets',
        what: 'Estimated hours per technician — on-site time from completed tickets plus round-trip travel.',
        steps: [
            'Pick a person and a date range to build their sheet.',
            'On-site comes from each ticket’s start and end; travel is an estimate of the round trip from the office.',
            'Totals are ready to hand to payroll. Accounting and admins only.',
        ],
    },
    ai: {
        title: 'AI Assistant',
        what: 'An AI helper you can ask questions in plain English about your clients, tickets, fleet, and more.',
        steps: [
            'Type a question and press send.',
            'It can summarize information or answer questions about your work.',
            'Treat its answers as a starting point — double-check anything important.',
        ],
    },
    messages: {
        title: 'Messages',
        what: 'Direct messages between you and your coworkers.',
        steps: [
            'Your conversations are on the left; click one to read it.',
            'Type in the box and send to reply.',
            'Unread messages show a count next to Messages in the menu.',
        ],
    },
    feedback: {
        title: 'Feedback',
        what: 'Tell the team what is working and what is not with this portal.',
        steps: [
            'Pick a category and write your feedback.',
            'Submit it — it goes straight to the team.',
            'Use it for bugs, ideas, or anything that would make the portal better.',
        ],
    },
    admin: {
        title: 'Admin',
        what: 'Admin controls — manage people and the settings that drive the rest of the portal.',
        steps: [
            'Add users, set their role and job title, and reset access.',
            'Set clients’ recurring billing on the Billing tab.',
            'Tune portal-wide settings. Admins only.',
        ],
    },
    vault: {
        title: 'Vault',
        what: 'A secure store for shared passwords and credentials — encrypted, and admin-only.',
        steps: [
            'Browse saved credentials by name.',
            'Reveal or copy a secret when you need it.',
            'Add a new credential with the button; values are encrypted at rest.',
        ],
        tip: 'Treat everything here as sensitive — only admins can open the Vault.',
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
