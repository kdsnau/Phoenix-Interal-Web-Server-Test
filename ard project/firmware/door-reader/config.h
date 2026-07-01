#pragma once
/*
 * Per-door configuration. Register a door in the admin dashboard (Doors ->
 * Register), which mints a one-time reader_key, and paste DOOR_ID + READER_KEY
 * here. Point SERVER_HOST at the site gateway (or the dev backend for testing).
 */

// ---- identity (from the dashboard) ----
#define DOOR_ID      1
#define READER_KEY   "PASTE_64_HEX_CHAR_READER_KEY_FROM_THE_DASHBOARD"

// ---- gateway / backend on the LAN ----
#define SERVER_HOST  "192.168.10.224"   // gateway IP (or your dev PC for testing)
#define SERVER_PORT  4000

// ---- network ----
// Many W5500 shields print a MAC on a sticker; otherwise keep this unique per door.
#define MAC_BYTES    { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED }

// The Uno has no clock, but signed requests need real time -> NTP on boot.
#define NTP_HOST       "pool.ntp.org"
#define NTP_RESYNC_MS  3600000UL        // re-sync hourly

// ---- pins ----
// Avoid 10-13 (SPI) and 4 (SD CS) used by the Ethernet shield, and A4/A5 (I2C).
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

// Read phones (HCE) in addition to UID cards? Get cards working first, then turn
// this on — APDU reading over PN532 may need per-phone tuning on real hardware.
// #define ENABLE_PHONE_HCE

#define DEFAULT_UNLOCK_MS 4000

// If the gateway is unreachable AND the card isn't in the local fallback list:
//   false = deny (secure, recommended)   true = allow (fail-open)
#define FAIL_OPEN false
