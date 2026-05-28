# Phoenix Security & Technology — Internal Portal

A role-gated internal web portal for Phoenix Security & Technology built with React + Vite (frontend) and Node.js + Express + PostgreSQL (backend).

---

## Roles & Access

| Role         | Dashboard | Tickets | Financials | Admin |
|--------------|-----------|---------|------------|-------|
| Technician   | ✅        | ✅      | ❌         | ❌    |
| Accounting   | ✅        | ❌      | ✅         | ❌    |
| Admin        | ✅        | ✅      | ✅         | ✅    |

---

## Quick Start

### 1. Database

Create a PostgreSQL database and run the schema:

```bash
psql -U <user> -d <dbname> -f server/db/schema.sql
```

This creates all tables and seeds a default admin account:
- **Email:** admin@phoenixsectech.com
- **Password:** Admin1234!

> ⚠️ Change this password immediately after first login.

---

### 2. Backend

```bash
cd server
cp .env.example .env      # Fill in your DB and SMTP credentials
npm install
npm run dev               # Starts on port 5000 with nodemon
```

**Environment variables (server/.env):**

| Variable        | Description                              |
|-----------------|------------------------------------------|
| `PORT`          | API port (default 5000)                  |
| `CLIENT_ORIGIN` | Frontend URL for CORS                    |
| `DB_HOST`       | PostgreSQL host                          |
| `DB_PORT`       | PostgreSQL port (default 5432)           |
| `DB_NAME`       | Database name                            |
| `DB_USER`       | Database user                            |
| `DB_PASSWORD`   | Database password                        |
| `JWT_SECRET`    | Long random string for signing tokens    |
| `SMTP_HOST`     | SMTP host (GoDaddy: smtpout.secureserver.net) |
| `SMTP_PORT`     | SMTP port (587)                          |
| `SMTP_USER`     | Sender email address                     |
| `SMTP_PASS`     | Email password                           |

---

### 3. Frontend

```bash
cd client
cp .env.example .env      # Set VITE_API_URL if needed
npm install
npm run dev               # Starts on port 5173
```

For production build:

```bash
npm run build             # Output goes to client/dist/
```

---

## API Endpoints

### Auth
| Method | Endpoint              | Access  |
|--------|-----------------------|---------|
| POST   | /api/auth/login       | Public  |
| POST   | /api/auth/register    | Public  |

### Tickets
| Method | Endpoint              | Access                  |
|--------|-----------------------|-------------------------|
| GET    | /api/tickets          | Technician, Admin       |
| POST   | /api/tickets          | Technician, Admin       |
| PATCH  | /api/tickets/:id      | Technician, Admin       |
| DELETE | /api/tickets/:id      | Admin only              |

### Financials
| Method | Endpoint                  | Access              |
|--------|---------------------------|---------------------|
| GET    | /api/financials           | Accounting, Admin   |
| GET    | /api/financials/summary   | Accounting, Admin   |
| POST   | /api/financials           | Accounting, Admin   |
| DELETE | /api/financials/:id       | Admin only          |

### Admin
| Method | Endpoint                      | Access      |
|--------|-------------------------------|-------------|
| GET    | /api/admin/users              | Admin only  |
| GET    | /api/admin/stats              | Admin only  |
| PATCH  | /api/admin/users/:id/role     | Admin only  |
| DELETE | /api/admin/users/:id          | Admin only  |

---

## GoDaddy Deployment Notes

- Point your domain's A record to your VPS/server IP.
- Run the backend with PM2: `pm2 start server/index.js --name phoenix-api`
- Serve the frontend `client/dist/` with Nginx or Apache.
- Use GoDaddy's SMTP host `smtpout.secureserver.net` on port 587.
- Set `CLIENT_ORIGIN` in server `.env` to your live domain.
- Set `VITE_API_URL` in client `.env` to your API domain before building.
