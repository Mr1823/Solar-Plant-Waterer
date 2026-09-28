/**
 * Solar Plant Waterer — ESP-12E (ESP8266) firmware
 * ===================================================================
 * Talks to the same Express backend as the ESP32 build (../solar_plant_waterer):
 *
 *   POST /api/readings     push sensor data (every POST_INTERVAL_MS)
 *   GET  /api/pump/status  poll for Water Now / Stop Pump
 *   GET  /api/pump/schedule fetch watering schedules
 *
 * Sensing is different from the ESP32 build, for a hardware reason, not a
 * style choice: the ESP8266 has exactly ONE analog pin, which cannot cover
 * four channels (solar V/I, battery V/I) the way the ESP32's four ADC pins
 * did. Two INA219 breakouts on I2C solve this — each measures its own
 * voltage and current, calibrated, no divider math needed.
 *
 * Two things carried over from the ESP32 build's backend contract:
 *
 * 1. Nothing runs schedules server-side. The dashboard stores them, but no
 *    cron turns them into commands — THIS DEVICE executes them, against
 *    NTP-derived local time. Watering keeps working when WiFi or the
 *    server is down.
 *
 * 2. Every pump run is bounded locally by MAX_PUMP_RUNTIME_S. The server
 *    has no auto-off: a manual "on" runs until a matching "off" arrives,
 *    and if that reply is lost, nothing server-side will ever stop the pump.
 *
 * Libraries (Arduino IDE -> Library Manager):
 *   ArduinoJson          by Benoit Blanchon   (v7+)
 *   OneWire              by Paul Stoffregen
 *   DallasTemperature    by Miles Burton
 *   Adafruit INA219      by Adafruit
 *   Adafruit BusIO       by Adafruit          (INA219's I2C dependency)
 * Board: "Generic ESP8266 Module" (ESP8266 core 3.0+).
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_INA219.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <time.h>

#include "config.h"

// ── State ────────────────────────────────────────────────────────────────
struct Schedule {
  int      id        = 0;
  uint8_t  hour      = 0;
  uint8_t  minute    = 0;
  uint8_t  daysMask  = 0;    // bit 0 = Sunday .. bit 6 = Saturday
  uint16_t durationS = 30;
  bool     enabled   = false;
  long     firedKey  = -1;   // local-epoch-minute this entry last fired
};

static Schedule schedules[MAX_SCHEDULES];
static uint8_t  scheduleCount = 0;

static bool          pumpOn        = false;
static unsigned long pumpStopAtMs  = 0;
static time_t         lastRunEpoch = 0;   // true UTC

static unsigned long lastPostMs     = 0;
static unsigned long lastPollMs     = 0;
static unsigned long lastScheduleMs = 0;
static unsigned long lastWifiTryMs  = 0;

static WiFiClient         wifiClient;
static Adafruit_INA219    solarSensor(INA219_SOLAR_ADDR);
static Adafruit_INA219    batterySensor(INA219_BATTERY_ADDR);
static bool                solarOk   = false;
static bool                batteryOk = false;

static OneWire           oneWire(PIN_TEMPERATURE);
static DallasTemperature tempSensor(&oneWire);

static const char* BASE_URL_SCHEME = "http://";

// ── Helpers ──────────────────────────────────────────────────────────────
static String baseUrl() {
  return String(BASE_URL_SCHEME) + SERVER_HOST + ":" + String(SERVER_PORT);
}

static bool timeIsSynced() {
  return time(nullptr) > 1700000000;  // sometime after Nov 2023
}

/**
 * The device is kept on TRUE UTC (configTime(0, 0, ...) in setup(), not a
 * local offset) precisely so this function and time(nullptr) never need any
 * platform timezone behaviour to agree with each other. Schedule matching
 * below adds the offset itself, deliberately, in one place.
 */
static String isoUtc(time_t t) {
  struct tm g;
  gmtime_r(&t, &g);
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &g);
  return String(buf);
}

/**
 * Local wall-clock time, as an epoch-shaped number — NOT a real epoch.
 * gmtime_r() never applies a timezone conversion, so treating (true UTC +
 * offset) "as if" it were UTC is a portable way to read local hour/minute/
 * weekday without depending on configTime()'s local-offset side effects or
 * any TZ environment variable, both of which vary across ESP8266 core
 * versions. Every schedule computation below stays in this "local-shifted"
 * space and only converts back to true UTC at the very end, via isoUtc().
 */
static time_t localNow() {
  return time(nullptr) + UTC_OFFSET_SEC + DST_OFFSET_SEC;
}

static void localFields(time_t localEpoch, struct tm &out) {
  gmtime_r(&localEpoch, &out);
}

