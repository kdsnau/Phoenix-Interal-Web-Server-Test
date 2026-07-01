/*
 * Phoenix Door — NETWORKED reader firmware
 * --------------------------------------------------------------------------
 * Arduino Uno + W5500 Ethernet shield + PN532 ("NFC Module V3", I2C).
 * Reads a card UID (and optionally a phone token over HCE), asks the site
 * gateway/backend to decide via POST /api/reader/validate (HMAC-signed exactly
 * like backend/tools/reader-sim.js, so the server already accepts it), and
 * drives the lock. Falls back to a small local EEPROM allow-list if the gateway
 * is unreachable (hybrid).
 *
 * Libraries (Arduino IDE -> Library Manager):
 *   - "Adafruit PN532"  (+ "Adafruit BusIO")
 *   - "Crypto"          by Rhys Weatherley  (SHA256 / HMAC)
 *   - Ethernet          (bundled; supports the W5500 shield)
 *
 * NOTE: this is at the edge of the Uno's 2 KB SRAM. If it's unstable, move to an
 * ESP32 (more RAM, WiFi, native TLS) — the code ports with minimal changes.
 *
 * Wiring + DIP switches + setup: see ../README.md.
 */
#include <SPI.h>
#include <Ethernet.h>
#include <EthernetUdp.h>
#include <Wire.h>
#include <Adafruit_PN532.h>
#include <Crypto.h>
#include <SHA256.h>
#include <EEPROM.h>
#include "config.h"

Adafruit_PN532 nfc(PN532_IRQ, PN532_RESET); // I2C
EthernetClient client;
EthernetUDP udp;
byte mac[] = MAC_BYTES;

// clock: unix seconds = ntpEpoch + (millis() - ntpAtMillis)/1000
unsigned long ntpEpoch = 0;
unsigned long ntpAtMillis = 0;
unsigned long lastNtp = 0;

// EEPROM offline allow-list (same layout as the standalone sketch)
#define EE_COUNT_ADDR 0
#define EE_BASE       1
#define EE_MAX        20
#define UID_MAX       7

// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(9600);
  pinMode(PIN_RELAY, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_RED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  lockDoor();

  Serial.println(F("Phoenix Door reader booting..."));
  if (Ethernet.begin(mac) == 0) {
    Serial.println(F("DHCP failed — check the Ethernet shield/cable."));
  } else {
    Serial.print(F("IP: ")); Serial.println(Ethernet.localIP());
  }
  udp.begin(8888);
  ntpSync();

  nfc.begin();
  if (!nfc.getFirmwareVersion()) {
    Serial.println(F("PN532 not found — check wiring + DIP (I2C)."));
    while (1) blinkErr();
  }
  nfc.SAMConfig();
  Serial.println(F("Ready."));
}

void loop() {
  if (millis() - lastNtp > NTP_RESYNC_MS) ntpSync();
  Ethernet.maintain(); // renew DHCP lease

  uint8_t uid[UID_MAX];
  uint8_t uidLen = 0;
  if (!nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLen, 250)) return;

  char uidHex[2 * UID_MAX + 1];
  toHex(uid, uidLen, uidHex);
  Serial.print(F("Tag: ")); Serial.println(uidHex);

  // Build the validate request body (UID card, or a phone token if present).
  char body[80];
#ifdef ENABLE_PHONE_HCE
  char token[72];
  if (readPhoneToken(token, sizeof(token))) {
    snprintf(body, sizeof(body), "{\"type\":\"phone\",\"token\":\"%s\"}", token);
  } else
#endif
  {
    snprintf(body, sizeof(body), "{\"type\":\"uid_card\",\"uid\":\"%s\"}", uidHex);
  }

  unsigned long unlockMs = DEFAULT_UNLOCK_MS;
  int decision = validateOnline(body, unlockMs); // 1 grant, 0 deny, -1 unreachable

  if (decision < 0) {
    // gateway unreachable -> local fallback
    bool cached = eepromFindUid(uid, uidLen) >= 0;
    decision = (cached || FAIL_OPEN) ? 1 : 0;
    Serial.print(F("OFFLINE -> ")); Serial.println(decision ? F("granted (cache)") : F("denied"));
  }

  if (decision == 1) grant(unlockMs); else deny();
  delay(1200); // debounce
}

