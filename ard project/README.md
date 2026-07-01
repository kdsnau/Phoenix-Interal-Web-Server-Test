# Phoenix NFC Door-Access System

A complete NFC door-access platform: physical UID cards + Android phones (as
digital cards via HCE), a rule engine for time/role-based access, scan-usage
tracking, and Arduino-based door readers.

## Components

| Folder       | What it is                          | Stack                     | Status |
|--------------|-------------------------------------|---------------------------|--------|
| `backend/`   | API, rule engine, token service     | Node/Express + Postgres   | ✅ built + tested |
| `admin-web/` | Admin dashboard (users/cards/rules) | React + Vite              | ✅ built + verified live |
| `mobile/`    | "Digital card" app (HCE)            | Android / Kotlin + Compose | ✅ built + APK + tests |
| `firmware/`  | Door reader (one per door)          | Arduino Uno + PN532       | ✅ written (standalone runs now; networked contract verified) |
| `gateway/`   | Per-site cloud-sync gateway         | Node (reuses backend)     | ⏳ planned |
| `docs/`      | Parts list, wiring, provisioning    | —                         | ✅ in progress |

## How it works

- **Physical cards** present a fixed UID. Security comes from the backend
  allow-list + time rules + instant revocation + scan logging.
- **Android phones** present a short-lived **rotating token** over HCE
  (clone/replay-resistant). iPhones are management-only (Apple blocks HCE) and use
  a physical card.
- **Readers** check their **site gateway** live (authoritative) over the LAN and
  fall back to a small cached allow-list when offline (**hybrid**). Readers
  authenticate with a per-door HMAC, so no TLS is required on the Arduino.

## Deployment (hybrid)

- **Central cloud backend** serves the phone app + admin dashboard over HTTPS —
  one app for every client, users just log in (no server address to type).
- **A small gateway per site** (e.g. a Raspberry Pi) talks to the Uno readers on
  the LAN (HTTP + HMAC) and syncs credentials/rules down and scan events up to the
  cloud. Doors keep opening even if the internet drops. The gateway can run this
  same Node backend in a "gateway mode," so the reader API is unchanged.

See `backend/README.md` to run the backend, and the approved plan for the full
architecture and build order.