// ── Sensors ──────────────────────────────────────────────────────────────
static void readSolar(float &voltage, float &current) {
  if (!solarOk) { voltage = 0; current = 0; return; }
  voltage = solarSensor.getBusVoltage_V();
  current = solarSensor.getCurrent_mA() / 1000.0f;
}

static void readBattery(float &voltage, float &current) {
  if (!batteryOk) { voltage = 0; current = 0; return; }
  voltage = batterySensor.getBusVoltage_V();
  current = batterySensor.getCurrent_mA() / 1000.0f;
}

/**
 * Resting-voltage curve for a 12V lead-acid battery. It reads high while
 * charging and low under load, so treat it as an estimate, not a fuel gauge.
 * Swap this table if you move to LiFePO4 — the curve is completely different.
 */
static float batteryPercent(float volts) {
  static const float curve[][2] = {
    {12.73, 100}, {12.62, 90}, {12.50, 80}, {12.37, 70}, {12.24, 60},
    {12.10,  50}, {11.96, 40}, {11.81, 30}, {11.66, 20}, {11.51, 10},
    {11.30,   0},
  };
  const size_t n = sizeof(curve) / sizeof(curve[0]);

  if (volts >= curve[0][0]) return 100.0f;
  if (volts <= curve[n - 1][0]) return 0.0f;

  for (size_t i = 0; i < n - 1; i++) {
    if (volts <= curve[i][0] && volts > curve[i + 1][0]) {
      float span = curve[i][0] - curve[i + 1][0];
      float pos  = volts - curve[i + 1][0];
      return curve[i + 1][1] + (pos / span) * (curve[i][1] - curve[i + 1][1]);
    }
  }
  return 0.0f;
}

/** Returns NAN when the probe is missing or unreadable, never a fake value. */
static float readTemperatureC() {
  tempSensor.requestTemperatures();
  float c = tempSensor.getTempCByIndex(0);
  if (c == DEVICE_DISCONNECTED_C || c < -40.0f || c > 80.0f) return NAN;
  return c;
}

// ── Pump ─────────────────────────────────────────────────────────────────
static void writeRelay(bool on) {
  digitalWrite(PIN_RELAY, RELAY_ACTIVE_LOW ? (on ? LOW : HIGH)
                                           : (on ? HIGH : LOW));
}

static void stopPump(const char* reason) {
  if (!pumpOn) return;
  writeRelay(false);
  pumpOn = false;
  pumpStopAtMs = 0;
  Serial.printf("[pump] OFF (%s)\n", reason);
}

static void startPump(uint16_t seconds, const char* reason) {
  float battV, battI;
  readBattery(battV, battI);
  float pct = batteryPercent(battV);

  if (pct < MIN_BATTERY_PCT_TO_PUMP) {
    Serial.printf("[pump] refused (%s): battery %.0f%% below %.0f%% cutoff\n",
                  reason, pct, (float)MIN_BATTERY_PCT_TO_PUMP);
    return;
  }

  if (seconds > MAX_PUMP_RUNTIME_S) seconds = MAX_PUMP_RUNTIME_S;
  if (seconds == 0) seconds = 1;

  writeRelay(true);
  pumpOn       = true;
  pumpStopAtMs = millis() + (unsigned long)seconds * 1000UL;
  if (timeIsSynced()) lastRunEpoch = time(nullptr);

  Serial.printf("[pump] ON for %us (%s)\n", seconds, reason);
}

/** The only thing standing between a lost "off" command and a flooded bed. */
static void enforcePumpSafety() {
  if (!pumpOn) return;

  // Runtime first: this is the guard that must never be skipped.
  if ((long)(millis() - pumpStopAtMs) >= 0) {
    stopPump("run complete");
    return;
  }

  // Battery sags slowly, so polling I2C every loop pass would be wasted
  // work. Every 5s is plenty to catch a cutoff.
  static unsigned long lastBattCheckMs = 0;
  if (millis() - lastBattCheckMs < 5000UL) return;
  lastBattCheckMs = millis();

  float battV, battI;
  readBattery(battV, battI);
  if (batteryPercent(battV) < MIN_BATTERY_PCT_TO_PUMP) stopPump("battery cutoff");
}

