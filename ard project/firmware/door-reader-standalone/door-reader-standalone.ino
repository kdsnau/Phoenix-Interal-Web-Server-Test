/*
 * Phoenix Door — STANDALONE bench test
 * --------------------------------------------------------------------------
 * Runs on an Arduino Uno + PN532 ("NFC Module V3", I2C mode) with NO network.
 * Reads a card UID, checks it against a local allow-list in EEPROM, and drives
 * the lock + LEDs + buzzer. Use this to prove your reader and lock wiring work
 * before the Ethernet shield arrives. The networked firmware (door-reader/)
 * replaces the local allow-list with the backend's /validate decision.
 *
 * Serial console (9600 baud) commands — type the letter + Enter:
 *   A  add the last-scanned card to the allow-list
 *   C  clear the allow-list
 *   L  list stored UIDs
 *
 * Libraries (Arduino IDE -> Library Manager):
 *   - "Adafruit PN532"   (+ its dependency "Adafruit BusIO")
 *
 * Wiring: see ../README.md. PN532 in I2C mode (SDA=A4, SCL=A5, IRQ=D2, RST=D3).
 */
#include <Wire.h>
#include <Adafruit_PN532.h>
#include <Wire.h>
#include <Adafruit_PN532.h>

// Drop-in RAM Emulator for the Uno Q to bypass the missing EEPROM library
struct UnoQ_EEPROM_Emulator {
  uint8_t ramStorage[256] = {0}; 
  uint8_t read(int addr) { return ramStorage[addr]; }
  void update(int addr, uint8_t val) { ramStorage[addr] = val; }
  void write(int addr, uint8_t val) { ramStorage[addr] = val; }
};
UnoQ_EEPROM_Emulator EEPROM;

// ---- pins ----
#define PN532_IRQ    2
#define PN532_RESET  3
#define PIN_RELAY    7
#define LED_GREEN    5
#define LED_RED      6
#define PIN_BUZZER   8

// Use a servo as the "lock" instead of a relay? Uncomment + wire a servo to D9.
// #define USE_SERVO
#ifdef USE_SERVO
  #include <Servo.h>
  #define SERVO_PIN       9
  #define SERVO_LOCKED    20
  #define SERVO_UNLOCKED  110
  Servo lockServo;
#endif

const unsigned long UNLOCK_MS = 4000;

Adafruit_PN532 nfc(PN532_IRQ, PN532_RESET); // I2C

// ---- EEPROM allow-list: [0]=count, then records of [len][uid bytes] ----
#define EE_COUNT_ADDR 0
#define EE_BASE       1
#define EE_MAX        20
#define UID_MAX       7

uint8_t lastUid[UID_MAX];
uint8_t lastUidLen = 0;

// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(9600);
  pinMode(PIN_RELAY, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_RED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  lock();

#ifdef USE_SERVO
  lockServo.attach(SERVO_PIN);
  lockServo.write(SERVO_LOCKED);
#endif

  nfc.begin();
  uint32_t ver = nfc.getFirmwareVersion();
  if (!ver) {
    Serial.println(F("PN532 not found — check wiring + DIP switches (I2C mode)."));
    while (1) { digitalWrite(LED_RED, HIGH); delay(200); digitalWrite(LED_RED, LOW); delay(200); }
  }
  nfc.SAMConfig();
  Serial.print(F("Phoenix Door standalone ready. Stored cards: "));
  Serial.println(eeCount());
  Serial.println(F("Tap a card. Serial: A=add last, C=clear, L=list"));
}

void loop() {
  handleSerial();

  uint8_t uid[UID_MAX];
  uint8_t uidLen = 0;
  // 200ms timeout keeps the loop responsive to serial input
  if (nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLen, 200)) {
    memcpy(lastUid, uid, uidLen);
    lastUidLen = uidLen;

    Serial.print(F("Card: "));
    printUid(uid, uidLen);

    if (findUid(uid, uidLen) >= 0) {
      Serial.println(F("  -> GRANTED"));
      grant();
    } else {
      Serial.println(F("  -> DENIED (not enrolled; press A to add)"));
      deny();
    }
    delay(1200); // simple debounce so one tap = one decision
  }
}

