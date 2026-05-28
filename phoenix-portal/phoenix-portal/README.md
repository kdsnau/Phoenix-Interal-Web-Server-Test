# Phoenix Security & Technology — Internal Portal

Role-gated internal web portal for Phoenix Security & Technology.
Built with React + Vite (frontend) and Node.js + Express + PostgreSQL (backend).
Self-hosted on a local server rack, served over the company LAN.

---

## Roles & Access

| Page        | Technician | Accounting | Admin |
|-------------|-----------|------------|-------|
| Dashboard   | ✅ own stats | ✅ financial summary | ✅ full |
| Tickets     | ✅ own/assigned | ❌ | ✅ all |
| Financials  | ❌ | ✅ | ✅ |
| Alarms      | ✅ system/tickets/slack | ✅ + billing/monitoring | ✅ all |
| Fleet       | ✅ | ✅ | ✅ |
| Inventory   | ✅ (adjust qty) | ✅ (add/edit) | ✅ (full + delete) |
| Projects    | ✅ | ✅ | ✅ |
| Admin       | ❌ | ❌ | ✅ |

---

## Stack

- **Frontend:** React + Vite (production build served by Express)
- **Backend:** Node.js + Express
- **Database:** PostgreSQL
- **Auth:** JWT + bcryptjs
- **Email:** Nodemailer (Gmail SMTP)
- **Slack:** @slack/web-api (vehicle reports + alarm service logs + project reports)
- **Scheduling:** node-cron (weekly monitoring emails)
- **Web server:** nginx (reverse proxy → port 5000)

---

## Quick Start

### 1. Database

```bash
sudo service postgresql start
sudo -u postgres psql
```

```sql
CREATE DATABASE phoenix_portal;
\c phoenix_portal
\i server/db/schema.sql
\i server/db/clients_schema.sql
\i server/db/inventory_schema.sql
```

### 2. Backend

```bash
cd server
npm install
cp .env.example .env   # fill in credentials
npm run dev            # port 5000, nodemon
```

### 3. Frontend (development)

```bash
cd client
npm install
npm run dev            # port 5173, proxies /api → localhost:5000
```

### 4. Frontend (production build)

```bash
cd client
npm run build          # outputs to client/dist/
```

Express automatically serves `client/dist/` — no separate Vite server needed in production.

---

## Environment Variables (`server/.env`)

