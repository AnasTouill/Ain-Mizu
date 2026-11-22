// Physarum-Grid - irrigation controller for Wokwi (ESP32, Arduino code)
//
// Same feature as the platform's controller:
//   4 valves (green LEDs V1..V4)  = the 4 parcels of the farm
//   4 RGB lights (NeoPixel P1..P4) = class of each parcel, same colours as the website map
//   pump (relay + blue LED)        = refused with every valve closed or an empty tank
//   4 moisture sensors (knobs H1..H4), water tank level (slider CUVE)
//   buzzer alarm                   = a parcel is dry (red) but its valve is closed
//   LCD 16x2 (I2C) + Serial Monitor (type the same commands the website sends)
//
// Controls:  MODE switch -> AUTO (the board waters parcels below 40 %) or MANUEL
//            V1..V4 buttons open / close a valve, POMPE button starts / stops the pump (MANUEL)
// Serial commands (end with Enter):  V1:1  V1:0 ... V4:1  P1  P0  S?  HELP
//
// Website link: leave PLATFORM_URL empty to run standalone. To connect the website later, put the
// public URL of the backend (see README) - the board then sends its sensors every 2 s and applies
// the pump / valve orders chosen on the website (in MANUEL mode).

#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Adafruit_NeoPixel.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

// ===================================================== website link (later)
const char *WIFI_SSID = "Wokwi-GUEST";        // Wokwi's simulated Wi-Fi with internet access
const char *WIFI_PASS = "";
const char *PLATFORM_URL = "https://brake-pendant-hypothetical-cubic.trycloudflare.com";                // e.g. "https://abc-123.trycloudflare.com"   ("" = standalone)

// ===================================================== pins (see diagram.json)
LiquidCrystal_I2C lcd(0x27, 16, 2);            // SDA = 21, SCL = 22

const int N = 4;
const int VALVE[N] = {25, 26, 27, 14};         // valve LEDs
const int MOIST[N] = {34, 35, 36, 39};         // moisture knobs (ADC1, works with Wi-Fi on)
const int BTN[N + 1] = {4, 5, 18, 15, 19};     // V1, V2, V3, V4, POMPE (to GND, internal pull-up)
const int PUMP = 13;                           // relay module IN (relay switches the pump LED)
const int MODE_SW = 23;                        // slide switch: LOW = AUTO
const int PIXELS = 2;                          // NeoPixel chain DIN (4 RGB lights)
const int BUZZER = 32;                         // dry-soil alarm
const int TANK = 33;                           // slide potentiometer: water tank level

const int DRY_PCT = 40;                        // AUTO waters parcels below this moisture
const int TANK_MIN = 10;                       // pump refused / stopped below this tank level (%)

Adafruit_NeoPixel strip(N, PIXELS, NEO_GRB + NEO_KHZ800);
// class colours of the website: vert, jaune, orange, rouge
const uint8_t CLS_RGB[4][3] = {{46, 158, 79}, {242, 194, 48}, {240, 138, 36}, {214, 47, 47}};

bool valves[N] = {false, false, false, false};
bool pump = false;
bool autoPrev = false;
bool linked = false;
bool tankLowPrev = false;
String buf;
int lastPct[N] = {-100, -100, -100, -100};
int lastTank = -100;
int btnLast[N + 1];
unsigned long btnSince[N + 1];
bool btnFired[N + 1];
unsigned long lastAuto = 0, lastLcd = 0, lastSensors = 0, lastSync = 0, lastBeep = 0, lastPixels = 0;