// ── Schedules ────────────────────────────────────────────────────────────
/** Next matching schedule as a TRUE UTC epoch, or 0 if none. */
static time_t nextScheduledRun() {
  if (!timeIsSynced() || scheduleCount == 0) return 0;

  time_t localBase = localNow();
  time_t bestLocal = 0;

  for (int dayAhead = 0; dayAhead < 8; dayAhead++) {
    time_t probeLocal = localBase + (time_t)dayAhead * 86400;
    struct tm lt;
    localFields(probeLocal, lt);

    for (uint8_t i = 0; i < scheduleCount; i++) {
      if (!schedules[i].enabled) continue;
      if (!(schedules[i].daysMask & (1 << lt.tm_wday))) continue;

      // Same local calendar day as probeLocal, at the schedule's hour:minute.
      time_t dayStartLocal = probeLocal - (lt.tm_hour * 3600L + lt.tm_min * 60L + lt.tm_sec);
      time_t candidateLocal = dayStartLocal + (time_t)schedules[i].hour * 3600L
                                             + (time_t)schedules[i].minute * 60L;

      if (candidateLocal > localBase && (bestLocal == 0 || candidateLocal < bestLocal)) {
        bestLocal = candidateLocal;
      }
    }
    if (bestLocal) break;  // days are scanned in order, so the first hit is soonest
  }

  if (!bestLocal) return 0;
  return bestLocal - UTC_OFFSET_SEC - DST_OFFSET_SEC;  // back to true UTC
}

static void runDueSchedules() {
  if (!timeIsSynced() || pumpOn) return;

  time_t localT = localNow();
  struct tm lt;
  localFields(localT, lt);
  long minuteKey = (long)(localT / 60);

  for (uint8_t i = 0; i < scheduleCount; i++) {
    Schedule& s = schedules[i];
    if (!s.enabled) continue;
    if (!(s.daysMask & (1 << lt.tm_wday))) continue;
    if (lt.tm_hour != s.hour || lt.tm_min != s.minute) continue;
    if (s.firedKey == minuteKey) continue;  // already fired this minute

    s.firedKey = minuteKey;
    startPump(s.durationS, "schedule");
    break;
  }
}

// ── HTTP ─────────────────────────────────────────────────────────────────
static bool httpGetJson(const char* path, JsonDocument& doc) {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  http.setTimeout(6000);
  if (!http.begin(wifiClient, baseUrl() + path)) return false;

  int code = http.GET();
  bool ok = false;

  if (code == 200) {
    ok = (deserializeJson(doc, http.getStream()) == DeserializationError::Ok);
    if (!ok) Serial.printf("[http] GET %s: bad JSON\n", path);
  } else {
    Serial.printf("[http] GET %s: HTTP %d\n", path, code);
  }

  http.end();
  return ok;
}

static bool httpPostJson(const char* path, JsonDocument& body) {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  http.setTimeout(6000);
  if (!http.begin(wifiClient, baseUrl() + path)) return false;
  http.addHeader("Content-Type", "application/json");

  String payload;
  serializeJson(body, payload);
  int code = http.POST(payload);

  // 400 means the validator rejected a field — print it, the message names
  // exactly which one.
  if (code != 200 && code != 201) {
    Serial.printf("[http] POST %s: HTTP %d %s\n", path, code,
                  code > 0 ? http.getString().c_str() : "");
  }

  http.end();
  return code == 200 || code == 201;
}

// ── Backend conversations ────────────────────────────────────────────────
static void fetchSchedules() {
  JsonDocument doc;
  if (!httpGetJson("/api/pump/schedule", doc)) return;

  JsonArray arr = doc["schedules"].as<JsonArray>();
  if (arr.isNull()) return;

  uint8_t n = 0;
  for (JsonObject o : arr) {
    if (n >= MAX_SCHEDULES) break;

    const char* hhmm = o["time"] | "";
    if (strlen(hhmm) < 4) continue;

    Schedule s;
    s.id        = o["id"] | 0;
    s.hour      = atoi(String(hhmm).substring(0, 2).c_str());
    s.minute    = atoi(String(hhmm).substring(3, 5).c_str());
    s.durationS = o["duration_seconds"] | 30;
    s.enabled   = (o["enabled"] | 1) != 0;

    for (JsonVariant d : o["days"].as<JsonArray>()) {
      int day = d.as<int>();
      if (day >= 0 && day <= 6) s.daysMask |= (1 << day);
    }

    // Carry the fired-marker across refreshes so a schedule that already ran
    // this minute is not re-triggered by a poll landing in the same minute.
    for (uint8_t i = 0; i < scheduleCount; i++) {
      if (schedules[i].id == s.id) { s.firedKey = schedules[i].firedKey; break; }
    }

    schedules[n++] = s;
  }
  scheduleCount = n;
  Serial.printf("[sched] %u schedule(s) loaded\n", scheduleCount);
}

/**
 * The backend serves the newest pending command and acknowledges everything
 * queued behind it in the same request, so normally one GET is all it takes.
 * The drain loop stays as belt-and-braces against an older/different backend
 * where the queue could come back newest-first across successive polls,
 * which would land a stale "on" after the "off" you just pressed. Honouring
 * only the first reply is correct either way.
 */
