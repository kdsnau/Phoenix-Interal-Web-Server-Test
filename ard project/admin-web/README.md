# Phoenix Door — Admin Dashboard

React + Vite admin UI for the door system. Talks to the backend API.

## Run

```bash
npm install
npm run dev      # http://localhost:5173  (proxies /api -> http://localhost:4000)
```

The dev server proxies `/api` to the backend (see `vite.config.js`), so start the
backend first (`cd ../backend && npm run dev`). Log in with the seeded admin.

```bash
npm run build    # production bundle in dist/
```

## Pages

- **Activity** — scan-usage dashboard: granted/denied/24h/doors stat cards, scans
  per door, a 14-day granted-vs-denied chart, and a live (5s) recent-scans table.
- **Users** — list/add/delete users, role, active toggle; per-user credential and
  group counts. "Manage" opens the user detail page.
- **User detail** — assign UID cards, issue phone credentials (shows the one-time
  `token_key`), revoke credentials, set group membership, activate/deactivate.
- **Doors** — register a door (reveals the one-time `reader_key` to flash into the
  firmware), online/offline status, unlock time, fail policy, rotate key, delete.
- **Rules** — visual builder for `door_access` (who) and `time_window` (when, with
  day toggles + start/end) rules, scoped to everyone/user/group and a door or all
  doors; each rule gets a plain-English summary. Default-deny, deny-overrides.
- **Groups** — create/delete groups; membership is set per-user.

## Notes

- Auth is JWT in `localStorage`; the dashboard requires the `admin` role.
- Only admins can sign in here (a non-admin login is rejected client-side and the
  API gates every admin route with `requireRole('admin')`).
