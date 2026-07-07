# Phoenix Door Reader — Arduino UNO Q (App Lab app)

The UNO Q isn't a classic Arduino — its MCU runs a Zephyr core and networking lives
on its **Linux side**. So the reader is an **App Lab app** with two halves that run
together on the board:

- `sketch/sketch.ino` — **MCU**: reads the PN532 (I²C) + drives relay/LEDs/buzzer.
- `python/main.py` — **Linux**: HMAC-signs each tap and POSTs to the backend over
  WiFi, returning the unlock time to the MCU. (No shield, no NTP, no on-MCU crypto.)

They talk over the **RouterBridge**: the sketch does
`Bridge.call("check_access", uid).result(unlockMs)`; Python `Bridge.provide`s it.

## Config

Edit `python/main.py`:
- `DOOR_ID` / `READER_KEY` — from the dashboard (Doors → Register). Pre-filled with the
  "Bench Reader (Uno Q)" door.
- `BACKEND` — the PC hosting the backend (`http://192.168.10.224:4000`). If you later
  run the backend on the UNO Q itself, use `http://localhost:4000`.

## Moving + running it — WITHOUT the Arduino IDE

The UNO Q is a Debian computer on your WiFi. Two ways:

### A. Arduino App Lab (GUI) — easiest
Install **Arduino App Lab** (the UNO Q's tool; replaces the classic IDE), open this
folder as an App, and press **Run**. It builds the sketch, installs the Python deps,
flashes the MCU, and runs both halves.

### B. Command line over SSH — no IDE at all
The board runs `arduino-app-cli`. From this PC:

```bash
# 1. copy the app to the board (find its IP in your router or `arduino-app-cli`)
ssh arduino@<UNO_Q_IP> "mkdir -p ~/ArduinoApps/phoenix-door-reader"
scp -r ./* arduino@<UNO_Q_IP>:~/ArduinoApps/phoenix-door-reader/

# 2. build + deploy + run both halves
ssh arduino@<UNO_Q_IP>
arduino-app-cli app start ~/ArduinoApps/phoenix-door-reader

# 3. watch it (Python print()s appear here)
arduino-app-cli app logs ~/ArduinoApps/phoenix-door-reader

# stop
arduino-app-cli app stop ~/ArduinoApps/phoenix-door-reader
```

(You can also just `git clone` the repo directly onto the board and point the CLI at
`ard project/uno-q-reader`.)

## Test it

1. Host the backend on the PC (`.\host-stack.ps1`) and make sure the UNO Q's WiFi is on
   the same LAN (firewall already allows :4000).
2. Start the app, open the logs.
3. Tap your card. You'll see e.g. `[reader] 04A1B2C3 -> {'decision': 'denied', 'reason':
   'unknown_credential'}` — because that UID isn't assigned yet.
4. Copy the UID from the log → dashboard → **Users → demo → assign card** (paste it).
5. Tap again → `granted`, the relay fires, and the tap shows on the **Activity** dashboard.

## Notes

- The Python side reuses the exact signing verified by `backend/tools/reader-sim.js`, so
  the backend already accepts these requests.
- The RouterBridge call/result types may need a tiny tweak to match your installed
  library version (e.g. wrapping the UID as `String(hex)`); if the build complains, that's
  the first thing to adjust.
- This makes the UNO Q a **reader + gateway in one** — later the Linux side can cache
  credentials for offline use and sync to a central cloud (task #7), with `BACKEND` set
  to `localhost`.