| Variable                  | Description                                           |
|---------------------------|-------------------------------------------------------|
| `PORT`                    | API port (default 5000)                               |
| `CLIENT_ORIGIN`           | Allowed CORS origins (comma-separated)                |
| `DB_HOST`                 | PostgreSQL host                                       |
| `DB_PORT`                 | PostgreSQL port (default 5432)                        |
| `DB_NAME`                 | Database name                                         |
| `DB_USER`                 | Database user                                         |
| `DB_PASSWORD`             | Database password                                     |
| `JWT_SECRET`              | Long random string — generate with `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `SMTP_HOST`               | SMTP server (e.g. `smtp.gmail.com`)                   |
| `SMTP_PORT`               | SMTP port (587 for TLS)                               |
| `SMTP_USER`               | Sender email address                                  |
| `SMTP_PASS`               | Gmail App Password (16 chars, 2FA required)           |
| `SMTP_FROM`               | Display name + address for outgoing mail              |
| `SLACK_TOKEN`             | Slack bot token (`xoxb-...`)                          |
| `SLACK_CHANNEL_ID`        | Vehicle reports Slack channel                         |
| `ALARM_SLACK_CHANNEL_ID`  | Alarm service logs Slack channel                      |
| `PROJECT_SLACK_CHANNEL_ID`| Project reports Slack channel                         |

### Gmail App Password setup
1. Enable 2-Step Verification on the sending Gmail account
2. Go to **myaccount.google.com → Security → 2-Step Verification → App Passwords**
3. Generate a password, paste it into `SMTP_PASS`

---

## API Endpoints

### Auth
| Method | Endpoint           | Access |
|--------|--------------------|--------|
| POST   | /api/auth/login    | Public |
| POST   | /api/auth/register | Public |

### Tickets
| Method | Endpoint          | Access            |
|--------|-------------------|-------------------|
| GET    | /api/tickets      | Technician, Admin |
| POST   | /api/tickets      | Technician, Admin |
| PATCH  | /api/tickets/:id  | Technician, Admin |
| DELETE | /api/tickets/:id  | Admin             |

### Financials
| Method | Endpoint                | Access            |
|--------|-------------------------|-------------------|
| GET    | /api/financials         | Accounting, Admin |
| GET    | /api/financials/summary | Accounting, Admin |
| GET    | /api/financials/monthly | Accounting, Admin |
| POST   | /api/financials         | Accounting, Admin |
| DELETE | /api/financials/:id     | Admin             |

### Admin
| Method | Endpoint                  | Access |
|--------|---------------------------|--------|
| GET    | /api/admin/users          | Admin  |
| GET    | /api/admin/stats          | Admin  |
| GET    | /api/admin/technicians    | Admin  |
| PATCH  | /api/admin/users/:id/role | Admin  |
| DELETE | /api/admin/users/:id      | Admin  |

### Fleet
| Method | Endpoint                        | Access |
|--------|---------------------------------|--------|
| GET    | /api/fleet                      | All    |
| GET    | /api/fleet/:id                  | All    |
| PATCH  | /api/fleet/:id                  | All    |
| POST   | /api/fleet/:id/notes            | All    |
| DELETE | /api/fleet/:id/notes/:noteId    | All    |
| POST   | /api/fleet/:id/invoices         | All    |
| DELETE | /api/fleet/:id/invoices/:invId  | All    |
| POST   | /api/fleet/:id/send-service-email | All  |
| POST   | /api/fleet/:id/send-tags-email  | All    |

### Clients (Alarms)
| Method | Endpoint                              | Access            |
|--------|---------------------------------------|-------------------|
| GET    | /api/clients                          | All               |
| GET    | /api/clients/:id                      | All               |
| PATCH  | /api/clients/:id                      | All               |
| POST   | /api/clients/:id/monitoring           | Accounting, Admin |
| POST   | /api/clients/:id/tickets              | All               |
| PATCH  | /api/clients/tickets/:ticketId        | All               |
| GET    | /api/clients/:id/transactions         | Accounting, Admin |
| POST   | /api/clients/:id/transactions         | Accounting, Admin |
| DELETE | /api/clients/:id/transactions/:txId   | Accounting, Admin |

### Inventory
| Method | Endpoint            | Access                                       |
|--------|---------------------|----------------------------------------------|
| GET    | /api/inventory      | All                                          |
| POST   | /api/inventory      | Accounting, Admin                            |
| PATCH  | /api/inventory/:id  | All (technician: qty only; admin: full edit) |
| DELETE | /api/inventory/:id  | Admin                                        |

### Slack
| Method | Endpoint                          | Access |
|--------|-----------------------------------|--------|
| GET    | /api/slack/vehicle/:vehicleId     | All    |
| GET    | /api/slack/all                    | All    |
| GET    | /api/alarm-slack/client/:clientId | All    |
| GET    | /api/alarm-slack/all              | All    |

### Projects
| Method | Endpoint                    | Access |
|--------|-----------------------------|--------|
| GET    | /api/projects               | All    |
| GET    | /api/projects/image/:fileId | All    |

---

## Production Deployment (LAN server rack)

### nginx config (`/etc/nginx/sites-available/phoenix`)

```nginx
server {
    listen 80;
    server_name phoenix.local phoenix 192.168.10.222 _;

    location / {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host       $host;
        proxy_set_header   X-Real-IP  $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Process management (PM2)

```bash
npm install -g pm2
cd server
pm2 start index.js --name phoenix-portal
pm2 save
pm2 startup   # auto-start on reboot
```

### LAN hostname resolution

Access via `http://192.168.10.222` from any device on the network.

For `phoenix.local` hostname resolution, add a custom DNS entry in your router
pointing `phoenix.local` → `192.168.10.222`. Alternatively, install `avahi-daemon`
for mDNS broadcasting (works natively on iOS; Android support varies).

### Deploy checklist

- [ ] Build frontend: `cd client && npm run build`
- [ ] All env vars set in `server/.env`
- [ ] PostgreSQL running: `sudo service postgresql start`
- [ ] nginx running: `sudo systemctl start nginx`
- [ ] Node running via PM2: `pm2 start index.js --name phoenix-portal`
- [ ] Change default admin password after first login