static void pollCommands() {
  char winner[8] = {0};
  bool haveWinner = false;

  for (uint8_t i = 0; i < MAX_COMMAND_DRAIN; i++) {
    JsonDocument doc;
    if (!httpGetJson("/api/pump/status", doc)) return;
    if (!(doc["pending"] | false)) break;

    const char* cmd = doc["command"] | "";
    if (!haveWinner) {
      strncpy(winner, cmd, sizeof(winner) - 1);
      haveWinner = true;
    } else {
      Serial.printf("[cmd] discarding stale \"%s\"\n", cmd);
    }
  }

  if (!haveWinner) return;
  if (strcmp(winner, "on") == 0)       startPump(MANUAL_PUMP_RUNTIME_S, "manual");
  else if (strcmp(winner, "off") == 0) stopPump("manual");
}

static void postReading() {
  float solarV, solarI, battV, battI;
  readSolar(solarV, solarI);
  readBattery(battV, battI);
  float tempC = readTemperatureC();

  // The validator rejects a negative solar_current outright (400), and noise
  // around the sensor's zero point can dip below it.
  if (solarI < 0) solarI = 0;

  JsonDocument doc;
  doc["solar_voltage"]      = round(solarV * 100) / 100.0;
  doc["solar_current"]      = round(solarI * 100) / 100.0;
  doc["battery_voltage"]    = round(battV * 100) / 100.0;
  doc["battery_current"]    = round(battI * 100) / 100.0;   // may be negative (discharging)
  doc["battery_percentage"] = round(batteryPercent(battV) * 10) / 10.0;
  doc["pump_status"]        = pumpOn ? "on" : "off";
  doc["location_name"]      = LOCATION_NAME;
  doc["location_lat"]       = LOCATION_LAT;
  doc["location_lon"]       = LOCATION_LON;

  // Omit rather than send null/NaN — NaN is not valid JSON and the reading
  // would be rejected wholesale over one dead probe.
  if (!isnan(tempC)) doc["temperature"] = round(tempC * 10) / 10.0;

  if (timeIsSynced()) {
    doc["timestamp"] = isoUtc(time(nullptr));
    if (lastRunEpoch) doc["pump_last_run"] = isoUtc(lastRunEpoch);
    time_t next = nextScheduledRun();
    if (next) doc["pump_next_scheduled_run"] = isoUtc(next);
  }

  if (httpPostJson("/api/readings", doc)) {
    Serial.printf("[post] %.1fW solar | %.0f%% batt | %.1fC | pump %s\n",
                  solarV * solarI, batteryPercent(battV),
                  isnan(tempC) ? 0.0 : tempC, pumpOn ? "on" : "off");
  }
}

// ── WiFi ─────────────────────────────────────────────────────────────────
static void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (millis() - lastWifiTryMs < WIFI_RETRY_MS) return;

  lastWifiTryMs = millis();
  Serial.printf("[wifi] connecting to %s...\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

// ── Arduino entry points ─────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(200);

  // Relay state first, before anything can block: a floating pin on a
  // brown-out reboot is how a pump ends up running unattended.
  pinMode(PIN_RELAY, OUTPUT);
  writeRelay(false);

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);

  solarOk = solarSensor.begin();
  Serial.printf("[i2c] solar INA219 (0x%02X): %s\n", INA219_SOLAR_ADDR,
                solarOk ? "found" : "NOT FOUND — solar readings will be 0");

  batteryOk = batterySensor.begin();
  Serial.printf("[i2c] battery INA219 (0x%02X): %s\n", INA219_BATTERY_ADDR,
                batteryOk ? "found" : "NOT FOUND — pump will refuse to start (safe default)");

  tempSensor.begin();

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("[wifi] connecting");
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) {
    delay(250);
    Serial.print('.');
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[wifi] %s\n", WiFi.localIP().toString().c_str());

    // Zero offset here deliberately — the clock is kept on TRUE UTC. Local
    // time for schedules is computed by localNow(), not by the platform.
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    for (int i = 0; i < 20 && !timeIsSynced(); i++) delay(250);
    if (timeIsSynced()) {
      Serial.printf("[time] %s UTC\n", isoUtc(time(nullptr)).c_str());
    } else {
      Serial.println("[time] NTP not synced yet — schedules wait for it");
    }
    fetchSchedules();
  } else {
    Serial.println("[wifi] offline, will keep retrying");
  }

  Serial.printf("[boot] server %s\n", baseUrl().c_str());
}

void loop() {
  unsigned long now = millis();

  ensureWifi();

  // Safety runs every pass, independent of network state.
  enforcePumpSafety();
  runDueSchedules();

  if (now - lastPollMs >= COMMAND_POLL_MS) {
    lastPollMs = now;
    pollCommands();
  }

  if (now - lastScheduleMs >= SCHEDULE_REFRESH_MS) {
    lastScheduleMs = now;
    fetchSchedules();
  }

  if (now - lastPostMs >= POST_INTERVAL_MS) {
    lastPostMs = now;
    postReading();
  }

  delay(50);
}
