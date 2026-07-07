# Phoenix Door — Reader firmware

Two sketches for an **Arduino Uno + PN532 ("NFC Module V3")**:

| Sketch | Needs network? | Use it to |
|---|---|---|
| `door-reader-standalone/` | No | Test reader + lock wiring **today** with a local allow-list. |
| `door-reader/` | Yes (Ethernet shield) | The real thing: backend decides via `/api/reader/validate`, with offline fallback. |

Start with **standalone** to confirm the hardware, then move to **networked** once the
Ethernet shield arrives.

## Hardware

You have: Uno, PN532 (NFC Module V3), electronics kit (LEDs, resistors, buzzer,
jumpers, breadboard — and a relay or servo).

Still needed for the networked version + a real door:
- **W5500 Ethernet shield** (stacks on the Uno).
- **Electric strike or maglock** + a **12 V supply** + a **flyback diode** across the coil.
- **MIFARE 13.56 MHz cards/fobs** for non-phone users.
- A **5 V relay module** (if your kit doesn't have one) to switch the 12 V lock.

## Set the PN532 to I2C mode

The module has on-board DIP switches for HSU/I2C/SPI. **Set it to I2C** (the truth
table is printed on the board — typically `SEL0 = ON, SEL1 = OFF`). We use I2C so the
SPI bus stays free for the Ethernet shield.

## Wiring (same for both sketches)

PN532 (I2C) → Uno:

| PN532 | Classic Uno (AVR) | Uno Q / Uno R4 |
|---|---|---|
| VCC | 5V | 5V (or 3.3V) |
| GND | GND | GND |
| SDA | A4 | **`SDA` pin** (near AREF) — NOT A4 |
| SCL | A5 | **`SCL` pin** (near AREF) — NOT A5 |
| IRQ | D2 | D2 |
| RSTO / RST | D3 | D3 |

> **Important for the Uno Q / R4:** their default `Wire` I2C bus is on the dedicated
> `SDA`/`SCL` header pins, and A4/A5 are analog-only (not on I2C). Wiring SDA/SCL to
> A4/A5 on those boards gives "PN532 not found." (On the classic AVR Uno, A4/A5 *are*
> SDA/SCL, so either works there.) A Qwiic/STEMMA connector, if present, is a separate
> bus (`Wire1`).

Outputs:

| Part | Uno pin | Notes |
|---|---|---|
| Relay signal | D7 | switches the 12 V strike/maglock; add a flyback diode across the coil |
| Green LED (+resistor) | D5 | granted |
| Red LED (+resistor) | D6 | denied |
| Buzzer | D8 | active buzzer or passive (uses `tone()`) |
| Servo (optional) | D9 | only if you `#define USE_SERVO` instead of a relay |

The **Ethernet shield** stacks on top of the Uno and uses SPI (D10–D13) + D4 (SD). We
deliberately avoid those pins, so wire the PN532/LEDs/relay to the shield's pass-through
headers.

> Power note: don't drive a maglock/strike from the Uno's 5 V. Use a separate 12 V
> supply switched by the relay; share grounds.

## Libraries (Arduino IDE → Tools → Manage Libraries)

- **Adafruit PN532** (+ its dependency **Adafruit BusIO**) — both sketches
- **Crypto** by Rhys Weatherley (SHA256/HMAC) — networked only
- **Ethernet** (bundled with the IDE; supports the W5500) — networked only

## Standalone: test today

1. Open `door-reader-standalone/door-reader-standalone.ino`, select **Arduino Uno** +
   the right port, Upload.
2. Open Serial Monitor at **9600 baud**.
3. Tap a card — the UID prints and it's **DENIED** (not enrolled yet).
4. Type **`A`** + Enter to add that card. Tap again → **GRANTED**, the relay clicks /
   servo turns, green LED + happy beep.
5. `L` lists stored cards, `C` clears them. The list lives in EEPROM (survives power-off).

This proves the reader, lock, LEDs, and buzzer all work.

## Networked: the real reader

1. In the **admin dashboard → Doors → Register a door**. It shows a one-time
   **`reader_key`** and the **door id**.
2. Edit `door-reader/config.h`:
   - `DOOR_ID` and `READER_KEY` = the values from step 1.
   - `SERVER_HOST` = the **gateway** IP (or your dev PC, e.g. `192.168.10.224`), `SERVER_PORT` 4000.
3. Stack the Ethernet shield, open `door-reader/door-reader.ino`, Upload.
4. Tap an **enrolled** card (assign it to a user in the dashboard first). The reader
   signs `POST /api/reader/validate`, the backend runs the rule engine, and the door
   opens or not — and the tap shows up live on the **Activity** dashboard.

Staged bring-up (recommended — isolate problems one at a time):
1. Flash **`ethernet-test/ethernet-test.ino`** first. It does DHCP and GETs `/health`.
   When Serial shows `{"ok":true,...}`, the shield + LAN + backend are confirmed.
2. Then flash **`door-reader/door-reader.ino`**.

How it decides:
- **Time:** the reader has no clock, so it fetches unix time from
  `GET /api/reader/time` (no NTP/internet needed) to sign requests.
- **Online:** asks the backend/gateway each tap (authoritative). If unreachable it
  denies (`FAIL_OPEN=false`); the **site gateway** provides offline resilience in the
  full deployment, so the reader itself stays online-only and simple.
- **Phones:** set `#define ENABLE_PHONE_HCE` to also read a phone's rotating token over
  HCE (AID `F0504858444F4F52`, see `../docs/hce-protocol.md`). Get cards working first.

> On the **Uno Q**: PN532 I2C is on the dedicated `SDA`/`SCL` pins (not A4/A5); there's
> no AVR `EEPROM.h` (this sketch doesn't use it); and RAM is plentiful, so the classic
> "tight SRAM" caveat below doesn't apply.

### Verifying without a real door
The backend's `backend/tools/reader-sim.js` signs requests **identically** to this
firmware, and it's already proven against the live backend. So if a card is denied, you
can compare against `node tools/reader-sim.js validate --id <DOOR_ID> --key <READER_KEY>
--uid <UID>` to see whether it's the firmware or the data.

> Enroll cards using the **exact UID the reader reports** (from the standalone sketch's
> serial output) so byte order matches what the backend stores.

## Constraints

This pushes the Uno's 2 KB SRAM (Ethernet + PN532 + HMAC together). If it behaves oddly,
move to an **ESP32** — more RAM, built-in WiFi, and native TLS so it can talk to a cloud
backend directly. The code ports with minimal changes (swap Ethernet for WiFi).
