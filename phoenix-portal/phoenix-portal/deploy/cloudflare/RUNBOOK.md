# Publish Phoenix Portal to `phoenix.f9ndthetruth.com` (SATURN → Cloudflare)

Exposes the internal portal (already running on SATURN behind nginx) to a public,
access-controlled hostname, mirroring the Vault tile pattern. **Data stays on
SATURN** — the tunnel only forwards HTTPS to SATURN's nginx.

Do this **on SATURN** (office LAN, via RustDesk/SSH). Requires access to the
Cloudflare account that owns the `f9ndthetruth.com` zone.

## 1. Install cloudflared
```bash
# Cloudflare apt repo (same as the droplet)
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared
```

## 2. Create the tunnel + DNS
```bash
cloudflared tunnel login                 # authorize the f9ndthetruth.com zone in the browser
cloudflared tunnel create phxportal      # prints a UUID + writes ~/.cloudflared/<UUID>.json
cloudflared tunnel route dns phxportal phoenix.f9ndthetruth.com   # creates the CNAME
```

## 3. Config + service
```bash
# From this repo on SATURN:
cp deploy/cloudflare/config.yml ~/.cloudflared/config.yml
sed -i "s/<UUID>/PASTE_TUNNEL_UUID_HERE/" ~/.cloudflared/config.yml
sudo cp deploy/cloudflare/phxportal-tunnel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now phxportal-tunnel
systemctl status phxportal-tunnel --no-pager
```

## 4. Cloudflare Access (edge auth — the "opens securely" gate)
Zero Trust dashboard → Access → Applications → **Add** a self-hosted app:
- Application domain: `phoenix.f9ndthetruth.com`
- Policy: same allowed emails as the Vault app (Google/one-time-PIN, your choice).

## 5. Server config on SATURN
- `server/.env`: add the new origin to CORS →
  `CLIENT_ORIGIN=http://phxportal.internal,https://phoenix.f9ndthetruth.com`
  (confirm the code reads a comma list; otherwise set it to the public origin.)
- Confirm the client was built with a **relative** API base (`VITE_API_URL` empty →
  client uses `/api`). An absolute `localhost:5000` build will break behind the tunnel.
  Rebuild if needed: `cd client && npm run build`.
- nginx: ensure `server_name` includes `phoenix.f9ndthetruth.com` (or is default_server).
- **Slack integration (real data — SATURN only, NOT the public demo):** to make the
  Projects and Calls pages show live Slack data, set in `server/.env`:
  ```
  SLACK_TOKEN=xoxb-...                    # bot token with conversations.history scope
  PROJECT_SLACK_CHANNEL_ID=C...           # #project-reports channel id
  CS_CALLS_SLACK_CHANNEL=C...             # calls channel id
  ```
  Leave **`SLACK_MOCK` unset** here — it is only for the public demo (fabricated
  data). With `SLACK_MOCK=1` set, the mock feed overrides any real token.
- `pm2 restart phoenix-portal`

## 6. Verify
```bash
curl -sI https://phoenix.f9ndthetruth.com    # expect Cloudflare Access redirect (302) then app
```
Then in a browser: Access login → portal login → real SATURN data.

## Notes
- The f9nd **Phoenix tile is already deployed** and points here; it stays a dead
  link only until this runbook is complete.
- Auth is two layers, like Vault: Cloudflare Access (edge) + the portal's own JWT login.
- Portal uses JWT in localStorage + `Authorization` header (no cross-site cookies),
  so the new domain needs no SameSite/cookie changes.
