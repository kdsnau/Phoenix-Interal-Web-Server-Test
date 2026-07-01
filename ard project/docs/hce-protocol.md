# Phone ⇄ Reader HCE protocol

The contract between the Android app (card emulation) and the door firmware
(NFC reader). Keep both sides in sync with this doc. Implemented on the phone in
`mobile/app/.../hce/Apdu.kt` + `DoorHceService.kt`; the firmware reader will
reproduce it.

## AID

```
F0 50 48 58 44 4F 4F 52      (F0 + "PHXDOOR", 8 bytes, F0 = proprietary)
```

Declared in `mobile/app/src/main/res/xml/apduservice.xml`. Android routes APDUs
for this AID to `DoorHceService`.

## Exchange (single round-trip — best for a quick tap)

1. Reader powers the field, does `InListPassiveTarget` (ISO 14443-A), then sends:

   ```
   SELECT AID:  00 A4 04 00 08  F0 50 48 58 44 4F 4F 52  00
   ```

2. Phone responds with the **current rotating token** as ASCII bytes + status:

   ```
   <token bytes…> 90 00
   ```

   where token = `public_id.exp.hmac` (see `backend/src/services/tokens.js`).
   Typical length ~55–60 bytes — fits a single APDU response.

3. If the phone has no fresh token loaded (app not opened recently / expired):

   ```
   69 85           (conditions not satisfied)  → reader treats as "no credential"
   ```

Optional: the reader may instead/also send `80 CA 00 00 00` (GET DATA); the phone
returns the same token response. Returning the token directly on SELECT keeps the
tap to one exchange, which is the most reliable over NFC.

## Reader-side validation

The reader takes the token bytes and validates them exactly like a physical card,
but for a phone:
- **Online:** `POST /api/reader/validate { type:"phone", token }` → backend verifies
  HMAC + expiry, runs the rule engine, returns allow/deny.
- **Offline:** verify the token's HMAC locally using the per-credential `token_key`
  from the last `/api/reader/sync` (the bundle's `phoneKeys`), check expiry, then
  apply the cached rules. Same logic as the backend's `verifyToken`.

## Why this is clone-resistant

The token is short-lived (default 180 s, `PHONE_TOKEN_TTL`). A captured tap is
useless once it expires, and the phone mints a new one before each expiry while it
has connectivity. Unlike a static UID card, there is no fixed secret on the wire.