// ---- decision over the network -------------------------------------------
// Returns 1 granted, 0 denied, -1 unreachable. Sets unlockMs on grant.
int validateOnline(const char *body, unsigned long &unlockMs) {
  unsigned long ts = unixNow();
  if (ts == 0) return -1; // no valid clock yet -> can't sign

  // base string MUST match backend/src/util/readerSig.js exactly
  char base[160];
  snprintf(base, sizeof(base), "POST\n/validate\n%lu\n%s", ts, body);
  char sig[65];
  hmacHex(READER_KEY, base, sig);

  if (!client.connect(SERVER_HOST, SERVER_PORT)) {
    client.stop();
    return -1;
  }
  client.print(F("POST /api/reader/validate HTTP/1.1\r\nHost: "));
  client.print(F(SERVER_HOST));
  client.print(F("\r\nContent-Type: application/json\r\nContent-Length: "));
  client.print(strlen(body));
  client.print(F("\r\nX-Reader-Id: "));
  client.print(DOOR_ID);
  client.print(F("\r\nX-Reader-Timestamp: "));
  client.print(ts);
  client.print(F("\r\nX-Reader-Signature: "));
  client.print(sig);
  client.print(F("\r\nConnection: close\r\n\r\n"));
  client.print(body);

  int decision = parseResponse(unlockMs);
  client.stop();
  return decision;
}

// Skip HTTP headers, then scan the small JSON body for the decision.
int parseResponse(unsigned long &unlockMs) {
  // wait for the response to start
  unsigned long t0 = millis();
  while (!client.available() && millis() - t0 < 4000) { /* wait */ }

  // skip headers: read until "\r\n\r\n"
  int nl = 0;
  t0 = millis();
  while (millis() - t0 < 4000) {
    if (!client.available()) { if (!client.connected()) return -1; continue; }
    char c = client.read();
    if (c == '\r') continue;
    if (c == '\n') { if (++nl >= 2) break; } else nl = 0;
  }

  // read the JSON body (small)
  char bd[96];
  int n = 0;
  t0 = millis();
  while ((client.connected() || client.available()) && n < (int)sizeof(bd) - 1 && millis() - t0 < 4000) {
    if (client.available()) bd[n++] = client.read();
  }
  bd[n] = 0;

  int decision;
  if (strstr(bd, "\"granted\"")) decision = 1;
  else if (strstr(bd, "\"denied\"")) decision = 0;
  else return -1;

  char *p = strstr(bd, "unlock_ms");
  if (p) {
    p = strchr(p, ':');
    if (p) {
      unsigned long v = strtoul(p + 1, NULL, 10);
      if (v > 0) unlockMs = v;
    }
  }
  return decision;
}

// ---- HMAC-SHA256 -> lowercase hex (65-char buffer) ------------------------
void hmacHex(const char *key, const char *msg, char *out) {
  SHA256 sha;
  size_t keyLen = strlen(key);
  sha.resetHMAC(key, keyLen);
  sha.update((const uint8_t *)msg, strlen(msg));
  uint8_t macOut[32];
  sha.finalizeHMAC(key, keyLen, macOut, sizeof(macOut));
  const char *hexd = "0123456789abcdef";
  for (int i = 0; i < 32; i++) {
    out[i * 2]     = hexd[macOut[i] >> 4];
    out[i * 2 + 1] = hexd[macOut[i] & 0x0F];
  }
  out[64] = 0;
}

// ---- time (NTP) -----------------------------------------------------------
unsigned long unixNow() {
  if (ntpEpoch == 0) return 0;
  return ntpEpoch + (millis() - ntpAtMillis) / 1000;
}