// ===================================================== helpers
bool isAuto() { return digitalRead(MODE_SW) == LOW; }
int pctOf(int i) { return map(analogRead(MOIST[i]), 0, 4095, 0, 100); }
int tankPct() { return map(analogRead(TANK), 0, 4095, 0, 100); }
int clsIdx(int pct) {                          // same classes as the website
  if (pct >= 60) return 0;                     // vert   : no water needed
  if (pct >= 40) return 1;                     // jaune  : starting to need water
  if (pct >= 25) return 2;                     // orange : should be watered
  return 3;                                    // rouge  : dry, high risk
}
char clsOf(int pct) { return "VJOR"[clsIdx(pct)]; }
bool dryAndClosed(int i) { return clsIdx(pctOf(i)) == 3 && !valves[i]; }   // alarm condition
bool anyOpen() {
  for (int i = 0; i < N; i++) if (valves[i]) return true;
  return false;
}
void apply() {
  for (int i = 0; i < N; i++) digitalWrite(VALVE[i], valves[i] ? HIGH : LOW);
  digitalWrite(PUMP, pump ? HIGH : LOW);
}
void sendState() {
  Serial.print("ST:P");
  Serial.print(pump ? 1 : 0);
  Serial.print(":V");
  for (int i = 0; i < N; i++) Serial.print(valves[i] ? 1 : 0);
  Serial.println();
}
bool setValve(int i, bool open) {              // true when something changed
  if (valves[i] == open) return false;
  valves[i] = open;
  if (!anyOpen()) pump = false;                // last valve closed -> pump stops
  apply();
  return true;
}
bool setPump(bool on) {
  if (on && !anyOpen()) {                      // never pump into closed pipes
    Serial.println("ERR DRY_RUN");
    return false;
  }
  if (on && tankPct() < TANK_MIN) {            // never pump from an empty tank
    Serial.println("ERR TANK_EMPTY");
    return false;
  }
  if (pump == on) return false;
  pump = on;
  apply();
  return true;
}
void reportSensors(bool force) {
  for (int i = 0; i < N; i++) {
    int p = pctOf(i);
    if (force || abs(p - lastPct[i]) >= 2) {
      lastPct[i] = p;
      Serial.print("M:");
      Serial.print(i + 1);
      Serial.print(':');
      Serial.println(map(p, 0, 100, 0, 1023));  // same 0-1023 scale as the Arduino Uno version
    }
  }
  int t = tankPct();
  if (force || abs(t - lastTank) >= 2) {
    lastTank = t;
    Serial.print("T:");
    Serial.println(t);                         // tank level in %
  }
}
void help() {
  Serial.println("Commandes: V1:1 / V1:0 ouvrir / fermer la vanne 1 (V1..V4), P1 / P0 pompe, S? etat, HELP");
  Serial.println("MODE = AUTO (arrosage sous 40 % d'humidite) ou MANUEL (boutons, commandes ou site web)");
}

// ===================================================== serial commands
void handle(String c) {
  c.trim();
  c.toUpperCase();
  if (c.length() == 0) return;
  if (c == "HELP" || c == "?") { help(); return; }
  if (c == "S?") { sendState(); reportSensors(true); return; }
  if (isAuto()) { Serial.println("ERR AUTO_MODE"); return; }
  if (linked) { Serial.println("ERR LINKED (le site web pilote les vannes)"); return; }
  if (c == "P1" || c == "P0") {
    bool on = (c == "P1");
    if (on && !anyOpen()) { Serial.println("ERR DRY_RUN"); return; }
    if (on && tankPct() < TANK_MIN) { Serial.println("ERR TANK_EMPTY"); return; }
    Serial.println("OK " + c);
    setPump(on);
    sendState();
    return;
  }
  if (c.length() == 4 && c[0] == 'V' && c[2] == ':' && (c[3] == '0' || c[3] == '1')) {
    int i = c[1] - '1';
    if (i < 0 || i >= N) { Serial.println("ERR VALVE"); return; }
    Serial.println("OK " + c);
    setValve(i, c[3] == '1');
    sendState();
    return;
  }
  Serial.println("ERR UNKNOWN (tapez HELP)");
}

// ===================================================== AUTO mode
void autoStep() {
  bool changed = false;
  for (int i = 0; i < N; i++) {
    if (setValve(i, pctOf(i) < DRY_PCT)) changed = true;
  }
  bool want = anyOpen() && tankPct() >= TANK_MIN;
  if (pump != want) {
    pump = want;
    apply();
    changed = true;
  }
  if (changed) sendState();
}

// ===================================================== safety: empty tank stops the pump
void checkTank() {
  bool low = tankPct() < TANK_MIN;
  if (low && !tankLowPrev) Serial.println("ALERT TANK_EMPTY");
  if (low && pump) {
    pump = false;
    apply();
    Serial.println("PUMP OFF (cuve vide)");
    sendState();
  }
  tankLowPrev = low;
}

