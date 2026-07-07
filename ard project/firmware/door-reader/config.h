#pragma once
/*
 * Per-door configuration. Values below are the "Bench Reader (Uno Q)" door
 * registered in the dashboard. Treat READER_KEY as a secret.
 */

// ---- identity (from the dashboard: Doors -> Register) ----
#define DOOR_ID      4
#define READER_KEY   "dfa2f19879c8967520efbbcff7b56dfca48a51014c9f5ce8628f00b47f5de0f6"

// ---- gateway / backend on the LAN ----
#define SERVER_HOST  "192.168.10.224"   // PC hosting the backend (host-stack.ps1)
#define SERVER_PORT  4000

// ---- network ----
// Many W5500 shields print a MAC on a sticker; keep this unique per door.
#define MAC_BYTES    { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED }

// The reader gets unix time from the backend (GET /api/reader/time) to sign
// requests — no NTP/internet needed. Re-sync interval:
#define TIME_RESYNC_MS  600000UL        // every 10 min

// ---- pins ----
// Ethernet Shield 2 uses SPI (ICSP) + D10 (W5500 CS) + D4 (SD CS). Keep clear of
// those. PN532 is on I2C (dedicated SDA/SCL pins on the Uno Q, NOT A4/A5).
#define PN532_IRQ    2
#define PN532_RESET  3
#define PIN_RELAY    7
#define LED_GREEN    5
#define LED_RED      6
#define PIN_BUZZER   8

// Drive a servo as the "lock" instead of a relay? Uncomment + wire servo to D9.
// #define USE_SERVO
#ifdef USE_SERVO
  #define SERVO_PIN       9
  #define SERVO_LOCKED    20
  #define SERVO_UNLOCKED  110
#endif

// Read phones (HCE) as well as UID cards? Get cards working first.
// #define ENABLE_PHONE_HCE

#define DEFAULT_UNLOCK_MS 4000

// If the backend/gateway is unreachable:
//   false = deny (secure, recommended)   true = allow (fail-open)
// (The site gateway provides the real offline allow-list; the reader itself is
//  online-only to keep it simple.)
#define FAIL_OPEN false
