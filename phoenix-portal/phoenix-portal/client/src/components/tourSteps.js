import { NAV } from './Layout';

/* One-line "what is this" for every menu destination. The tour walks the
   signed-in user through exactly the items their role can see (NAV[role]), so
   this stays in step with the real menu automatically. */
const PATH_COPY = {
    '/dashboard':     { title: 'Dashboard',        body: "Your home screen — reminders that need attention, team activity, and quick stats. You're on it right now." },
    '/tickets':       { title: 'Tickets',          body: "The record of every job. Create one, assign techs, and track it from open to closed. Unfinished tickets auto-save as drafts." },
    '/calls':         { title: 'Calls',            body: "A running log of recent customer-service calls pulled from Slack — who called, why, and who took it." },
    '/projects':      { title: 'Projects',         body: "Bigger installation jobs, pulled from Slack submissions plus any you add by hand. Open a card for its details." },
    '/team-calendar': { title: 'Team Calendar',    body: "The whole team's month at a glance: scheduled jobs, meetings, time off, and daily notes. Request time off here too." },
    '/tech-notes':    { title: "Technician's Notes", body: "The techs' reference shelf — how-tos, part numbers, and procedures kept in one place." },
    '/clients':       { title: 'Clients',          body: "Every customer in one place: their panel, cameras, tickets, billing, Slack, and site map. Filter by service type up top." },
    '/fleet':         { title: 'Fleet',            body: "Company vehicles and their paperwork — registration, insurance, service notes, and who drives each one." },
    '/inventory':     { title: 'Inventory',        body: "Parts and equipment stock — what's on hand and how much. Items used on a ticket come off the count automatically." },
    '/licenses':      { title: 'Licenses',         body: "Software and service licenses — seats in use versus owned, and renewal dates so nothing lapses." },
    '/cameras':       { title: 'Cameras',          body: "Connect to your DW Spectrum recorders and view live camera snapshots, on-site or remote." },
    '/financials':    { title: 'Financials',       body: "The money view — what's invoiced, paid, and owed, plus expenses, recurring revenue, and reports." },
    '/snapshot':      { title: 'Snapshot',         body: "The quote and RFQ pipeline — what's been requested, what's in progress, and what's been invoiced." },
    '/timesheets':    { title: 'Timesheets',       body: "Estimated hours per tech — on-site time from completed tickets plus round-trip travel, ready for payroll." },
    '/ai':            { title: 'AI Assistant',     body: "Ask questions about your clients, tickets, or fleet in plain English and get a quick answer." },
    '/messages':      { title: 'Messages',         body: "Direct messages between you and your coworkers — your unread count shows next to Messages." },
    '/feedback':      { title: 'Feedback',         body: "Tell the team what's working and what isn't with this portal. Bugs, ideas, anything." },
    '/admin':         { title: 'Admin',            body: "Manage who can log in, their roles and job titles, recurring billing, and portal settings." },
    '/vault':         { title: 'Vault',            body: "A secure store for shared passwords and credentials — encrypted, and admin-only." },
};

const ROLE_NAME = { technician: 'a technician', accounting: 'accounting', admin: 'an admin' };

/* Build the ordered step list for a role. Sidebar links are targeted by their
   href so the spotlight lands on the exact menu item. */
export function buildTourSteps(role) {
    const who = ROLE_NAME[role] || 'your role';
    const steps = [
        { title: 'Welcome to the Phoenix portal 👋', body: `A quick tour of what you can do here as ${who}. Use Next and Back — or press Esc to leave anytime.` },
        { selector: '.sidebar-brand', title: 'The main menu', body: "Everything you have access to lives in this left-hand menu. We'll walk through it, top to bottom." },
    ];

    for (const item of (NAV[role] || [])) {
        if (!item.path || !PATH_COPY[item.path]) continue;
        steps.push({ selector: `.sidebar-nav a[href="${item.path}"]`, ...PATH_COPY[item.path] });
    }

    steps.push({ selector: '.page-help-btn', title: 'Need a refresher?', body: 'Most pages have a “?” next to the title. Click it any time for a short how-to just for that page.' });
    steps.push({ selector: '.sidebar-footer', title: 'Your account', body: 'Your name and role sit here. Change your password or log out from these buttons.' });
    steps.push({ title: "You're all set 🎉", body: 'That’s the whirlwind tour. You can replay it any time from “Take a tour” on the Dashboard.' });
    return steps;
}