// ===================================================== class lights + dry-soil alarm
void updatePixels() {
  bool blinkOn = (millis() / 400) % 2;
  for (int i = 0; i < N; i++) {
    int c = clsIdx(pctOf(i));
    bool off = dryAndClosed(i) && !blinkOn;     // dry parcel with closed valve blinks
    strip.setPixelColor(i, off ? 0 : strip.Color(CLS_RGB[c][0], CLS_RGB[c][1], CLS_RGB[c][2]));
  }
  strip.show();
}
void updateAlarm() {
  bool alarm = false;
  for (int i = 0; i < N; i++) if (dryAndClosed(i)) alarm = true;
  if (alarm && millis() - lastBeep > 3000) {   // short beep every 3 s
    lastBeep = millis();
    tone(BUZZER, 1200, 150);
  }
}

// ===================================================== buttons
void onButton(int b) {
  if (isAuto()) { Serial.println("ERR AUTO_MODE"); return; }
  if (linked) { Serial.println("ERR LINKED (le site web pilote les vannes)"); return; }
  if (b < N) {
    Serial.print("BTN V");
    Serial.println(b + 1);
    setValve(b, !valves[b]);
    sendState();
  } else {
    Serial.println("BTN P");
    if (setPump(!pump)) sendState();
  }
}
void readButtons() {
  for (int b = 0; b <= N; b++) {
    int v = digitalRead(BTN[b]);
    if (v != btnLast[b]) {
      btnLast[b] = v;
      btnSince[b] = millis();
      btnFired[b] = false;
    } else if (v == LOW && !btnFired[b] && millis() - btnSince[b] > 40) {
      btnFired[b] = true;                      // one action per press
      onButton(b);
    }
  }
}

// ===================================================== website link
bool httpPost(const String &url, const String &body, String &out) {
  HTTPClient http;
  WiFiClientSecure secure;
  WiFiClient plain;
  bool ok;
  if (url.startsWith("https")) {
    secure.setInsecure();                      // demo only: no certificate check
    ok = http.begin(secure, url);
  } else {
    ok = http.begin(plain, url);
  }
  if (!ok) return false;
  http.setTimeout(4000);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  if (code == 200) out = http.getString();
  http.end();
  return code == 200;
}

// POST {PLATFORM_URL}/api/hardware/board/report  {"moisture":[45,16,85,32],"tank":72}
// reply: {"farmer_id":"...","pump":true,"valves":[true,false,true,false]}
void platformSync() {
  String body = "{\"moisture\":[";
  for (int i = 0; i < N; i++) {
    if (i) body += ",";
    body += String(pctOf(i));
  }
  body += "],\"tank\":" + String(tankPct()) + "}";
  String resp;
  bool ok = httpPost(String(PLATFORM_URL) + "/api/hardware/board/report", body, resp);
  if (ok != linked) Serial.println(ok ? "LINK OK (site web connecte)" : "LINK LOST");
  linked = ok;
  if (!ok || isAuto()) return;                 // AUTO: the board decides by itself

  resp.replace(" ", "");                       // accept {"pump": true} as well as {"pump":true}
  int k = resp.indexOf("\"valves\":[");
  if (k < 0) return;
  k += 10;
  bool changed = false;
  for (int i = 0; i < N; i++) {                // parse true / false tokens
    int t = resp.indexOf("true", k), f = resp.indexOf("false", k);
    if (t < 0 && f < 0) break;
    bool open = (t >= 0 && (f < 0 || t < f));
    k = (open ? t + 4 : f + 5);
    if (setValve(i, open)) changed = true;
  }
  bool wantPump = resp.indexOf("\"pump\":true") >= 0;
  if (wantPump != pump && setPump(wantPump)) changed = true;
  if (changed) sendState();
}

