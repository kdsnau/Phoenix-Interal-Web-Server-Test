# Phoenix NFC Door-Access System

A complete NFC door-access platform: physical UID cards + Android phones (as
digital cards via HCE), a rule engine for time/role-based access, scan-usage
tracking, and Arduino-based door readers.

## Components

| Folder       | What it is                          | Stack                     | Status |
|--------------|-------------------------------------|---------------------------|--------|
| `backend/`   | API, rule engine, token service     | Node/Express + Postgres   | ✅ built + tested |
| `admin-web/` | Admin dashboard (users/cards/rules) | React + Vite              | ✅ built + verified live |
| `mobile/`    | "Digital card" app                  | React Native              | ⏳ planned |
| `firmware/`  | Door reader (one per door)          | Arduino Uno + PN532       | ⏳ planned |
| `docs/`      | Parts list, wiring, provisioning    | —                         | ⏳ planned |

## How it works

- **Physical cards** present a fixed UID. Security comes from the backend
  allow-list + time rules + instant revocation + scan logging.
- **Android phones** present a short-lived **rotating token** over HCE
  (clone/replay-resistant). iPhones are management-only (Apple blocks HCE) and use
  a physical card.
- **Readers** check the backend live (authoritative) and fall back to a small
  cached allow-list when offline (**hybrid**). Readers authenticate with a
  per-door HMAC, so no TLS is required on the Arduino.

See `backend/README.md` to run the backend, and the approved plan for the full
architecture and build order.
