/**
 * Solar Plant Waterer — ESP32 firmware
 * ===================================================================
 * Talks to the Express backend in ../../backend:
 *
 *   POST /api/readings     push sensor data (every POST_INTERVAL_MS)
 *   GET  /api/pump/status  poll for Water Now / Stop Pump
 *   GET  /api/pump/schedule fetch watering schedules
 *
 * Two things about the backend shape this firmware:
 *
 * 1. Nothing runs schedules server-side. The dashboard stores them, but no
 *    cron turns them into commands — so THIS DEVICE executes them, against
 *    NTP local time. Watering therefore keeps working when WiFi or the
 *    server is down, which is what you want from a garden controller.
 *
 * 2. GET /api/pump/status acknowledges a command the moment it is read, and
 *    a manual "on" carries no duration. If the reply is lost in transit the
 *    command is gone, and nothing server-side will ever turn the pump off.
 *    Every run is therefore bounded locally by MAX_PUMP_RUNTIME_S.
 *
 * Libraries (Arduino IDE -> Library Manager):
 *   ArduinoJson         by Benoit Blanchon   (v7+)
 *   OneWire             by Paul Stoffregen
 *   DallasTemperature   by Miles Burton
 * Board: "ESP32 Dev Module" (esp32 core v2.0.0+ for analogReadMilliVolts).
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
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
  long     firedKey  = -1;   // epoch-minute this entry last fired
};

static Schedule schedules[MAX_SCHEDULES];
static uint8_t  scheduleCount = 0;

static bool          pumpOn        = false;
static unsigned long pumpStopAtMs  = 0;
static time_t        lastRunEpoch  = 0;

static unsigned long lastPostMs     = 0;
static unsigned long lastPollMs     = 0;
static unsigned long lastScheduleMs = 0;
static unsigned long lastWifiTryMs  = 0;

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

/** ISO 8601 in UTC — the format the backend's validator accepts. */
static String isoUtc(time_t t) {
  struct tm g;
  gmtime_r(&t, &g);
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &g);
  return String(buf);
}

// ── Sensors ──────────────────────────────────────────────────────────────
/**
 * analogReadMilliVolts() applies the chip's factory ADC calibration, which
 * matters a lot on ESP32 — the raw analogRead() curve is visibly non-linear
 * at both ends and would skew every voltage you log.
 */
static float readPinMillivolts(uint8_t pin, uint8_t samples = 16) {
  uint32_t sum = 0;
  for (uint8_t i = 0; i < samples; i++) {
    sum += analogReadMilliVolts(pin);
    delayMicroseconds(200);
  }
  return (float)sum / samples;
}

static float readVoltage(uint8_t pin, float dividerRatio) {
  return (readPinMillivolts(pin) / 1000.0f) * dividerRatio;
}

static float readCurrent(uint8_t pin) {
  // Undo the divider that protects the ADC from the sensor's 5V output,
  // then convert the offset from its 0A midpoint into amps.
  float sensorMv = readPinMillivolts(pin) * CURRENT_OUT_DIVIDER;
  return (sensorMv - ACS712_ZERO_MV) / ACS712_MV_PER_AMP;
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
  float pct = batteryPercent(readVoltage(PIN_BATTERY_VOLTAGE, BATTERY_VOLTAGE_RATIO));
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

  // Battery sags slowly, so sampling it every 50ms loop would burn ~3ms of
  // busy-wait per pass for nothing. Every 5s is plenty to catch a cutoff.
  static unsigned long lastBattCheckMs = 0;
  if (millis() - lastBattCheckMs < 5000UL) return;
  lastBattCheckMs = millis();

  float pct = batteryPercent(readVoltage(PIN_BATTERY_VOLTAGE, BATTERY_VOLTAGE_RATIO));
  if (pct < MIN_BATTERY_PCT_TO_PUMP) stopPump("battery cutoff");
}

// ── Schedules ────────────────────────────────────────────────────────────
/** Next matching schedule as an epoch time, or 0 if none. */
static time_t nextScheduledRun() {
  if (!timeIsSynced() || scheduleCount == 0) return 0;

  time_t now = time(nullptr);
  time_t best = 0;

  for (int dayAhead = 0; dayAhead < 8; dayAhead++) {
    for (uint8_t i = 0; i < scheduleCount; i++) {
      if (!schedules[i].enabled) continue;

      time_t probe = now + (time_t)dayAhead * 86400;
      struct tm lt;
      localtime_r(&probe, &lt);

      if (!(schedules[i].daysMask & (1 << lt.tm_wday))) continue;

      lt.tm_hour  = schedules[i].hour;
      lt.tm_min   = schedules[i].minute;
      lt.tm_sec   = 0;
      lt.tm_isdst = -1;

      time_t candidate = mktime(&lt);
      if (candidate > now && (best == 0 || candidate < best)) best = candidate;
    }
    if (best) break;  // days are scanned in order, so the first hit is soonest
  }
  return best;
}

static void runDueSchedules() {
  if (!timeIsSynced() || pumpOn) return;

  time_t now = time(nullptr);
  struct tm lt;
  localtime_r(&now, &lt);
  long minuteKey = (long)(now / 60);

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
  http.setConnectTimeout(4000);
  http.setTimeout(6000);
  if (!http.begin(baseUrl() + path)) return false;

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
  http.setConnectTimeout(4000);
  http.setTimeout(6000);
  if (!http.begin(baseUrl() + path)) return false;
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
 * Serves the newest pending command; the backend now acknowledges everything
 * queued behind it in the same request, so normally one GET is all it takes.
 *
 * The drain loop stays as belt-and-braces: against an older backend the queue
 * came back newest-first across successive polls, which would land a stale
 * "on" after the "off" you just pressed. Honouring only the first reply is
 * correct either way, and costs one extra GET only when a command arrives.
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
  float solarV = readVoltage(PIN_SOLAR_VOLTAGE, SOLAR_VOLTAGE_RATIO);
  float solarI = readCurrent(PIN_SOLAR_CURRENT);
  float battV  = readVoltage(PIN_BATTERY_VOLTAGE, BATTERY_VOLTAGE_RATIO);
  float battI  = readCurrent(PIN_BATTERY_CURRENT);
  float tempC  = readTemperatureC();

  // The validator rejects a negative solar_current outright (400), and noise
  // around the sensor's zero point easily dips below it.
  if (solarI < 0) solarI = 0;

  JsonDocument doc;
  doc["solar_voltage"]      = round(solarV * 100) / 100.0;
  doc["solar_current"]      = round(solarI * 100) / 100.0;
  doc["battery_voltage"]    = round(battV * 100) / 100.0;
  doc["battery_current"]    = round(battI * 100) / 100.0;   // may be negative
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

  analogReadResolution(12);
  analogSetPinAttenuation(PIN_SOLAR_VOLTAGE,   ADC_11db);  // full ~0-3.3V span
  analogSetPinAttenuation(PIN_SOLAR_CURRENT,   ADC_11db);
  analogSetPinAttenuation(PIN_BATTERY_VOLTAGE, ADC_11db);
  analogSetPinAttenuation(PIN_BATTERY_CURRENT, ADC_11db);

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
    configTzTime(TIMEZONE, "pool.ntp.org", "time.nist.gov");
    for (int i = 0; i < 20 && !timeIsSynced(); i++) delay(250);
    if (timeIsSynced()) {
      Serial.printf("[time] %s (local %s)\n",
                    isoUtc(time(nullptr)).c_str(), TIMEZONE);
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