// ===================================================== LCD
void drawLcd() {
  // line 1: "V1011 P:ON  AUTO"   (MANU = manual, LINK = manual driven by the website)
  lcd.setCursor(0, 0);
  lcd.print('V');
  for (int i = 0; i < N; i++) lcd.print(valves[i] ? '1' : '0');
  lcd.print(pump ? " P:ON  " : " P:OFF ");
  lcd.print(isAuto() ? "AUTO" : (linked ? "LINK" : "MANU"));
  // line 2 rotates every 2 s: moisture  /  classes  /  tank + alarm
  lcd.setCursor(0, 1);
  int page = (millis() / 2000) % 3;
  if (page == 0) {                             // "H 45 16 85 32  %"
    lcd.print('H');
    for (int i = 0; i < N; i++) {
      int p = min(pctOf(i), 99);
      lcd.print(' ');
      if (p < 10) lcd.print('0');
      lcd.print(p);
    }
    lcd.print("  %");
  } else if (page == 1) {                      // "P1J P2R P3V P4O "
    for (int i = 0; i < N; i++) {
      lcd.print('P');
      lcd.print(i + 1);
      lcd.print(clsOf(pctOf(i)));
      lcd.print(' ');
    }
  } else {                                     // "Cuve 72% Al:P2  "  /  "Cuve 05% VIDE   "
    int t = min(tankPct(), 99);
    lcd.print("Cuve ");
    if (t < 10) lcd.print('0');
    lcd.print(t);
    lcd.print("% ");
    String al = "";
    for (int i = 0; i < N; i++) if (dryAndClosed(i)) al += String(i + 1);
    String tail = t < TANK_MIN ? "VIDE" : (al.length() ? "Al:P" + al : "OK");
    while (tail.length() < 7) tail += ' ';
    lcd.print(tail.substring(0, 7));
  }
}

// ===================================================== setup / loop
void setup() {
  Serial.begin(115200);
  for (int i = 0; i < N; i++) pinMode(VALVE[i], OUTPUT);
  pinMode(PUMP, OUTPUT);
  pinMode(MODE_SW, INPUT_PULLUP);
  for (int b = 0; b <= N; b++) {
    pinMode(BTN[b], INPUT_PULLUP);
    btnLast[b] = HIGH;
    btnSince[b] = 0;
    btnFired[b] = false;
  }
  apply();                                     // everything closed at start-up
  strip.begin();
  strip.setBrightness(80);
  strip.show();

  lcd.init();
  lcd.backlight();
  lcd.print("Physarum-Grid");
  lcd.setCursor(0, 1);
  lcd.print("Controleur pret");
  Serial.println("Physarum-Grid - controleur d'irrigation pret.");
  help();

  if (PLATFORM_URL[0]) {                       // connect Wi-Fi only when the website link is set
    lcd.setCursor(0, 1);
    lcd.print("WiFi...         ");
    WiFi.begin(WIFI_SSID, WIFI_PASS, 6);       // channel 6 = faster on Wokwi-GUEST
    unsigned long t0 = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) delay(250);
    Serial.println(WiFi.status() == WL_CONNECTED ? "WiFi OK" : "WiFi indisponible (mode autonome)");
  }

  autoPrev = isAuto();
  Serial.println(autoPrev ? "MODE AUTO" : "MODE MANUAL");
  sendState();
  reportSensors(true);
  delay(800);
  lcd.clear();
}

void loop() {
  while (Serial.available()) {
    char ch = (char)Serial.read();
    if (ch == '\r' || ch == '\n') {
      if (buf.length()) handle(buf);
      buf = "";
    } else if (buf.length() < 20) {
      buf += ch;
    }
  }

  readButtons();
  checkTank();

  bool a = isAuto();
  if (a != autoPrev) {
    autoPrev = a;
    Serial.println(a ? "MODE AUTO" : "MODE MANUAL");
    sendState();
  }
  if (a && millis() - lastAuto > 300) {
    lastAuto = millis();
    autoStep();
  }
  if (millis() - lastSensors > 250) {
    lastSensors = millis();
    reportSensors(false);
  }
  if (millis() - lastPixels > 100) {
    lastPixels = millis();
    updatePixels();
    updateAlarm();
  }
  if (PLATFORM_URL[0] && WiFi.status() == WL_CONNECTED && millis() - lastSync > 2000) {
    lastSync = millis();
    platformSync();
  }
  if (millis() - lastLcd > 250) {
    lastLcd = millis();
    drawLcd();
  }
  delay(5);
}