void ntpSync() {
  byte pkt[48];
  memset(pkt, 0, sizeof(pkt));
  pkt[0] = 0b11100011; // LI, version, mode
  if (udp.beginPacket(NTP_HOST, 123) == 0) { lastNtp = millis(); return; }
  udp.write(pkt, sizeof(pkt));
  udp.endPacket();

  unsigned long t0 = millis();
  while (millis() - t0 < 1500) {
    if (udp.parsePacket() >= 48) {
      udp.read(pkt, sizeof(pkt));
      unsigned long secs1900 = ((unsigned long)pkt[40] << 24) | ((unsigned long)pkt[41] << 16) |
                               ((unsigned long)pkt[42] << 8) | (unsigned long)pkt[43];
      ntpEpoch = secs1900 - 2208988800UL; // 1900 -> 1970
      ntpAtMillis = millis();
      lastNtp = millis();
      Serial.print(F("NTP epoch: ")); Serial.println(ntpEpoch);
      return;
    }
  }
  lastNtp = millis();
  Serial.println(F("NTP sync failed (will retry)."));
}

#ifdef ENABLE_PHONE_HCE
// Select our HCE AID and read the rotating token the phone returns.
// Token response = <ascii token bytes> 90 00. Returns true if a token was read.
bool readPhoneToken(char *out, int outCap) {
  uint8_t selectAid[] = {0x00, 0xA4, 0x04, 0x00, 0x08,
                         0xF0, 0x50, 0x48, 0x58, 0x44, 0x4F, 0x4F, 0x52, 0x00};
  uint8_t resp[80];
  uint8_t respLen = sizeof(resp);
  if (!nfc.inDataExchange(selectAid, sizeof(selectAid), resp, &respLen)) return false;
  if (respLen < 4) return false;                       // need token + 9000
  if (resp[respLen - 2] != 0x90 || resp[respLen - 1] != 0x00) return false;
  int tokLen = respLen - 2;
  if (tokLen >= outCap) tokLen = outCap - 1;
  memcpy(out, resp, tokLen);
  out[tokLen] = 0;
  return true;
}
#endif

// ---- EEPROM offline allow-list (populate via the standalone sketch) -------
int eepromFindUid(const uint8_t *uid, uint8_t len) {
  uint8_t count = EEPROM.read(EE_COUNT_ADDR);
  if (count > EE_MAX) return -1;
  for (uint8_t i = 0; i < count; i++) {
    int a = EE_BASE + i * (1 + UID_MAX);
    if (EEPROM.read(a) != len) continue;
    bool match = true;
    for (uint8_t b = 0; b < len; b++)
      if (EEPROM.read(a + 1 + b) != uid[b]) { match = false; break; }
    if (match) return i;
  }
  return -1;
}

// ---- actuation + feedback -------------------------------------------------
void grant(unsigned long unlockMs) {
  Serial.println(F("GRANTED"));
  digitalWrite(LED_GREEN, HIGH);
  beep(1200, 120);
  unlockDoor();
  unsigned long t0 = millis();
  while (millis() - t0 < unlockMs) { /* held open */ }
  lockDoor();
  digitalWrite(LED_GREEN, LOW);
}

void deny() {
  Serial.println(F("DENIED"));
  digitalWrite(LED_RED, HIGH);
  beep(300, 400);
  digitalWrite(LED_RED, LOW);
}

void unlockDoor() {
#ifdef USE_SERVO
  // servo handled by the standalone sketch's pattern; relay is the default here
#endif
  digitalWrite(PIN_RELAY, HIGH);
}

void lockDoor() {
  digitalWrite(PIN_RELAY, LOW);
}

void beep(unsigned int freq, unsigned int ms) {
  tone(PIN_BUZZER, freq, ms);
  delay(ms);
  noTone(PIN_BUZZER);
}

void blinkErr() {
  digitalWrite(LED_RED, HIGH); delay(200);
  digitalWrite(LED_RED, LOW);  delay(200);
}

void toHex(const uint8_t *b, uint8_t len, char *out) {
  const char *hexd = "0123456789ABCDEF";
  for (uint8_t i = 0; i < len; i++) {
    out[i * 2]     = hexd[b[i] >> 4];
    out[i * 2 + 1] = hexd[b[i] & 0x0F];
  }
  out[len * 2] = 0;
}
