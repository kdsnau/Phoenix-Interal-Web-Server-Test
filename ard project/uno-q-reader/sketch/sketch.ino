/*
 * Phoenix Door Reader — MCU (Arduino/Zephyr) side.
 *
 * Reads a card UID from the PN532 (I2C) and asks the Linux side to decide via
 * the RouterBridge: Bridge.call("check_access", uid).result(unlockMs). The Python
 * side does the HMAC + HTTP to the backend and returns unlock_ms (>0 = grant).
 * This half just does the real-time I/O: NFC read + relay/LED/buzzer.
 *
 * Wiring (Uno Q): PN532 on I2C -> dedicated SDA/SCL pins (NOT A4/A5), IRQ->D2,
 * RST->D3. Relay D7, green LED D5, red LED D6, buzzer D8.
 */
#include "Arduino_RouterBridge.h"
#include <Arduino_LED_Matrix.h>
#include <Wire.h>
#include <Adafruit_PN532.h>

#define PN532_IRQ    2
#define PN532_RESET  3
#define PIN_RELAY    7
#define LED_GREEN    5
#define LED_RED      6
#define PIN_BUZZER   8
#define UID_MAX      7

Adafruit_PN532 nfc(PN532_IRQ, PN532_RESET); // I2C

// Onboard 8x13 LED matrix (driven by the UNO Q's STM32; no wiring needed).
Arduino_LED_Matrix matrix;
static const uint8_t MX_ROWS = 8;
static const uint8_t MX_COLS = 13;
uint8_t mxFrame[MX_ROWS * MX_COLS]; // 104 bytes

void matrixFill(uint8_t v) {
  for (int i = 0; i < MX_ROWS * MX_COLS; i++) mxFrame[i] = v;
  matrix.draw(mxFrame);
}

void setup() {
  Serial.begin(9600);
  pinMode(PIN_RELAY, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_RED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_RELAY, LOW);

  Bridge.begin();

  matrix.begin();
  matrix.setGrayscaleBits(8);
  matrixFill(0); // start dark

  nfc.begin();
  if (!nfc.getFirmwareVersion()) {
    // PN532 not found — blink red forever (check I2C wiring + DIP=I2C).
    while (1) { digitalWrite(LED_RED, HIGH); delay(200); digitalWrite(LED_RED, LOW); delay(200); }
  }
  nfc.SAMConfig();
  Serial.println("Reader ready.");
}

void loop() {
  uint8_t uid[UID_MAX];
  uint8_t uidLen = 0;
  if (!nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLen, 250)) return;

  matrixFill(255); // light the whole matrix the moment a card/phone is scanned

  // A phone (HCE) presents a rotating token behind a SELECT-AID exchange; a plain
  // card only has a UID (and, in HCE, a random one that changes every tap). Try the
  // phone path first; fall back to the card UID.
  char value[80];
  const char *kind;
  if (readPhoneToken(value, sizeof(value))) {
    kind = "phone";
    Serial.print("Phone token: "); Serial.println(value);
  } else {
    toHex(uid, uidLen, value);
    kind = "uid_card";
    Serial.print("Card UID: "); Serial.println(value);
  }

  // Ask the Linux side to validate over the network. Blocks until it answers.
  int unlockMs = 0;
  Bridge.call("check_access", kind, value).result(unlockMs);

  if (unlockMs > 0) {
    digitalWrite(LED_GREEN, HIGH);
    beep(1200, 120);
    digitalWrite(PIN_RELAY, HIGH);
    unsigned long t0 = millis();
    while (millis() - t0 < (unsigned long)unlockMs) { /* held open */ }
    digitalWrite(PIN_RELAY, LOW);
    digitalWrite(LED_GREEN, LOW);
  } else {
    digitalWrite(LED_RED, HIGH);
    beep(300, 400);
    digitalWrite(LED_RED, LOW);
  }
  delay(1200);     // debounce
  matrixFill(0);   // matrix off until the next scan
}

// Read a phone's rotating token over HCE: SELECT our AID; the app's HostApduService
// answers with <token ascii> 90 00. Returns false for a plain card (no such AID).
bool readPhoneToken(char *out, int outCap) {
  uint8_t selectAid[] = {0x00, 0xA4, 0x04, 0x00, 0x08,
                         0xF0, 0x50, 0x48, 0x58, 0x44, 0x4F, 0x4F, 0x52, 0x00};
  uint8_t resp[80];
  uint8_t respLen = sizeof(resp);
  if (!nfc.inDataExchange(selectAid, sizeof(selectAid), resp, &respLen)) return false;
  if (respLen < 4) return false;                        // need token + 90 00
  if (resp[respLen - 2] != 0x90 || resp[respLen - 1] != 0x00) return false;
  int tokLen = respLen - 2;
  if (tokLen >= outCap) tokLen = outCap - 1;
  memcpy(out, resp, tokLen);
  out[tokLen] = 0;
  return true;
}

void beep(unsigned int freq, unsigned int ms) {
  tone(PIN_BUZZER, freq, ms);
  delay(ms);
  noTone(PIN_BUZZER);
}

void toHex(const uint8_t *b, uint8_t len, char *out) {
  const char *h = "0123456789ABCDEF";
  for (uint8_t i = 0; i < len; i++) { out[i * 2] = h[b[i] >> 4]; out[i * 2 + 1] = h[b[i] & 0x0F]; }
  out[len * 2] = 0;
}
