# Phoenix Security & Technology — Internal Portal

A role-gated internal web portal for Phoenix Security & Technology. Technicians manage service tickets, accounting manages financial records, and admins oversee everything — each role sees only what it needs to.

Built with **React + Vite** (frontend), **Node.js + Express** (backend), and **PostgreSQL** (database).

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Project Structure](#project-structure)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the App](#running-the-app)
- [Default Credentials](#default-credentials)
- [Roles & Access](#roles--access)
- [API Reference](#api-reference)
- [Testing the API](#testing-the-api)
- [Adding Features](#adding-features)
- [Deployment (GoDaddy)](#deployment-godaddy)

---

## Tech Stack

| Layer      | Technology                        |
|------------|-----------------------------------|
| Frontend   | React 18, Vite, React Router v6   |
| Backend    | Node.js, Express 5                |
| Database   | PostgreSQL 14+                    |
| Auth       | JWT (jsonwebtoken) + bcryptjs     |
| Email      | Nodemailer                        |
| Dev tools  | nodemon, dotenv                   |

---

## Prerequisites

Make sure the following are installed before you begin:

- [Node.js](https://nodejs.org/) v18 or higher
- [PostgreSQL](https://www.postgresql.org/) v14 or higher
- npm v9 or higher (comes with Node)
- Git

On Ubuntu / WSL:
```bash
sudo apt update
sudo apt install -y nodejs npm postgresql postgresql-client
sudo service postgresql start
```

---

## Project Structure

```
phoenix-portal/
├── client/                        # React + Vite frontend
│   ├── public/
│   ├── src/
│   │   ├── api/
│   │   │   └── client.js          # Axios instance with JWT interceptor
│   │   ├── components/
│   │   │   ├── Layout.jsx         # Sidebar navigation shell
│   │   │   └── Layout.css
│   │   ├── context/
│   │   │   └── AuthContext.jsx    # Auth state (login/logout/user)
│   │   ├── pages/
│   │   │   ├── Login.jsx          # Login page
│   │   │   ├── Dashboard.jsx      # Role-specific stats dashboard
│   │   │   ├── Tickets.jsx        # Service ticket management
│   │   │   ├── Financials.jsx     # Financial record management
│   │   │   └── Admin.jsx          # User management (admin only)
│   │   ├── App.jsx                # Routes + role guards
│   │   ├── main.jsx               # Entry point
│   │   └── index.css              # Global design system / CSS variables
│   ├── .env.example
│   └── vite.config.js
│
└── server/                        # Express backend
    ├── config/
    │   └── mailer.js              # Nodemailer transporter
    ├── db/
    │   ├── pool.js                # PostgreSQL connection pool
    │   └── schema.sql             # Table definitions + seed data
    ├── middleware/
    │   └── requireRole.js         # JWT verification + role gating
    ├── routes/
    │   ├── auth.js                # Login + register
    │   ├── tickets.js             # Service ticket CRUD
    │   ├── financials.js          # Financial record CRUD
    │   └── admin.js               # User management + stats
    ├── index.js                   # Express app entry point
    └── .env.example
```

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/your-org/phoenix-portal.git
cd phoenix-portal
```

### 2. Set up the database

```bash
# Create the database
sudo -u postgres createdb phoenix_portal

# Run the schema (creates tables and seeds default admin)
sudo -u postgres psql -d phoenix_portal -f server/db/schema.sql
```

### 3. Install backend dependencies

```bash
cd server
npm install
```

### 4. Install frontend dependencies

```bash
cd ../client
npm install
```

---

## Configuration

### Backend — `server/.env`

```bash
cd server
cp .env.example .env
```

Edit `server/.env`:

```env
# Server
PORT=5000
CLIENT_ORIGIN=http://localhost:5173

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=phoenix_portal
DB_USER=postgres
DB_PASSWORD=your_postgres_password

# JWT — use a long random string
JWT_SECRET=replace_this_with_a_long_random_secret

# SMTP (GoDaddy)
RESEND_API_KEY=re_
```

| Variable        | Description                                        |
|-----------------|----------------------------------------------------|
| `PORT`          | Port the API listens on (default 5000)             |
| `CLIENT_ORIGIN` | Frontend URL — used for CORS                       |
| `DB_*`          | PostgreSQL connection details                      |
| `JWT_SECRET`    | Secret for signing auth tokens — keep this private |
| `SMTP_*`        | Email credentials for outgoing notifications       |

> **Note:** Email failures are non-fatal — the app continues working if SMTP is not configured. Leave SMTP fields as placeholders for local dev.

### Frontend — `client/.env`

```bash
cd client
cp .env.example .env
```

```env
VITE_API_URL=http://localhost:5000/api
```

Change `VITE_API_URL` to your live API domain when deploying to production.

---

## Running the App

Open two terminals.

**Terminal 1 — Backend:**
```bash
cd server
npm run dev
# API running at http://localhost:5000
```

**Terminal 2 — Frontend:**
```bash
cd client
npm run dev
# App running at http://localhost:5173
```

Then open `http://localhost:5173` in your browser.

---

## Default Credentials

The schema seeds one admin account:

| Field    | Value                        |
|----------|------------------------------|
| Email    | admin@phoenixsectech.com     |
| Password | Admin1234!                   |
| Role     | admin                        |

> ⚠️ Change this password immediately after first login via the Admin panel or directly in the database.

To create additional users, log in as admin and use the **Admin → Create User** button, or hit the register endpoint directly (see API reference below).

---

## Roles & Access

| Page        | Technician | Accounting | Admin |
|-------------|------------|------------|-------|
| Dashboard   | ✅ (own ticket stats) | ✅ (financial summary) | ✅ (full stats) |
| Tickets     | ✅ (own/assigned only) | ❌ | ✅ (all tickets) |
| Financials  | ❌ | ✅ | ✅ |
| Admin       | ❌ | ❌ | ✅ |

**Ticket visibility rules:**
- Technicians see tickets they created or are assigned to.
- Admins see all tickets and can assign/reassign to any technician.

**Email notifications** are sent to all admins when:
- A new user registers
- A new service ticket is created
- A new financial record is added

---

## API Reference

All protected routes require the header:
```
Authorization: Bearer <token>
```

### Auth

| Method | Endpoint             | Access | Body |
|--------|----------------------|--------|------|
| POST   | `/api/auth/login`    | Public | `{ email, password }` |
| POST   | `/api/auth/register` | Public | `{ name, email, password, role }` |

### Tickets

| Method | Endpoint              | Access             | Body |
|--------|-----------------------|--------------------|------|
| GET    | `/api/tickets`        | Technician, Admin  | — |
| POST   | `/api/tickets`        | Technician, Admin  | `{ title, description?, assigned_to? }` |
| PATCH  | `/api/tickets/:id`    | Technician, Admin  | `{ status?, assigned_to? }` |
| DELETE | `/api/tickets/:id`    | Admin only         | — |

Valid ticket statuses: `open`, `in_progress`, `resolved`, `closed`

### Financials

| Method | Endpoint                   | Access            | Body |
|--------|----------------------------|-------------------|------|
| GET    | `/api/financials`          | Accounting, Admin | — |
| GET    | `/api/financials/summary`  | Accounting, Admin | — |
| POST   | `/api/financials`          | Accounting, Admin | `{ description, amount, type }` |
| DELETE | `/api/financials/:id`      | Admin only        | — |

Valid record types: `income`, `expense`

### Admin

| Method | Endpoint                    | Access     | Body |
|--------|-----------------------------|------------|------|
| GET    | `/api/admin/users`          | Admin only | — |
| GET    | `/api/admin/stats`          | Admin only | — |
| GET    | `/api/admin/technicians`    | Tech, Admin | — |
| PATCH  | `/api/admin/users/:id/role` | Admin only | `{ role }` |
| DELETE | `/api/admin/users/:id`      | Admin only | — |

---

## Testing the API

You can test endpoints directly with `curl`. First get a token:

```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@phoenixsectech.com","password":"Admin1234!"}'
```

Copy the `token` from the response, then use it in subsequent requests:

```bash
# Get all tickets
curl http://localhost:5000/api/tickets \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"

# Create a ticket
curl -X POST http://localhost:5000/api/tickets \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{"title":"Fix server rack","description":"Rack in room B needs inspection"}'

# Add a financial record
curl -X POST http://localhost:5000/api/financials \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{"description":"Monthly software license","amount":299.99,"type":"expense"}'

# Get admin stats
curl http://localhost:5000/api/admin/stats \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

---

## Adding Features

### Adding a new route

1. Create or edit a file in `server/routes/`.
2. Add your route handler using `requireRole(...)` for access control.
3. Register it in `server/index.js`:
   ```js
   app.use('/api/yourroute', require('./routes/yourroute'));
   ```

### Adding a new page

1. Create a new file in `client/src/pages/`.
2. Wrap it in `<Layout>` for the sidebar.
3. Add a route in `client/src/App.jsx` inside `<Routes>`:
   ```jsx
   <Route path="/yourpage" element={<PrivateRoute roles={['admin']}><YourPage /></PrivateRoute>} />
   ```
4. Add a nav link for the appropriate role(s) in the `NAV` object in `client/src/components/Layout.jsx`.

### Adding a new role

1. Add the value to the `user_role` enum in `server/db/schema.sql`.
2. Update the `validRoles` array in `server/routes/auth.js`.
3. Add the role's nav links to the `NAV` object in `Layout.jsx`.
4. Add `PrivateRoute` role arrays in `App.jsx` as needed.

### Changing the color scheme

All colors are CSS variables defined at the top of `client/src/index.css`. Edit the `:root` block — changes apply globally.

---

## Deployment (GoDaddy)

### Backend

1. Upload the `server/` directory to your VPS.
2. Set environment variables in `server/.env` using your live domain and GoDaddy SMTP credentials.
3. Install dependencies and start with PM2:
   ```bash
   cd server
   npm install --omit=dev
   npm install -g pm2
   pm2 start index.js --name phoenix-api
   pm2 save
   pm2 startup
   ```

### Frontend

1. Set `VITE_API_URL` in `client/.env` to your live API URL (e.g. `https://api.yourdomain.com/api`).
2. Build the frontend:
   ```bash
   cd client
   npm run build
   ```
3. Upload the contents of `client/dist/` to your web root (public_html or equivalent).
4. Configure your web server (Nginx/Apache) to serve `index.html` for all routes (required for React Router):

   **Nginx:**
   ```nginx
   location / {
       try_files $uri $uri/ /index.html;
   }
   ```

   **Apache (.htaccess):**
   ```apache
   RewriteEngine On
   RewriteCond %{ REQUEST_FILENAME} !-f
   RewriteRule ^ index.html [QSA,L]
   ```

### GoDaddy SMTP settings

```env
SMTP_HOST=smtpout.secureserver.net
SMTP_PORT=587
SMTP_USER=noreply@yourdomain.com
SMTP_PASS=your_godaddy_email_password
```

---

## License

Internal use only — Phoenix Security & Technology.
