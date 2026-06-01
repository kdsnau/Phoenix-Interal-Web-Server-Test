# Phoenix Security & Technology — Internal Portal

Role-gated internal web portal for Phoenix Security & Technology.  
Covers fleet management, service tickets, financials, client monitoring, inventory, and project tracking — all in one place.  
Self-hosted on a dedicated Ubuntu server on the company LAN, accessible at `http://phxportal.internal` from any device on the office Wi-Fi.

---

## Table of Contents

1. [Roles & Access](#roles--access)
2. [Stack](#stack)
3. [Features](#features)
4. [Project Structure](#project-structure)
5. [Local Development](#local-development)
6. [Production Server](#production-server)
7. [Deploy Workflow](#deploy-workflow)
8. [Environment Variables](#environment-variables)
9. [Database Setup](#database-setup)
10. [Slack Integration Setup](#slack-integration-setup)
11. [API Reference](#api-reference)
12. [Troubleshooting](#troubleshooting)

---

## Roles & Access

| Page        | Technician                       | Accounting              | Admin       |
|-------------|----------------------------------|-------------------------|-------------|
| Dashboard   | ✅ own tickets + alerts          | ✅ financials + alerts  | ✅ full     |
| Tickets     | ✅ own / assigned                | ❌                      | ✅ all      |
| Financials  | ❌                               | ✅                      | ✅          |
| Alarms      | ✅ system / tickets / slack      | ✅ + billing / permits  | ✅ all      |
| Fleet       | ✅                               | ✅                      | ✅          |
| Inventory   | ✅ adjust qty                    | ✅ add / edit           | ✅ full     |
| Projects    | ✅                               | ✅                      | ✅          |
| Admin       | ❌                               | ❌                      | ✅          |

---

## Stack

| Layer        | Technology                                              |
|--------------|---------------------------------------------------------|
| Frontend     | React 19 + Vite 8 (build served by Express)             |
| Backend      | Node.js + Express 5                                     |
| Database     | PostgreSQL                                              |
| Auth         | JWT + bcryptjs                                          |
| Email        | Nodemailer (Gmail SMTP)                                 |
| Slack        | @slack/web-api (fleet check-ins, alarms, projects)      |
| Scheduling   | node-cron (weekly monitoring emails, daily at 8 AM)     |
| Process mgr  | PM2                                                     |
| Reverse proxy| nginx                                                   |

> **Node.js version requirement:** Vite 8 requires Node.js **20.19+ or 22.12+**. The production server runs Node 22.x. Always build from an environment that meets this requirement.

---

## Features

### Dashboard
Role-specific overview with three live alert panels visible to all roles:
- **Open vehicle maintenance issues** — lists each vehicle with unresolved notes and issue count
- **Permits expiring within 60 days** — color-coded by urgency (yellow → red → expired)
- **Vehicle tags expiring within 30 days**
- MRR stat card for admin and accounting roles

### Alarms
Full client monitoring management:
- Client list filterable by service type (alarm, fire, access control)
- **Permits tab** — tabular report of all clients sorted by permit expiry date, color-coded by status (valid / expiring / expired / no data)
- Per-client detail panel with tabs:
  - **System** — system type, vendor, serial, connection, carrier, monitoring toggle, permit number & expiry, notes
  - **Tickets** — create and view service tickets for the client
  - **Slack** — alarm dispatch feed filtered to this client's account number
  - **Billing** *(accounting / admin)* — set monthly billing amount
  - **Transactions** *(accounting / admin)* — invoice / payment / expense ledger
- Monitoring toggle applies instantly (optimistic UI, syncs in background)
- Permit expiry warnings appear on client cards automatically within 60 days

### Fleet
Vehicle management for the active fleet:
- Vehicle cards show open maintenance issue count and tags renewal status
- Per-vehicle detail panel:
  - **Vehicle Info** — editable mileage, registration, tags renewal date
  - **Notifications** — send service reminder or tags renewal emails to admin + accounting
  - **Insurance** — document viewer (upload to `server/uploads/` to display)
  - **Notes** — maintenance notes with category (service / repair / misc), resolve/reopen with timestamp, "Show resolved" toggle, open issue count in section header
  - **Invoices** — repair/maintenance invoice log with running total
  - **Slack Feed** — messages from the fleet channel mentioning this vehicle

### Projects
Pulls project visit reports from the designated Slack channel:
- **Fuzzy name merging** — projects with similar names (e.g. "The Pharm", "PHARM DC", "The Pharm DC") collapse into one card with all visit history combined
- Each merged visit shows **"Reported as"** — the original job name written in the Slack post
- Completion status driven by the most recent Slack entry (not any historical entry)
- Manual complete / reopen override stored in DB, persists across Slack changes
- In-progress projects sort before completed; related projects group together

### Financials *(accounting / admin)*
- MRR calculated live from client billing amounts
- Monthly income / expense / fleet spend chart (12-month rolling window)
- Client transaction ledger
- Fleet invoice totals

### Tickets
- Create and assign service tickets to technicians
- Status workflow: open → in_progress → resolved → closed
- Can be created from within a client's Alarms detail panel

### Inventory
Inventory record management with quantity tracking.

### Admin *(admin only)*
- **Users tab** — create accounts, change roles, delete users
- **Billing tab** — inline editable billing amount for every monitoring client in one table; only changed rows are sent on save; supports bulk import when updated billing data arrives

---

## Project Structure

```
phoenix-portal/
├── client/                    # React SPA (Vite)
│   ├── src/
│   │   ├── pages/             # Dashboard, Alarms, Fleet, Projects, Financials,
│   │   │                      # Tickets, Inventory, Admin, Login
│   │   ├── components/        # Layout (sidebar + nav), shared UI
│   │   ├── context/           # AuthContext — JWT decode + refresh
│   │   └── api/               # Axios client (attaches JWT, base URL)
│   └── dist/                  # Production build output (git-ignored)
│
└── server/                    # Express API
    ├── routes/                # One file per domain:
    │   ├── auth.js            #   login / register
    │   ├── admin.js           #   users, stats, dashboard alerts
    │   ├── clients.js         #   alarms clients, billing, transactions, permits
    │   ├── fleet.js           #   vehicles, notes, invoices, emails
    │   ├── projects.js        #   Slack project reports + completion overrides
    │   ├── financials.js      #   records, MRR, monthly chart
    │   ├── tickets.js         #   service tickets
    │   ├── inventory.js       #   inventory items
    │   ├── slack.js           #   vehicle Slack feed
    │   └── alarmSlack.js      #   alarm dispatch Slack feed
    ├── db/
    │   ├── pool.js            #   PostgreSQL connection pool
    │   ├── schema.sql         #   core tables (users, tickets, financials)
    │   ├── clients_schema.sql #   clients, monitoring, transactions
    │   ├── fleet_schema.sql   #   vehicles, notes, invoices, notifications
    │   └── inventory_schema.sql
    ├── services/
    │   └── monitoringScheduler.js   # cron job — weekly monitoring emails
    ├── config/
    │   └── mailer.js          #   Nodemailer SMTP config
    └── index.js               #   Express entry point
```

---

## Local Development

### Requirements
- Node.js **20.19+ or 22.12+**
- PostgreSQL

### 1 — Database

```bash
sudo -u postgres psql
```

```sql
CREATE USER portaluser WITH PASSWORD 'your_password';
CREATE DATABASE phoenix_portal OWNER portaluser;
GRANT ALL PRIVILEGES ON DATABASE phoenix_portal TO portaluser;
\q
```

Run the schema files in order:

```bash
cd server
psql -U portaluser -d phoenix_portal -f db/schema.sql
psql -U portaluser -d phoenix_portal -f db/clients_schema.sql
psql -U portaluser -d phoenix_portal -f db/fleet_schema.sql
psql -U portaluser -d phoenix_portal -f db/inventory_schema.sql
```

### 2 — Environment

Create `server/.env` — see [Environment Variables](#environment-variables) below.

### 3 — Run

```bash
# Terminal 1 — API (hot reload)
cd server && npm install && npm run dev

# Terminal 2 — Vite dev server
cd client && npm install && npm run dev
```

App: `http://localhost:5173` — Vite proxies `/api` calls to Express on port 5000.

> **WSL note:** Always run `npm run build` from WSL (not Windows Git Bash). The build target is Linux; running it from Windows installs Windows-native binaries that break on the server.

---

## Production Server

The portal runs on a dedicated Ubuntu 20.04 machine on the office LAN.

| | |
|---|---|
| **Hostname** | SATURN |
| **LAN IP** | `192.168.10.10` |
| **URL** | `http://phxportal.internal` (resolved by UniFi DNS — available on office Wi-Fi automatically) |
| **App path** | `/home/saturn/Documents/PHXSECTEST/Phoenix-Interal-Web-Server-Test-main(1)/Phoenix-Interal-Web-Server-Test-main/` |
| **Process manager** | PM2 — auto-restarts on crash and on server reboot |
| **Reverse proxy** | nginx — serves `client/dist/` and proxies `/api/` to Express on port 5000 |

### Useful server commands

| Task | Command |
|---|---|
| View live logs | `pm2 logs phoenix-portal` |
| Restart app | `pm2 restart phoenix-portal` |
| Check process status | `pm2 status` |
| nginx errors | `sudo tail -f /var/log/nginx/error.log` |
| Connect to DB | `sudo -u postgres psql -d phoenix_portal` |

---

## Deploy Workflow

```bash
# 1. On your laptop — commit and push
git add -A
git commit -m "your message"
git push

# 2. SSH or RustDesk into the server, then:
cd "/home/saturn/Documents/PHXSECTEST/Phoenix-Interal-Web-Server-Test-main(1)/Phoenix-Interal-Web-Server-Test-main"
git pull
cd phoenix-portal/phoenix-portal/client && npm run build
pm2 restart phoenix-portal
```

If only server-side files changed (no client changes), skip `npm run build` and just restart PM2.

---

## Environment Variables

Create `server/.env`:

```env
# ── Server ────────────────────────────────────────────────────────────────────
PORT=5000

# ── PostgreSQL ────────────────────────────────────────────────────────────────
DB_HOST=localhost
DB_PORT=5432
DB_NAME=phoenix_portal
DB_USER=portaluser
DB_PASSWORD=your_db_password

# ── JWT ───────────────────────────────────────────────────────────────────────
# Generate: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=64_char_random_hex_string

# ── Email (SMTP) ──────────────────────────────────────────────────────────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_gmail@gmail.com
SMTP_PASS=xxxx_xxxx_xxxx_xxxx     # Gmail App Password (not your login password)
SMTP_FROM=Phoenix SecTech Portal <your_gmail@gmail.com>

# ── Slack ─────────────────────────────────────────────────────────────────────
SLACK_TOKEN=xoxb-...
SLACK_CHANNEL_ID=           # Fleet / general channel
ALARM_SLACK_CHANNEL_ID=     # Alarm dispatch channel
PROJECT_SLACK_CHANNEL_ID=   # Project reports channel
```

**Gmail App Password:** Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) → Create → copy the 16-character password into `SMTP_PASS`.

> **Do NOT set `VITE_API_URL`** in `client/.env`. Leaving it unset means all API calls use a relative `/api` path, which works correctly regardless of which hostname or IP is used to access the app.

---

## Database Setup

Column migrations for newer features run automatically at server startup via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. No manual migration scripts are needed for:
- `vehicle_notes.resolved` / `resolved_at` (maintenance resolution)
- `clients.permit_number` / `permit_expires` (permit tracking)

If setting up a fresh database, run the four schema files in [Local Development → Database](#1--database) above.

### Default admin account

| Field    | Value                      |
|----------|----------------------------|
| Email    | `admin@phoenixsectech.com` |
| Password | `Admin1234!`               |

**Change this password immediately** after first login (Admin → Users).

---

## Slack Integration Setup

The portal reads from three Slack channels:

| Purpose               | `.env` key                   |
|-----------------------|------------------------------|
| Fleet vehicle check-ins | `SLACK_CHANNEL_ID`         |
| Alarm dispatch logs   | `ALARM_SLACK_CHANNEL_ID`     |
| Project / work orders | `PROJECT_SLACK_CHANNEL_ID`   |

### Create a Slack bot

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Under **OAuth & Permissions → Bot Token Scopes**, add:
   - `channels:history`
   - `channels:read`
   - `files:read`
   - `users:read`
3. **Install to Workspace** → copy the `xoxb-...` Bot User OAuth Token → paste into `SLACK_TOKEN`

### Invite the bot to each channel

In Slack, open each channel and type:
```
/invite @YourBotName
```

### Find channel IDs

Right-click a channel → **Copy link**.  
The URL ends with the channel ID: `https://workspace.slack.com/archives/C0123456789`

---

## API Reference

### Auth
| Method | Endpoint           | Access |
|--------|--------------------|--------|
| POST   | /api/auth/login    | Public |
| POST   | /api/auth/register | Public |

### Admin
| Method | Endpoint                   | Access |
|--------|----------------------------|--------|
| GET    | /api/admin/alerts          | All    |
| GET    | /api/admin/stats           | Admin  |
| GET    | /api/admin/technicians     | Admin, Technician |
| GET    | /api/admin/users           | Admin  |
| PATCH  | /api/admin/users/:id/role  | Admin  |
| DELETE | /api/admin/users/:id       | Admin  |

### Clients (Alarms)
| Method | Endpoint                              | Access              |
|--------|---------------------------------------|---------------------|
| GET    | /api/clients                          | All                 |
| GET    | /api/clients/permits                  | Accounting, Admin   |
| GET    | /api/clients/:id                      | All                 |
| PATCH  | /api/clients/:id                      | All                 |
| PATCH  | /api/clients/billing/bulk             | Accounting, Admin   |
| POST   | /api/clients/:id/monitoring           | Accounting, Admin   |
| POST   | /api/clients/:id/tickets              | All                 |
| PATCH  | /api/clients/tickets/:ticketId        | All                 |
| GET    | /api/clients/:id/transactions         | Accounting, Admin   |
| POST   | /api/clients/:id/transactions         | Accounting, Admin   |
| DELETE | /api/clients/:id/transactions/:txId   | Accounting, Admin   |

### Fleet
| Method | Endpoint                              | Access |
|--------|---------------------------------------|--------|
| GET    | /api/fleet                            | All    |
| GET    | /api/fleet/:id                        | All    |
| PATCH  | /api/fleet/:id                        | All    |
| POST   | /api/fleet/:id/notes                  | All    |
| PATCH  | /api/fleet/:id/notes/:noteId          | All    |
| DELETE | /api/fleet/:id/notes/:noteId          | All    |
| POST   | /api/fleet/:id/invoices               | All    |
| DELETE | /api/fleet/:id/invoices/:invId        | All    |
| POST   | /api/fleet/:id/send-service-email     | All    |
| POST   | /api/fleet/:id/send-tags-email        | All    |

### Financials
| Method | Endpoint                              | Access              |
|--------|---------------------------------------|---------------------|
| GET    | /api/financials                       | Accounting, Admin   |
| GET    | /api/financials/summary               | Accounting, Admin   |
| GET    | /api/financials/monthly               | Accounting, Admin   |
| GET    | /api/financials/fleet                 | Accounting, Admin   |
| GET    | /api/financials/client-transactions   | Accounting, Admin   |
| POST   | /api/financials                       | Accounting, Admin   |
| DELETE | /api/financials/:id                   | Admin               |

### Tickets
| Method | Endpoint          | Access              |
|--------|-------------------|---------------------|
| GET    | /api/tickets      | Technician, Admin   |
| POST   | /api/tickets      | Technician, Admin   |
| PATCH  | /api/tickets/:id  | Technician, Admin   |
| DELETE | /api/tickets/:id  | Admin               |

### Inventory
| Method | Endpoint           | Access                                        |
|--------|--------------------|-----------------------------------------------|
| GET    | /api/inventory     | All                                           |
| POST   | /api/inventory     | Accounting, Admin                             |
| PATCH  | /api/inventory/:id | All (technician: qty only; admin: full edit)  |
| DELETE | /api/inventory/:id | Admin                                         |

### Projects
| Method | Endpoint                    | Access |
|--------|-----------------------------|--------|
| GET    | /api/projects               | All    |
| GET    | /api/projects/image/:fileId | All    |
| PATCH  | /api/projects/:name/complete| All    |

### Slack
| Method | Endpoint                          | Access |
|--------|-----------------------------------|--------|
| GET    | /api/slack/vehicle/:vehicleId     | All    |
| GET    | /api/alarm-slack/client/:clientId | All    |

---

## Troubleshooting

### "Cannot connect to database" on startup
- Verify PostgreSQL is running: `sudo systemctl status postgresql`
- Confirm `DB_USER`, `DB_PASSWORD`, and `DB_NAME` in `.env` match what was created

### Build fails with "cannot execute binary file" or Rollup error
- Make sure you're building from WSL (Linux), not Windows Git Bash
- Node.js must be 20.19+ or 22.12+ — check with `node -v`

### Login works on the server but fails on other devices
- Both devices must be on the same office Wi-Fi
- The portal is only reachable at `http://phxportal.internal` on the office network

### Emails not sending — "535 Auth Error"
- You need a Gmail **App Password**, not your regular Gmail password
- Generate at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
- Paste into `SMTP_PASS` and restart the server

### Slack feed shows no messages for a vehicle
- Confirm the bot was invited to the channel: `/invite @YourBotName`
- Confirm channel IDs in `.env` are correct
- Each vehicle needs a `slack_name` matching the exact text used in the Slack channel

### Frontend changes not showing after deploy
- Always run `npm run build` after client-side changes before restarting PM2
- Hard-refresh the browser (`Ctrl+Shift+R`) to clear cached files
