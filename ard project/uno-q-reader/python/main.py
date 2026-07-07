"""
Phoenix Door Reader — Linux (MPU) side.

The MCU sketch reads a card and calls check_access(uid) over the RouterBridge.
This side does the HMAC signing + HTTP POST to the backend (over WiFi) and returns
the unlock time (ms) to the MCU. Signing matches backend/src/util/readerSig.js
(and backend/tools/reader-sim.js), which is already verified against the backend.

Because networking lives here on Linux, there's no NTP/crypto to do on the MCU —
Python has a real clock and hashlib.
"""
from arduino.app_utils import *
import time, hmac, hashlib, json, requests

# ---- config: register a door in the dashboard (Doors -> Register) ----
DOOR_ID    = 4
READER_KEY = "dfa2f19879c8967520efbbcff7b56dfca48a51014c9f5ce8628f00b47f5de0f6"

# Backend base URL. Point at the PC hosting it now; later, if you run the backend
# ON the UNO Q's Linux side (it becomes its own gateway), use http://localhost:4000.
BACKEND    = "http://192.168.10.224:4000"


def check_access(kind, value):
    """Called by the MCU on each tap. `kind` is "uid_card" or "phone".
    Returns unlock_ms (>0 = grant, 0 = deny)."""
    if kind == "phone":
        body = json.dumps({"type": "phone", "token": value}, separators=(",", ":"))
    else:
        body = json.dumps({"type": "uid_card", "uid": value}, separators=(",", ":"))
    ts = int(time.time())
    base = f"POST\n/validate\n{ts}\n{body}"
    sig = hmac.new(READER_KEY.encode(), base.encode(), hashlib.sha256).hexdigest()
    headers = {
        "Content-Type": "application/json",
        "X-Reader-Id": str(DOOR_ID),
        "X-Reader-Timestamp": str(ts),
        "X-Reader-Signature": sig,
    }
    try:
        r = requests.post(f"{BACKEND}/api/reader/validate", data=body, headers=headers, timeout=4)
        j = r.json()
        print(f"[reader] {kind} {value} -> {j}")
        if j.get("decision") == "granted":
            return int(j.get("unlock_ms") or 4000)
        return 0
    except Exception as e:
        print(f"[reader] validate error: {e}")
        return 0  # fail-secure: deny if the backend can't be reached


# Expose check_access so the MCU sketch can call it.
Bridge.provide("check_access", check_access)


def loop():
    time.sleep(1)


App.run(user_loop=loop)
