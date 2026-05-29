# Phoenix Security & Technology — Internal Portal

Role-gated internal web portal for Phoenix Security & Technology.  
Covers fleet management, service tickets, financials, client monitoring, inventory, and project tracking — all in one place.  
Self-hosted on a local server rack, served over the company LAN.

---

## Table of Contents

1. [Roles & Access](#roles--access)
2. [Stack](#stack)
3. [Part 1 — Install System Dependencies (start here if setting up a fresh machine)](#part-1--install-system-dependencies)
4. [Part 2 — Set Up the Database](#part-2--set-up-the-database)
5. [Part 3 — Configure the Server](#part-3--configure-the-server)
6. [Part 4 — Install & Build the App](#part-4--install--build-the-app)
7. [Part 5 — Run the App](#part-5--run-the-app)
8. [Part 6 — Allow Other Devices on the Network to Connect](#part-6--allow-other-devices-on-the-network-to-connect)
9. [Part 7 — First Login & Initial Data Setup](#part-7--first-login--initial-data-setup)
10. [Part 8 — Slack Integration Setup](#part-8--slack-integration-setup)
11. [Development Mode (for making changes)](#development-mode-for-making-changes)
12. [API Reference](#api-reference)
13. [Troubleshooting](#troubleshooting)

---

## Roles & Access

| Page        | Technician               | Accounting           | Admin     |
|-------------|--------------------------|----------------------|-----------|
| Dashboard   | ✅ own stats             | ✅ financial summary | ✅ full   |
| Tickets     | ✅ own/assigned          | ❌                   | ✅ all    |
| Financials  | ❌                       | ✅                   | ✅        |
| Alarms      | ✅ system/tickets/slack  | ✅ + billing         | ✅ all    |
| Fleet       | ✅                       | ✅                   | ✅        |
| Inventory   | ✅ adjust qty            | ✅ add/edit          | ✅ full   |
| Projects    | ✅                       | ✅                   | ✅        |
| Admin       | ❌                       | ❌                   | ✅        |

---

## Stack

| Layer       | Technology                                       |
|-------------|--------------------------------------------------|
| Frontend    | React 19 + Vite (build served by Express)        |
| Backend     | Node.js + Express                                |
| Database    | PostgreSQL                                       |
| Auth        | JWT + bcryptjs                                   |
| Email       | Nodemailer (Gmail SMTP or any SMTP provider)     |
| Slack       | @slack/web-api (fleet check-ins, alarms, projects) |
| Scheduling  | node-cron (weekly monitoring emails)             |
| Web server  | nginx (reverse proxy → port 5000, LAN access)   |

---

## Part 1 — Install System Dependencies

> **This section is for a brand-new machine with nothing installed.**  
> If Node.js, PostgreSQL, and Git are already installed, skip to [Part 2](#part-2--set-up-the-database).

This server runs on **Windows + WSL2** (Windows Subsystem for Linux). All app code runs inside the WSL2 Linux environment.

---

### Step 1 — Enable WSL2

Open **PowerShell as Administrator** (search "PowerShell" in the Start menu → right-click → *Run as administrator*) and run:

```powershell
wsl --install
```

Restart your PC when it prompts you. After the restart, an Ubuntu terminal will open automatically and ask you to set a Linux username and password. Choose something simple — you'll need to type this password whenever you use `sudo`.

> Already have WSL2? Run `wsl --update` to make sure it's current.

---

### Step 2 — Open the WSL2 terminal

All remaining commands in Part 1 run inside **WSL2/Ubuntu**, not PowerShell.  
Open it by searching **"Ubuntu"** in the Start menu.

---

### Step 3 — Install Node.js (v20)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Check it worked:
```bash
node -v    # should show v20.x.x or higher
npm -v
```

---

### Step 4 — Install PostgreSQL

```bash
sudo apt-get update
sudo apt-get install -y postgresql postgresql-contrib
sudo service postgresql start
```

Make Postgres start automatically every time you open a WSL2 terminal:
```bash
echo 'sudo service postgresql start > /dev/null 2>&1' >> ~/.bashrc
```

---

### Step 5 — Install nginx

```bash
sudo apt-get install -y nginx
```

nginx is used to serve the app on port 80 so other devices on the network can reach it. It's not required if you only need to access the portal from the server machine itself.

---

### Step 6 — Install Git

```bash
sudo apt-get install -y git
```

---

## Part 2 — Set Up the Database

All commands in this section run inside WSL2.

### Step 1 — Create the database and user

```bash
sudo -u postgres psql
```

You are now inside the `psql` prompt. Run these SQL commands:

```sql
CREATE DATABASE phoenix_portal;
CREATE USER phoenix WITH PASSWORD 'choose_a_strong_password_here';
GRANT ALL PRIVILEGES ON DATABASE phoenix_portal TO phoenix;
\q
```

Write down the password you chose — you'll need it in Part 3.

---

### Step 2 — Clone the repository

```bash
cd ~
git clone https://github.com/kdsnau/Phoenix-Interal-Web-Server-Test.git phoenix-portal
cd phoenix-portal
```

---

### Step 3 — Run the schema files

This creates all the database tables. Run each file in order:

```bash
cd ~/phoenix-portal/server

PGPASSWORD=your_password psql -U phoenix -d phoenix_portal -f db/schema.sql
PGPASSWORD=your_password psql -U phoenix -d phoenix_portal -f db/fleet_schema.sql
PGPASSWORD=your_password psql -U phoenix -d phoenix_portal -f db/clients_schema.sql
PGPASSWORD=your_password psql -U phoenix -d phoenix_portal -f db/inventory_schema.sql
```

Replace `your_password` with what you set in Step 1 above.

Each command should print something like `CREATE TABLE` with no errors. If you see `ERROR:` something went wrong — double-check the password and database name.

---

## Part 3 — Configure the Server

### Step 1 — Create the .env file

```bash
cd ~/phoenix-portal/server
cp .env.example .env
nano .env
```

Fill in every value using the table below. Save and close with `Ctrl+O → Enter → Ctrl+X`.

---

### Environment Variables

```env
# ── Server ────────────────────────────────────────────────────────────────────
PORT=5000

# Comma-separated list of origins allowed to call the API.
# Add your server's LAN IP so phones and other computers can log in.
# Example: http://localhost:5173,http://192.168.1.50
CLIENT_ORIGIN=http://localhost:5173,http://YOUR_LAN_IP

# ── PostgreSQL ────────────────────────────────────────────────────────────────
DB_HOST=localhost
DB_PORT=5432
DB_NAME=phoenix_portal
DB_USER=phoenix
DB_PASSWORD=the_password_you_set_in_part_2

# ── JWT ───────────────────────────────────────────────────────────────────────
# A long random string used to sign login tokens.
# Generate one by running:  node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=paste_output_here

# ── Email (SMTP) ──────────────────────────────────────────────────────────────
# Gmail example. See Part 3 Step 2 for how to get an App Password.
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_gmail@gmail.com
SMTP_PASS=xxxx_xxxx_xxxx_xxxx

# ── Slack ─────────────────────────────────────────────────────────────────────
# See Part 8 for how to get these values.
SLACK_TOKEN=xoxb-your-bot-token
SLACK_CHANNEL_ID=CXXXXXXXXXX
ALARM_SLACK_CHANNEL_ID=CXXXXXXXXXX
PROJECT_SLACK_CHANNEL_ID=CXXXXXXXXXX
```

---

### Step 2 — Generate a JWT secret

Run this command and copy the output into `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

### Step 3 — Find your LAN IP

```bash
ip route | grep default | awk '{print $9}'
```

This is the IP address other devices on your network use to reach the server. Add it to `CLIENT_ORIGIN` in your `.env`.

---

### Step 4 — Set up a Gmail App Password (for email notifications)

Regular Gmail passwords won't work. You need an **App Password**:

1. Make sure 2-Step Verification is turned on at [myaccount.google.com/security](https://myaccount.google.com/security)
2. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
3. Click **Create** → name it "Phoenix Portal" → copy the 16-character password shown
4. Paste it into `SMTP_PASS` in your `.env`

> **Important:** If you regenerate an App Password later, you must restart the server manually — it doesn't pick up `.env` changes automatically.

---

## Part 4 — Install & Build the App

### Install server packages

```bash
cd ~/phoenix-portal/server
npm install
```

### Install and build the frontend

```bash
cd ~/phoenix-portal/client
npm install
npm run build
```

The build output goes into `client/dist/`. The Express server serves this folder automatically — no separate web server needed.

> **Do NOT set `VITE_API_URL`** in `client/.env`. Leaving it unset means all API calls use a relative `/api` path, which works correctly from any device. Setting it to `localhost` would break logins from phones and other computers.

---

## Part 5 — Run the App

```bash
cd ~/phoenix-portal/server
npm start
```

Open a browser on the server machine and go to:
```
http://localhost:5000
```

The login screen should appear. See [Part 7](#part-7--first-login--initial-data-setup) for the default login credentials.

> To keep the server running and auto-restart on file changes, use `npm run dev` instead of `npm start`.

---

## Part 6 — Allow Other Devices on the Network to Connect

WSL2 runs in its own private virtual network by default. Without extra setup, phones and other computers on the same Wi-Fi can't reach it even though the server machine can. These steps fix that.

---

### Option A — Mirrored Networking (Windows 11 — recommended, permanent)

This makes WSL2 share the Windows network interface. No port forwarding needed, and it survives reboots.

1. Open Notepad and create (or edit) `C:\Users\YourWindowsUsername\.wslconfig`
2. Add these lines:
   ```ini
   [wsl2]
   networkingMode=mirrored
   ```
3. Save the file, then restart WSL from PowerShell:
   ```powershell
   wsl --shutdown
   ```
4. Reopen your WSL2 terminal — you're done. Your LAN IP now works directly.

---

### Option B — Port Forwarding (Windows 10 or if Option A doesn't work)

WSL2 has an internal IP that changes on every reboot. This script forwards your Windows LAN port 80 into WSL2.

Open **PowerShell as Administrator** on Windows (not WSL) and run:

```powershell
$wslIp = (wsl hostname -I).Trim().Split(' ')[0]
netsh interface portproxy add v4tov4 listenport=80 listenaddress=0.0.0.0 connectport=80 connectaddress=$wslIp
New-NetFirewallRule -DisplayName "WSL2 Phoenix Portal" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow -ErrorAction SilentlyContinue
Write-Host "Forwarding port 80 to WSL2 at $wslIp"
```

> **This must be re-run after every reboot** because WSL2's internal IP changes.  
> To automate it, save the script as `C:\phoenix-port-forward.ps1` and add it to Task Scheduler to run at startup as Administrator.

---

### Step — Configure nginx

Regardless of which option above you used, nginx must be configured to forward incoming requests to the Node.js app.

Create the config file:
```bash
sudo nano /etc/nginx/sites-available/phoenix-portal
```

Paste this (replace `192.168.1.50` with your actual LAN IP):
```nginx
server {
    listen 80;
    server_name 192.168.1.50 phoenix.local _;

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

Enable it:
```bash
sudo ln -sf /etc/nginx/sites-available/phoenix-portal /etc/nginx/sites-enabled/
sudo nginx -t          # must say "syntax is ok"
sudo service nginx start
```

Make nginx start automatically:
```bash
echo 'sudo service nginx start > /dev/null 2>&1' >> ~/.bashrc
```

---

### Verify from another device

On a phone or another computer connected to the same Wi-Fi, open a browser and go to:
```
http://YOUR_LAN_IP
```

The login screen should appear.

---

## Part 7 — First Login & Initial Data Setup

### Default admin account

| Field    | Value                      |
|----------|----------------------------|
| Email    | `admin@phoenixsectech.com` |
| Password | `Admin1234!`               |

**Change this password immediately** after your first login (Admin panel → Users).

---

### Add your vehicles

Vehicles must be added directly to the database. Connect to psql:

```bash
PGPASSWORD=your_password psql -U phoenix -d phoenix_portal
```

Then insert your vehicles:
```sql
INSERT INTO vehicles (vehicle_id, name, make, model, year, mileage)
VALUES
  ('VH-001', 'Unit 01', 'Nissan', 'NV200',           2019, 0),
  ('VH-002', 'Unit 02', 'Nissan', 'NV2500',          2020, 0),
  ('VH-003', 'Unit 03', 'Nissan', 'NV200 Cargo Van', 2021, 0),
  ('VH-004', 'Unit 04', 'Nissan', 'Frontier',        2022, 0),
  ('VH-005', 'Unit 05', 'Tesla',  'Model Y',         2023, 0);
\q
```

Adjust the values to match your actual fleet.

---

### Set each vehicle's Slack name

The Slack feed matches messages to vehicles using the exact name that appears in the Slack channel's **Vehicle** field (e.g. `"NV200 #1"`, `"Tesla #2"`, `"Nissan NV-2500"`). These names often don't match the database names, so you set them once using the migration script:

```bash
cd ~/phoenix-portal/server
node migrate-slack-names.js
```

The script will print what it set for each vehicle. If any show `⚠ No rows matched`, open `migrate-slack-names.js`, edit the `updates` array to match your actual vehicle IDs, and re-run.

---

## Part 8 — Slack Integration Setup

The portal reads from three Slack channels:

| Channel purpose       | `.env` variable              |
|-----------------------|------------------------------|
| Vehicle check-ins     | `SLACK_CHANNEL_ID`           |
| Alarm service logs    | `ALARM_SLACK_CHANNEL_ID`     |
| Project/work orders   | `PROJECT_SLACK_CHANNEL_ID`   |

### Create a Slack bot

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Give it a name (e.g. `Phoenix Portal`) and select your workspace
3. In the left sidebar go to **OAuth & Permissions**
4. Under **Bot Token Scopes**, click **Add an OAuth Scope** and add:
   - `channels:history`
   - `channels:read`
   - `files:read`
   - `users:read`
5. Scroll up and click **Install to Workspace** → **Allow**
6. Copy the **Bot User OAuth Token** (starts with `xoxb-`) — this is your `SLACK_TOKEN`

### Invite the bot to each channel

In Slack, open each channel the bot needs to read, then type:
```
/invite @YourBotName
```

### Find channel IDs

Right-click a channel name → **Copy link**.  
The URL looks like: `https://yourworkspace.slack.com/archives/C0123456789`  
The last part (`C0123456789`) is the channel ID. Paste each into your `.env`.

After updating `.env`, restart the server:
```bash
# stop with Ctrl+C, then:
npm start
```

---

## Development Mode (for making changes)

Run the backend and frontend as separate processes with hot reload.

**Terminal 1 — API server:**
```bash
cd ~/phoenix-portal/server
npm run dev
```

**Terminal 2 — Frontend dev server:**
```bash
cd ~/phoenix-portal/client
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).  
Vite automatically forwards `/api` requests to `localhost:5000` — no extra config needed.

> You do **not** need to run `npm run build` while developing. Run it only when you're ready to deploy changes to production.

---

## API Reference

### Auth
| Method | Endpoint            | Access |
|--------|---------------------|--------|
| POST   | /api/auth/login     | Public |
| POST   | /api/auth/register  | Public |

### Tickets
| Method | Endpoint          | Access            |
|--------|-------------------|-------------------|
| GET    | /api/tickets      | Technician, Admin |
| POST   | /api/tickets      | Technician, Admin |
| PATCH  | /api/tickets/:id  | Technician, Admin |
| DELETE | /api/tickets/:id  | Admin             |

### Financials
| Method | Endpoint                             | Access            |
|--------|--------------------------------------|-------------------|
| GET    | /api/financials                      | Accounting, Admin |
| GET    | /api/financials/summary              | Accounting, Admin |
| GET    | /api/financials/monthly              | Accounting, Admin |
| GET    | /api/financials/fleet                | Accounting, Admin |
| GET    | /api/financials/client-transactions  | Accounting, Admin |
| POST   | /api/financials                      | Accounting, Admin |
| DELETE | /api/financials/:id                  | Admin             |

### Admin
| Method | Endpoint                  | Access |
|--------|---------------------------|--------|
| GET    | /api/admin/users          | Admin  |
| GET    | /api/admin/stats          | Admin  |
| GET    | /api/admin/technicians    | Admin  |
| PATCH  | /api/admin/users/:id/role | Admin  |
| DELETE | /api/admin/users/:id      | Admin  |

### Fleet
| Method | Endpoint                            | Access |
|--------|-------------------------------------|--------|
| GET    | /api/fleet                          | All    |
| GET    | /api/fleet/:id                      | All    |
| PATCH  | /api/fleet/:id                      | All    |
| POST   | /api/fleet/:id/notes                | All    |
| DELETE | /api/fleet/:id/notes/:noteId        | All    |
| POST   | /api/fleet/:id/invoices             | All    |
| DELETE | /api/fleet/:id/invoices/:invId      | All    |
| POST   | /api/fleet/:id/send-service-email   | All    |
| POST   | /api/fleet/:id/send-tags-email      | All    |

### Clients (Alarms)
| Method | Endpoint                            | Access            |
|--------|-------------------------------------|-------------------|
| GET    | /api/clients                        | All               |
| GET    | /api/clients/:id                    | All               |
| PATCH  | /api/clients/:id                    | All               |
| POST   | /api/clients/:id/monitoring         | Accounting, Admin |
| POST   | /api/clients/:id/tickets            | All               |
| PATCH  | /api/clients/tickets/:ticketId      | All               |
| GET    | /api/clients/:id/transactions       | Accounting, Admin |
| POST   | /api/clients/:id/transactions       | Accounting, Admin |
| DELETE | /api/clients/:id/transactions/:txId | Accounting, Admin |

### Inventory
| Method | Endpoint           | Access                                        |
|--------|--------------------|-----------------------------------------------|
| GET    | /api/inventory     | All                                           |
| POST   | /api/inventory     | Accounting, Admin                             |
| PATCH  | /api/inventory/:id | All (technician: qty only; admin: full edit)  |
| DELETE | /api/inventory/:id | Admin                                         |

### Slack
| Method | Endpoint                          | Access |
|--------|-----------------------------------|--------|
| GET    | /api/slack/vehicle/:vehicleId     | All    |
| GET    | /api/alarm-slack/client/:clientId | All    |

### Projects
| Method | Endpoint                    | Access |
|--------|-----------------------------|--------|
| GET    | /api/projects               | All    |
| GET    | /api/projects/image/:fileId | All    |

---

## Troubleshooting

### "Cannot connect to database" on startup
- Make sure PostgreSQL is running: `sudo service postgresql status`
- Start it: `sudo service postgresql start`
- Verify `DB_USER`, `DB_PASSWORD`, and `DB_NAME` match what you set in Part 2

### Login works on the server PC but fails on phones / other computers
- Complete [Part 6](#part-6--allow-other-devices-on-the-network-to-connect)
- The phone and server must be on the same Wi-Fi network
- `CLIENT_ORIGIN` in `server/.env` must include your LAN IP
- After any `.env` change, restart the server manually (`Ctrl+C` → `npm start`) — nodemon does not watch `.env`

### Emails not sending — "535 Auth Error"
- You need a Gmail **App Password**, not your regular Gmail password
- Generate one at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
- Paste it into `SMTP_PASS` and restart the server

### Slack feed shows no messages for a vehicle
- Confirm the bot was invited to the channel with `/invite @YourBotName`
- Confirm `SLACK_TOKEN` and `SLACK_CHANNEL_ID` are correct in `.env`
- Run `node migrate-slack-names.js` — each vehicle needs a `slack_name` that matches the exact text in the Slack channel's Vehicle field (e.g. `NV200 #1`)

### NV200 #1 and NV200 #2 showing the same messages (or wrong vehicle's feed)
- The two vehicles must have different `slack_name` values in the database
- Run `node migrate-slack-names.js` and confirm the output shows distinct names per vehicle

### Port 80 forwarding stops working after a reboot (Windows 10)
- WSL2's internal IP changes on each boot — re-run the PowerShell port-forwarding script from Part 6
- Or switch to **mirrored networking** (Windows 11, Part 6 Option A) so this never happens

### Changes to the frontend aren't showing up
- You must rebuild after any client-side change: `cd client && npm run build`
- Hard-refresh the browser (`Ctrl+Shift+R`) to clear any cached files

### `npm run build` fails
- Make sure you're in the `client/` directory, not `server/`
- Run `npm install` first if you haven't yet or if packages changed
