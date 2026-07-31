# Test environment on SATURN — isolated from production

Goal: run a full copy of the portal against a **copy** of the production database,
so testing never touches prod. Separate repo checkout + DB + port + pm2 process.

> **Confirm first:** which repo does this test env use?
> - **This repo (`PHX-APP`)** — has all our work (security fixes, mobile app UI,
>   seeds, gate). **FLATTENED** layout: `client/` and `server/` are at the repo root
>   (NOT the double-nested `phoenix-portal/phoenix-portal/` of the original repo).
>   Paths below assume this. **Recommended** — validates our changes on real data.
> - **Original `Phoenix-Interal-Web-Server-Test`** — mirrors current prod code
>   (our improvements are NOT in it), and it has no `test` branch. If you use this,
>   the double-nested paths from the original template apply instead.

## 1. Code
```bash
cd ~/Documents
git clone git@github.com:phxcams/PHX-APP.git PHXSECTEST-test
cd PHXSECTEST-test          # flattened: client/ and server/ are right here
git checkout test
npm --prefix server install
npm --prefix client install
```

## 2. Test database — a COPY of prod (prod is only READ)
```bash
sudo -u postgres createdb phoenix_portal_test
# If a backup exists:
sudo -u postgres pg_restore -d phoenix_portal_test ~/phoenix-backups/<latest>.dump
# No backup yet? Make one from the live DB first (pg_dump is read-only, safe):
#   sudo -u postgres pg_dump -Fc phoenix_portal > ~/phoenix-backups/prod-$(date +%F).dump
# (optional) add the perf indexes:
#   sudo -u postgres psql -d phoenix_portal_test -f server/db/perf_indexes.sql
```

## 3. server/.env — test values; BLANK every live integration
```bash
cat > server/.env <<'ENV'
PORT=5001
CLIENT_ORIGIN=http://phoenixportal.test
DB_HOST=localhost
DB_PORT=5432
DB_NAME=phoenix_portal_test
DB_USER=<test db user>
DB_PASSWORD=<test db password>
JWT_SECRET=<node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
# --- integrations BLANKED so test can't email / post to real services ---
SMTP_HOST=
SMTP_USER=
SMTP_PASS=
SLACK_TOKEN=
PROJECT_SLACK_CHANNEL_ID=
CS_CALLS_SLACK_CHANNEL=
GOOGLE_CALENDAR_ID=
GOOGLE_API_KEY=
GOOGLE_SERVICE_ACCOUNT_JSON=
RESEND_API_KEY=
# optional: fake the Slack-backed Calls/Projects pages with demo content
SLACK_MOCK=1
ENV
```

## 4. Build client (relative API) + start under pm2
```bash
echo 'VITE_API_URL=/api' > client/.env      # so it works behind the .test proxy
cd client && npm run build && cd ..
cd server && pm2 start index.js --name phoenix-portal-test && cd ..   # cwd=server so dotenv finds .env
pm2 save
```

## 5. nginx vhost
```nginx
# /etc/nginx/sites-available/phoenixportal.test  (symlink into sites-enabled)
server {
    listen 80;
    server_name phoenixportal.test;
    location / {
        proxy_pass http://localhost:5001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For  $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
```bash
sudo ln -s ../sites-available/phoenixportal.test /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## Guardrails
- `phoenixportal.test` only resolves after you add the host in the **UniFi** DNS.
- Fully isolated from prod: DB `phoenix_portal_test`, PORT `5001`, pm2 name
  `phoenix-portal-test` — nothing shared with production's `phoenix_portal` / :5000.
- NEVER put prod DB creds or live integration keys in this `.env`.
- Production is only ever READ (`pg_dump`); `pg_restore` writes only to `_test`.

## Corrections vs the original template
- Real repo URL + **flattened** path (the `phoenix-portal/phoenix-portal` path was
  for the original repo).
- `CLIENT_ORIGIN=` (the template had a `:` typo) + a complete `.env`, not 3 keys.
- `VITE_API_URL=/api` before the client build, else API calls break behind `.test`.
- pm2 started with `cwd=server` so `dotenv` loads `server/.env`.
- `createdb`/`pg_restore` run via `sudo -u postgres`.