// ---- outcomes -------------------------------------------------------------
void grant() {
  digitalWrite(LED_GREEN, HIGH);
  beep(1200, 120);
  unlock();
  unsigned long t0 = millis();
  while (millis() - t0 < UNLOCK_MS) { /* held open */ }
  lock();
  digitalWrite(LED_GREEN, LOW);
}

void deny() {
  digitalWrite(LED_RED, HIGH);
  beep(300, 400);
  digitalWrite(LED_RED, LOW);
}

void unlock() {
#ifdef USE_SERVO
  lockServo.write(SERVO_UNLOCKED);
#else
  digitalWrite(PIN_RELAY, HIGH);
#endif
}

void lock() {
#ifdef USE_SERVO
  lockServo.write(SERVO_LOCKED);
#else
  digitalWrite(PIN_RELAY, LOW);
#endif
}

void beep(unsigned int freq, unsigned int ms) {
  tone(PIN_BUZZER, freq, ms);
  delay(ms);
  noTone(PIN_BUZZER);
}

// ---- EEPROM allow-list ----------------------------------------------------
uint8_t eeCount() {
  uint8_t c = EEPROM.read(EE_COUNT_ADDR);
  return c > EE_MAX ? 0 : c;
}

int recordAddr(uint8_t index) { return EE_BASE + index * (1 + UID_MAX); }

int findUid(const uint8_t *uid, uint8_t len) {
  uint8_t n = eeCount();
  for (uint8_t i = 0; i < n; i++) {
    int a = recordAddr(i);
    if (EEPROM.read(a) != len) continue;
    bool match = true;
    for (uint8_t b = 0; b < len; b++) {
      if (EEPROM.read(a + 1 + b) != uid[b]) { match = false; break; }
    }
    if (match) return i;
  }
  return -1;
}

void addUid(const uint8_t *uid, uint8_t len) {
  if (len == 0) { Serial.println(F("No card scanned yet.")); return; }
  if (findUid(uid, len) >= 0) { Serial.println(F("Already enrolled.")); return; }
  uint8_t n = eeCount();
  if (n >= EE_MAX) { Serial.println(F("Allow-list full.")); return; }
  int a = recordAddr(n);
  EEPROM.update(a, len);
  for (uint8_t b = 0; b < len; b++) EEPROM.update(a + 1 + b, uid[b]);
  EEPROM.update(EE_COUNT_ADDR, n + 1);
  Serial.println(F("Enrolled."));
}

void clearAll() {
  EEPROM.update(EE_COUNT_ADDR, 0);
  Serial.println(F("Allow-list cleared."));
}

void listAll() {
  uint8_t n = eeCount();
  Serial.print(F("Stored cards: ")); Serial.println(n);
  for (uint8_t i = 0; i < n; i++) {
    int a = recordAddr(i);
    uint8_t len = EEPROM.read(a);
    uint8_t uid[UID_MAX];
    for (uint8_t b = 0; b < len && b < UID_MAX; b++) uid[b] = EEPROM.read(a + 1 + b);
    Serial.print(F("  ")); printUid(uid, len);
    Serial.println();
  }
}

// ---- serial + util --------------------------------------------------------
void handleSerial() {
  if (!Serial.available()) return;
  char c = Serial.read();
  switch (c) {
    case 'A': case 'a': addUid(lastUid, lastUidLen); break;
    case 'C': case 'c': clearAll(); break;
    case 'L': case 'l': listAll(); break;
    default: break; // ignore newlines/others
  }
}

void printUid(const uint8_t *uid, uint8_t len) {
  for (uint8_t i = 0; i < len; i++) {
    if (uid[i] < 0x10) Serial.print('0');
    Serial.print(uid[i], HEX);
  }
}
