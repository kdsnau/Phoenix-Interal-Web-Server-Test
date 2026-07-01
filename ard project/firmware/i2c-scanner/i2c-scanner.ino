/*
 * I2C scanner — diagnostic for the PN532 wiring.
 * Upload this, open Serial Monitor at 9600. It lists every I2C device address.
 * A PN532 in I2C mode answers at 0x24.
 *
 *   sees "0x24"            -> wiring + power + DIP(I2C) are GOOD; the issue is the
 *                            reader sketch / IRQ pin / card, not the breadboard.
 *   "No I2C devices found" -> it's the breadboard: SDA/SCL swapped or loose, no
 *                            power, or the module DIP switches aren't in I2C mode.
 *
 * Wiring being tested: PN532 SDA->A4, SCL->A5, VCC->5V, GND->GND (IRQ/RST not
 * needed for this test).
 */
#include <Wire.h>

void setup() {
  Serial.begin(9600);
  delay(1500);             // give the USB/serial bridge a moment (Uno Q friendly)
  Wire.begin();
  Serial.println(F("I2C scanner ready. Scanning every 2s..."));
}

void loop() {
  byte count = 0;
  for (byte addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.print(F("  found device at 0x"));
      if (addr < 16) Serial.print('0');
      Serial.println(addr, HEX);
      count++;
    }
  }
  if (count == 0) Serial.println(F("  No I2C devices found — check SDA/SCL, power, DIP=I2C."));
  else { Serial.print(count); Serial.println(F(" device(s). (PN532 should be 0x24)")); }
  Serial.println();
  delay(2000);
}
