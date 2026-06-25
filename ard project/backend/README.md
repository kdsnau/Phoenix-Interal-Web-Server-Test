# Phoenix Door — Backend

Node/Express + Postgres. The brain of the NFC door-access system: users,
credentials, doors, the rule engine, scan logging, and the reader API.

## Setup

```bash
npm install
cp .env.example .env          # then edit: DATABASE_URL, JWT_SECRET, SEED_ADMIN_PASSWORD
npm run migrate               # apply db/schema.sql
npm run seed-admin            # create the first admin from .env
npm run dev                   # http://localhost:4000
```

PostgreSQL 18 is already installed on this machine (service `postgresql-x64-18`).
Create a database and point `DATABASE_URL` at it, e.g.:

```
DATABASE_URL=postgres://postgres:<password>@localhost:5432/phx_door
```

(create the db once: `createdb phx_door`, or
`psql -U postgres -c "CREATE DATABASE phx_door;"`)

## Tests

```bash
npm test          # node --test: rule engine, tokens, reader signature (no DB needed)
```

## API surface

Auth (JWT, `admin`/`user`):
- `POST /api/auth/login` → `{ token, user }`
- `GET  /api/auth/me`

Admin (role `admin`):
- `GET/POST/PATCH/DELETE /api/users`, `PUT /api/users/:id/groups`
- `POST /api/credentials/card` · `POST /api/credentials/phone` · `POST /api/credentials/:id/revoke`
- `GET/POST/PATCH/DELETE /api/doors` (POST returns a one-time `reader_key`)
- `GET/POST/DELETE /api/groups`
- `GET/POST/PATCH/DELETE /api/rules`
- `GET /api/scans` · `GET /api/scans/summary` (Activity dashboard)

Mobile (the signed-in user):
- `GET /api/me/credential` · `POST /api/me/token` (rotating HCE token) · `GET /api/me/events`

Reader (per-door HMAC, **no JWT** — see `src/middleware/readerHmac.js`):
- `POST /api/reader/validate` → `{ decision, reason, unlock_ms }`
- `GET  /api/reader/sync` → offline cache bundle
- `POST /api/reader/events` → backfill offline decisions

## Reader authentication (no TLS needed)

The Arduino can't do HTTPS, so each reader signs requests with its door's
`reader_key`:

```
X-Reader-Id, X-Reader-Timestamp, X-Reader-Signature =
    HMAC-SHA256(reader_key, "METHOD\nPATH\nTIMESTAMP\nBODY")
```

The timestamp is inside the signed string and must be fresh (±60 s), so captures
can't be replayed. The canonical format lives in `src/util/readerSig.js` and is
mirrored by the firmware.

## Reader simulator (no hardware)

`tools/reader-sim.js` signs/sends exactly like the firmware:

```bash
node tools/reader-sim.js sync     --id 1 --key <reader_key>
node tools/reader-sim.js validate --id 1 --key <reader_key> --uid 04A1B2C3
node tools/reader-sim.js validate --id 1 --key <reader_key> --token <phone_token>
```

## Rule engine semantics

`src/services/ruleEngine.js` — default-deny, deny-overrides-allow.
- `door_access` rules: WHO may use a door (allow/deny), no time component.
- `time_window` rules: WHEN; `allow` grants only inside the window, `deny` blocks
  inside it. `days_mask` bit i = JS `getDay()` (0=Sun..6=Sat); supports overnight
  windows (e.g. 22:00–06:00).
