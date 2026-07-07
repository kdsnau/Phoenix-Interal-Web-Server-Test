/*
 * Ethernet test — flash this BEFORE the full reader to confirm the Ethernet
 * Shield 2 (W5500) + your LAN + the backend all work on the Uno Q.
 * It gets a DHCP address, then GETs /health from the backend and prints the reply.
 *
 * Expected Serial (9600): an IP, then a response containing
 *   {"ok":true,"service":"phx-door-backend"}
 *
 * Library: "Ethernet" (Arduino IDE -> Library Manager; the W5500 shield uses it).
 */
#include <SPI.h>
#include <Ethernet.h>

byte mac[]        = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED };
const char *host  = "192.168.10.224";   // your PC hosting the backend
const int   port  = 4000;

EthernetClient client;

void setup() {
  Serial.begin(9600);
  delay(1500);
  Serial.println(F("Ethernet test: requesting DHCP..."));

  if (Ethernet.begin(mac) == 0) {
    Serial.println(F("DHCP failed."));
    if (Ethernet.hardwareStatus() == EthernetNoHardware)
      Serial.println(F("  -> No shield detected (SPI/seating/library)."));
    else if (Ethernet.linkStatus() == LinkOFF)
      Serial.println(F("  -> Ethernet cable not plugged in / no link."));
    return;
  }
  Serial.print(F("Got IP: "));
  Serial.println(Ethernet.localIP());

  Serial.print(F("GET http://")); Serial.print(host);
  Serial.print(':'); Serial.print(port); Serial.println(F("/health"));

  if (client.connect(host, port)) {
    client.println(F("GET /health HTTP/1.1"));
    client.print(F("Host: ")); client.println(host);
    client.println(F("Connection: close"));
    client.println();
  } else {
    Serial.println(F("Connect FAILED — backend up? same LAN? firewall allows 4000?"));
  }
}

void loop() {
  while (client.available()) Serial.write(client.read());
  if (!client.connected()) {
    client.stop();
    Serial.println(F("\n[done] If you saw {\"ok\":true...}, the shield + LAN work."));
    while (true) { delay(1000); }
  }
}
