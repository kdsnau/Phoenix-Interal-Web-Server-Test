# Phoenix Portal — Security & Code Review

Automated review (Kimi / Moonshot `kimi-k2.7-code`) of the Express server and React
client, orchestrated in three batches: (1) auth/security core, (2) sensitive +
dynamic-query routes, (3) the large money/PII routes (`clients.js`, `financials.js`).

**Good baseline:** no SQL injection found — 426/445 queries are parameterized; the
19 with `${…}` use constant fragments or whitelisted column identifiers. No
mass-assignment (patch helpers use allowlists).

Status legend: ☐ open · ☑ fixed (see commit) · ➖ deferred (needs larger change)

## Fixed in this pass (branch `testing`)
- ☑ `admin.js GET /alerts` now `requireRole('admin','accounting')`.
- ☑ `admin.js PATCH /users/:id/role` — self-demote + last-admin guards.
- ☑ `ai.js POST /query` now `requireRole('admin','accounting')`; question type-checked + capped at 2000 chars (limits prompt-injection blast radius).
- ☑ `clients.js PATCH /:id` (client record incl. billing) now `requireRole('admin','accounting')`.
- ☑ `messages.js POST /` — `to_id` integer + `body` string/≤5000 (a non-string body previously 500'd).
- ☑ `index.js` — `Content-Security-Policy` added; `express.json({limit:'2mb'})`; CORS rejects `null`/absent origin; unknown `/api/*` → JSON 404 (not SPA HTML).
- Verified: technician (Mia) gets 403 on the gated routes; admin unaffected.

### Deferred (need a larger/riskier change — tracked, not done)
- ➖ **Financial integrity** (WO payment reversal, invoice↔payment linkage, stock/payment race conditions) — needs careful transactional rework; do as a focused change with tests.
- ➖ **`/uploads` auth** — files load via `<img>`/`<a>` (no Bearer header possible); needs cookie or signed-URL auth. On the demo it's already behind the PORTAL_GATE.
- ➖ **Token revocation** (`token_version` column) and **JWT→HttpOnly cookie** — auth-flow changes (DB migration + client rewrite).
- ➖ **NUMERIC-as-float**, **license_key encryption**, **global API rate-limit**, **schedule date validation**, general staff-to-staff IDOR (acceptable for an internal LAN tool).

## Critical / High
- ☐ **Authorization gaps / IDOR** — several `clients.js` routes (`GET /:id`, posts,
  tickets, site-map download), `ai.js POST /query`, `admin.js GET /alerts` use only
  `authenticate`. Non-admin/technician can read client PII, billing, AI data snapshot.
- ☐ **Financial integrity** (`financials.js`): WO payments not reversed on
  reopen/delete (revenue inflated); payments not linked to invoices (stale
  `balance_due`/`paid_amount`); race conditions in stock deduction + payment creation.
- ☐ **`/uploads` unauthenticated** — uploaded docs/site-maps reachable by URL.
  (Note: served to `<img>` tags, which can't send a Bearer header — needs
  cookie/signed-URL auth, not naive middleware.)
- ☐ **No token revocation** — password change / role change / disabled user doesn't
  invalidate existing 8h JWTs.
- ☐ **AI prompt injection** (`ai.js`) — user question + DB strings concatenated raw
  into the LLM prompt.

## Medium
- ☐ Money via JS `Number` (float) → `NUMERIC` columns (rounding); no CHECK constraints.
- ☐ JWT + role in `localStorage` (XSS exfiltration); client route-guards trust
  tamperable `localStorage.user`.
- ☐ No global API rate limit (only login + gate); no CSP header; `express.json()`
  has no size limit.
- ☐ `license_key` stored/returned plaintext; admin can demote the last admin;
  no self-demote guard.
- ☐ Missing input validation: `messages` body/`to_id`, `schedule` date ordering,
  `clients` bulk-billing amounts.

## Low
- ☐ CORS allows `null` origin.
- ☐ Unknown `/api/*` paths return `index.html` (HTTP 200) instead of JSON 404.
- ☐ Rate-limiter is per-process (bypassable under clustering).
- ☐ Minor info disclosure: `messages GET /users` returns email/role; `vault
  GET /status` reveals key presence.

---
_Findings are Kimi's; severities reflect a public-internet threat model. For a
LAN-only internal tool some drop a level. Fixes tracked in git on `testing`._
