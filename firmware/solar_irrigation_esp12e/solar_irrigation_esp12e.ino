/*
  Smart Solar Irrigation — ESP-12E (ESP8266)
  ==========================================================================
  Hardware: ESP-12E, 9W submersible pump via relay, soil moisture probe on
  A0, 33x35 cm solar panel (~10W), solar charge controller, 12V 12Ah
  lead-acid battery, buzzer. No current, voltage or temperature sensors.

  Pump energy  = pump ON time x 9 W rating.
  Solar power  = panel W x (sunlight / 1000) x 0.75    [ESTIMATED]
  Battery      = energy balance on a 144 Wh pack       [ESTIMATED]

  Posts to POST /api/readings and polls GET /api/pump/status for commands.

  --------------------------------------------------------------------------
  THREE FIELD NAMES WERE CORRECTED against the backend contract. Verified
  by posting this exact payload to the running server:

    pump_status   was sent as a boolean (true/false) -> rejected, HTTP 400
                  "Pump status must be \"on\" or \"off\"". Now a string.
    latitude      -> location_lat   (the column the backend actually reads)
    longitude     -> location_lon   (same; otherwise coordinates are
                                     silently dropped and the dashboard's
                                     weather falls back to its default spot)

  device_id is still sent but has no column, so the server ignores it.
  location_name is what the dashboard displays.
  --------------------------------------------------------------------------
*/

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>
#include <WiFiClientSecureBearSSL.h>
#include <EEPROM.h>
#include <time.h>

// Credentials live in secrets.h, which is gitignored. Copy
// secrets.example.h to secrets.h and fill it in before flashing.
#include "secrets.h"

// =====================================================
// WIFI + BACKEND (values come from secrets.h)
// =====================================================

const char* WIFI_SSID     = WIFI_SSID_VALUE;
const char* WIFI_PASSWORD = WIFI_PASSWORD_VALUE;

const char* READINGS_URL    = READINGS_URL_VALUE;
const char* PUMP_STATUS_URL = PUMP_STATUS_URL_VALUE;

// Must match ESP_DEVICE_KEY in backend/.env — the backend enforces this on
// POST /api/readings and returns 401 without it.
const char* DEVICE_KEY = DEVICE_KEY_VALUE;

// =====================================================
// DEVICE CONFIGURATION
// =====================================================

const char* DEVICE_ID = "IRRIGATION_001";

// Shown on the dashboard header.
const char* LOCATION_NAME = "My Garden";

// Fixed installation location
const float LATITUDE = 9.673050966829638;
const float LONGITUDE = 77.9658129288358;

// =====================================================
// PIN CONFIGURATION
// =====================================================

#define RELAY_PIN D1
#define BUZZER_PIN D2
#define SOIL_SENSOR_PIN A0

// Change to false if your relay is Active LOW
#define RELAY_ACTIVE_HIGH true

// =====================================================
// SOIL MOISTURE CALIBRATION
// =====================================================

// DRY_VALUE -> sensor in dry soil
// WET_VALUE -> sensor in very wet soil

const int DRY_VALUE = 850;
const int WET_VALUE = 350;

// =====================================================
// WATERING SCHEDULE
// =====================================================

const int wateringHours[] = {7, 18};
const int wateringMinutes[] = {0, 0};

const int NUM_SCHEDULES = 2;

// Scheduled watering duration = 2 minutes
const int WATER_DURATION_SECONDS = 120;

// Manual pump safety limit = 5 minutes
const int MANUAL_MAX_SECONDS = 300;

// Water only if soil moisture is below this
const int SOIL_MOISTURE_THRESHOLD = 30;

// =====================================================
// POWER / ENERGY CONFIGURATION
// =====================================================

// Pump energy = pump ON time x pump power
const float PUMP_POWER_W = 9.0;

// Other loads
const float RELAY_COIL_W = 0.35;   // only while pump is ON
const float ESP_BASE_W = 0.35;     // ESP-12E + WiFi, always ON

// Solar panel (33 x 35 cm). Check Pmax on the back label.
const float PANEL_W = 10.0;
const float PANEL_LOSS = 0.75;     // heat, dust, angle, controller

// Battery 12V 12Ah (C20) lead-acid
const float BATTERY_CAPACITY_WH = 12.0 * 12.0;   // 144 Wh
const float CHARGE_EFFICIENCY = 0.85;
const float MAX_CHARGE_W = 13.8 * 3.6;           // initial current 3.6 A

// Buzzer alarm below this battery %
const float LOW_BATTERY_PERCENT = 40.0;

// =====================================================
// TIMING
// =====================================================

const unsigned long UPLOAD_INTERVAL = 1UL * 60UL * 1000UL;        // 1 min
const unsigned long COMMAND_POLL_INTERVAL = 5UL * 1000UL;         // 5 s
const unsigned long SUNLIGHT_INTERVAL = 10UL * 60UL * 1000UL;     // 10 min
const unsigned long SAVE_INTERVAL = 10UL * 60UL * 1000UL;         // 10 min
const unsigned long ALARM_INTERVAL = 5UL * 60UL * 1000UL;         // 5 min

// NTP can be slow or simply unreachable (UDP 123 blocked, captive portal,
// no internet). Waiting on it forever means the board never finishes
// booting — no uploads, no manual pump control, nothing. Give it 30 s, then
// carry on and keep retrying in the background.
const unsigned long TIME_SYNC_TIMEOUT_MS = 30UL * 1000UL;
const unsigned long TIME_RETRY_INTERVAL  = 60UL * 1000UL;

unsigned long lastUploadTime = 0;
unsigned long lastCommandPollTime = 0;
unsigned long lastSunlightTime = 0;
unsigned long lastSaveTime = 0;
unsigned long lastAlarmTime = 0;
unsigned long lastEnergyUpdate = 0;
unsigned long lastTimeRetry = 0;

// Only the wall-clock features depend on this: the 07:00/18:00 schedule and
// the daily counter reset. Uploads, command polling, manual pump control and
// energy tracking all run on millis() and work fine without a real date.
bool timeSynced = false;

// =====================================================
// STATE
// =====================================================

bool wateredToday[NUM_SCHEDULES] = {false};
int lastCheckedDay = -1;

bool autoMode = true;

bool pumpRunning = false;
unsigned long pumpStartTime = 0;
unsigned long pumpRunLimitMs = 0;

int soilMoisture = 0;

float irradiance = 0;        // W/m2 from Open-Meteo
float solarPowerW = 0;       // estimated

int lastRunSeconds = 0;
float lastRunWh = 0;

// Saved in EEPROM so values survive a reboot
struct SavedData {
  uint32_t magic;
  float batteryWh;
  float pumpEnergyTodayWh;
  float pumpEnergyTotalWh;
  float solarEnergyTodayWh;
  float solarEnergyTotalWh;
  int wateringsToday;
  int savedDay;
};

const uint32_t MAGIC = 0xA5A50003;

SavedData data;


// =====================================================
// SETUP
// =====================================================

void setup() {

  Serial.begin(9600);

  delay(1000);

  Serial.println();
  Serial.println("====================================");
  Serial.println(" SMART SOLAR IRRIGATION SYSTEM");
  Serial.println(" ESP8266 / ESP-12E");
  Serial.println("====================================");

  // Relay
  pinMode(RELAY_PIN, OUTPUT);
  relayOff();

  // Buzzer
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  // Soil sensor
  pinMode(SOIL_SENSOR_PIN, INPUT);

  // Saved energy data
  loadData();

  // WiFi
  connectWiFi();

  // NTP time
  configTime(
    19800,   // India UTC +5:30
    0,
    "pool.ntp.org",
    "time.nist.gov"
  );

  Serial.println("Waiting for time synchronization...");

  unsigned long syncStart = millis();

  while (
    !isTimeValid() &&
    millis() - syncStart < TIME_SYNC_TIMEOUT_MS
  ) {

    delay(500);

    Serial.print(".");
  }

  Serial.println();

  if (isTimeValid()) {

    timeSynced = true;

    Serial.println("Time synchronized!");

    printCurrentTime();

  } else {

    Serial.println("Time not synced - schedule paused, retrying in background");
  }

  lastTimeRetry = millis();

  // First sunlight reading
  fetchSunlight();
  lastSunlightTime = millis();

  lastEnergyUpdate = millis();

  beep(2, 100);

  Serial.println();
  Serial.println("System ready.");
}


// =====================================================
// MAIN LOOP
// =====================================================

void loop() {

  // -----------------------------------------
  // Check WiFi
  // -----------------------------------------

  if (WiFi.status() != WL_CONNECTED) {

    Serial.println("WiFi disconnected.");

    connectWiFi();
  }


  // -----------------------------------------
  // Time sync - keep retrying in the background
  // -----------------------------------------

  if (!timeSynced) {

    if (isTimeValid()) {

      timeSynced = true;

      Serial.println("Time synchronized!");

      printCurrentTime();

    } else if (millis() - lastTimeRetry >= TIME_RETRY_INTERVAL) {

      lastTimeRetry = millis();

      // Re-arm SNTP: the first attempt may have run before WiFi was up.
      configTime(
        19800,
        0,
        "pool.ntp.org",
        "time.nist.gov"
      );

      Serial.println("Time still not synced - schedule paused, retrying.");
    }
  }


  // -----------------------------------------
  // Get current time
  // -----------------------------------------

  time_t now = time(nullptr);

  struct tm* t = localtime(&now);


  // -----------------------------------------
  // Reset schedule and daily energy at new day
  // -----------------------------------------
  // Skipped until the clock is real — otherwise the 1970 placeholder date
  // would fire a "new day" reset and wipe today's counters on every boot.

  if (timeSynced && t->tm_mday != lastCheckedDay) {

    lastCheckedDay = t->tm_mday;

    for (int i = 0; i < NUM_SCHEDULES; i++) {

      wateredToday[i] = false;
    }

    if (data.savedDay != t->tm_mday) {

      data.pumpEnergyTodayWh = 0;
      data.solarEnergyTodayWh = 0;
      data.wateringsToday = 0;
      data.savedDay = t->tm_mday;

      saveData();
    }

    Serial.println("New day - schedule and daily energy reset.");
  }


  // -----------------------------------------
  // Read soil moisture
  // -----------------------------------------

  int soilRaw = readSoilRaw();

  soilMoisture = calculateSoilMoisture(soilRaw);


  // -----------------------------------------
  // Update energy (pump, solar, battery)
  // -----------------------------------------

  updateEnergy();


  // -----------------------------------------
  // Print sensor data
  // -----------------------------------------

  Serial.print("Soil Raw: ");
  Serial.print(soilRaw);

  Serial.print(" | Soil: ");
  Serial.print(soilMoisture);
  Serial.print("%");

  Serial.print(" | Pump: ");
  Serial.print(pumpRunning ? "ON" : "OFF");

  Serial.print(" | Solar: ");
  Serial.print(solarPowerW, 1);
  Serial.print(" W");

  Serial.print(" | Battery: ");
  Serial.print(batteryPercent(), 1);
  Serial.print("%");

  Serial.print(" | Pump Today: ");
  Serial.print(data.pumpEnergyTodayWh, 2);
  Serial.println(" Wh");


  // -----------------------------------------
  // Stop pump when its time is over
  // -----------------------------------------

  if (
    pumpRunning &&
    millis() - pumpStartTime >= pumpRunLimitMs
  ) {

    Serial.println("Pump time finished.");

    stopPump();
  }


  // -----------------------------------------
  // Check watering schedule (auto mode only)
  // -----------------------------------------
  // Needs a real clock: without it every hour reads as 1970 and the 07:00
  // slot could fire at an arbitrary moment. Manual control is unaffected.

  if (timeSynced && autoMode) {

    for (int i = 0; i < NUM_SCHEDULES; i++) {

      if (
        !wateredToday[i] &&
        t->tm_hour == wateringHours[i] &&
        t->tm_min == wateringMinutes[i]
      ) {

        Serial.print("Schedule ");
        Serial.print(i + 1);
        Serial.println(" reached.");

        if (soilMoisture >= SOIL_MOISTURE_THRESHOLD) {

          Serial.println("Soil moisture is sufficient.");
          Serial.println("Skipping irrigation.");

        } else if (batteryPercent() <= 5) {

          Serial.println("Battery too low.");
          Serial.println("Skipping irrigation.");

        } else {

          Serial.println("Soil is dry.");
          Serial.println("Starting irrigation.");

          startPump(WATER_DURATION_SECONDS);
        }

        wateredToday[i] = true;
      }
    }
  }


  // -----------------------------------------
  // Check dashboard commands every 5 seconds
  // -----------------------------------------

  if (millis() - lastCommandPollTime >= COMMAND_POLL_INTERVAL) {

    checkPumpCommand();

    lastCommandPollTime = millis();
  }


  // -----------------------------------------
  // Update sunlight every 10 minutes
  // -----------------------------------------

  if (millis() - lastSunlightTime >= SUNLIGHT_INTERVAL) {

    fetchSunlight();

    lastSunlightTime = millis();
  }


  // -----------------------------------------
  // Upload data every 1 minute
  // -----------------------------------------

  if (
    millis() - lastUploadTime >= UPLOAD_INTERVAL ||
    lastUploadTime == 0
  ) {

    sendDataToServer();

    lastUploadTime = millis();
  }


  // -----------------------------------------
  // Save energy data every 10 minutes
  // -----------------------------------------

  if (millis() - lastSaveTime >= SAVE_INTERVAL) {

    saveData();

    lastSaveTime = millis();
  }


  // -----------------------------------------
  // Low battery alarm
  // -----------------------------------------

  if (
    batteryPercent() < LOW_BATTERY_PERCENT &&
    millis() - lastAlarmTime >= ALARM_INTERVAL
  ) {

    Serial.println("WARNING: Battery low!");

    beep(3, 200);

    lastAlarmTime = millis();
  }


  delay(1000);
}


// =====================================================
// WIFI CONNECTION
// =====================================================

void connectWiFi() {

  WiFi.mode(WIFI_STA);

  WiFi.begin(
    WIFI_SSID,
    WIFI_PASSWORD
  );

  Serial.print("Connecting to WiFi");

  int attempts = 0;

  while (
    WiFi.status() != WL_CONNECTED &&
    attempts < 40
  ) {

    delay(500);

    Serial.print(".");

    attempts++;
  }


  if (WiFi.status() == WL_CONNECTED) {

    Serial.println();

    Serial.println("WiFi connected.");

    Serial.print("IP Address: ");

    Serial.println(
      WiFi.localIP()
    );

  } else {

    Serial.println();

    Serial.println(
      "WiFi connection failed."
    );
  }
}


// =====================================================
// SOIL MOISTURE
// =====================================================

int readSoilRaw() {

  // Average 10 readings for a stable value
  long sum = 0;

  for (int i = 0; i < 10; i++) {

    sum += analogRead(SOIL_SENSOR_PIN);

    delay(2);
  }

  return sum / 10;
}


int calculateSoilMoisture(int rawValue) {

  int moisture = map(
    rawValue,
    DRY_VALUE,
    WET_VALUE,
    0,
    100
  );

  moisture = constrain(
    moisture,
    0,
    100
  );

  return moisture;
}


// =====================================================
// ENERGY CALCULATION
// =====================================================
//
// Pump energy (Wh)  = 9 W x pump ON time (hours)
// Solar power (W)   = panel W x (sunlight / 1000) x 0.75   [estimated]
// Battery (Wh)     += solar x 0.85 - (pump + relay + ESP)  [estimated]

void updateEnergy() {

  unsigned long nowMs = millis();

  float hours = (nowMs - lastEnergyUpdate) / 3600000.0;

  lastEnergyUpdate = nowMs;


  // Solar (estimated from live sunlight)
  solarPowerW = PANEL_W * (irradiance / 1000.0) * PANEL_LOSS;

  if (solarPowerW > MAX_CHARGE_W) {

    solarPowerW = MAX_CHARGE_W;
  }

  float solarWh = solarPowerW * hours;


  // Pump energy
  float pumpWh = pumpRunning ? PUMP_POWER_W * hours : 0;


  // Total load on battery
  float loadW = ESP_BASE_W;

  if (pumpRunning) {

    loadW += PUMP_POWER_W + RELAY_COIL_W;
  }

  float loadWh = loadW * hours;


  // Add to totals
  data.solarEnergyTodayWh += solarWh;
  data.solarEnergyTotalWh += solarWh;

  data.pumpEnergyTodayWh += pumpWh;
  data.pumpEnergyTotalWh += pumpWh;


  // Battery energy balance
  data.batteryWh += solarWh * CHARGE_EFFICIENCY - loadWh;

  data.batteryWh = constrain(
    data.batteryWh,
    0.0f,
    BATTERY_CAPACITY_WH
  );
}


float batteryPercent() {

  return data.batteryWh / BATTERY_CAPACITY_WH * 100.0;
}


// =====================================================
// IS THE CLOCK REAL?
// =====================================================
//
// An unsynced ESP8266 sits near epoch 0 (1970). The threshold is a recent
// date rather than a small number, so a partially-set clock cannot pass.

bool isTimeValid() {

  return time(nullptr) > 1700000000;   // after Nov 2023
}


// =====================================================
// SUNLIGHT FROM OPEN-METEO
// =====================================================

void fetchSunlight() {

  if (WiFi.status() != WL_CONNECTED) {

    return;
  }

  std::unique_ptr<BearSSL::WiFiClientSecure> client(
    new BearSSL::WiFiClientSecure
  );

  client->setInsecure();

  HTTPClient https;

  String url = "https://api.open-meteo.com/v1/forecast?latitude=";
  url += String(LATITUDE, 4);
  url += "&longitude=";
  url += String(LONGITUDE, 4);
  url += "&current=shortwave_radiation";

  if (!https.begin(*client, url)) {

    Serial.println("Sunlight request failed.");

    return;
  }

  int httpCode = https.GET();

  if (httpCode == 200) {

    String body = https.getString();

    // Skip "current_units" and read the value inside "current"
    int currentPos = body.indexOf("\"current\":{");

    int valuePos = -1;

    if (currentPos >= 0) {

      valuePos = body.indexOf(
        "\"shortwave_radiation\":",
        currentPos
      );
    }

    if (valuePos >= 0) {

      irradiance = body.substring(valuePos + 22).toFloat();

      Serial.print("Sunlight: ");
      Serial.print(irradiance);
      Serial.println(" W/m2");
    }

  } else {

    Serial.print("Sunlight HTTP error: ");
    Serial.println(httpCode);
  }

  https.end();
}


// =====================================================
// SEND DATA TO BACKEND
// =====================================================

void sendDataToServer() {

  if (WiFi.status() != WL_CONNECTED) {

    Serial.println(
      "Cannot send data - WiFi disconnected."
    );

    return;
  }


  WiFiClient client;

  HTTPClient http;

  Serial.println();
  Serial.println("Sending data to server...");


  if (!http.begin(client, READINGS_URL)) {

    Serial.println(
      "HTTP connection failed."
    );

    return;
  }


  // -----------------------------------------
  // Create JSON
  // -----------------------------------------
  // solar_voltage, solar_current, battery_voltage,
  // battery_current and temperature are not sent:
  // this board has no sensors for them (server stores NULL).

  String json = "{";

  json += "\"device_id\":\"";
  json += DEVICE_ID;
  json += "\",";

  json += "\"location_name\":\"";
  json += LOCATION_NAME;
  json += "\",";

  // Column names the backend reads. Sending "latitude"/"longitude" would be
  // accepted but silently ignored, leaving the weather card on its default
  // location.
  json += "\"location_lat\":";
  json += String(LATITUDE, 6);
  json += ",";

  json += "\"location_lon\":";
  json += String(LONGITUDE, 6);
  json += ",";

  // Sent only when the clock is real. Omitting it makes the backend stamp
  // the reading with its own server time, which is far better than
  // uploading a 1970 date that would sit outside every chart window.
  if (timeSynced) {

    time_t now = time(nullptr);

    struct tm* t = localtime(&now);

    char timestamp[30];

    strftime(
      timestamp,
      sizeof(timestamp),
      "%Y-%m-%dT%H:%M:%S+05:30",
      t
    );

    json += "\"timestamp\":\"";
    json += timestamp;
    json += "\",";
  }

  json += "\"soil_moisture\":";
  json += String(soilMoisture);
  json += ",";

  // MUST be the string "on"/"off". A boolean here is rejected with
  // HTTP 400 "Pump status must be \"on\" or \"off\"".
  json += "\"pump_status\":\"";
  json += pumpRunning ? "on" : "off";
  json += "\",";

  json += "\"auto_mode\":";
  json += autoMode ? "true" : "false";
  json += ",";

  json += "\"pump_energy_today_wh\":";
  json += String(data.pumpEnergyTodayWh, 3);
  json += ",";

  json += "\"pump_energy_total_wh\":";
  json += String(data.pumpEnergyTotalWh, 3);
  json += ",";

  json += "\"pump_last_run_sec\":";
  json += String(lastRunSeconds);
  json += ",";

  json += "\"pump_last_run_wh\":";
  json += String(lastRunWh, 3);
  json += ",";

  json += "\"waterings_today\":";
  json += String(data.wateringsToday);
  json += ",";

  json += "\"irradiance\":";
  json += String(irradiance, 1);
  json += ",";

  json += "\"solar_power\":";
  json += String(solarPowerW, 2);
  json += ",";

  json += "\"solar_energy_today_wh\":";
  json += String(data.solarEnergyTodayWh, 2);
  json += ",";

  json += "\"solar_energy_total_wh\":";
  json += String(data.solarEnergyTotalWh, 2);
  json += ",";

  json += "\"battery_percentage\":";
  json += String(batteryPercent(), 1);
  json += ",";

  json += "\"is_estimated\":true";

  json += "}";


  // -----------------------------------------
  // HTTP request
  // -----------------------------------------

  http.addHeader(
    "Content-Type",
    "application/json"
  );

  http.addHeader(
    "x-device-key",
    DEVICE_KEY
  );


  Serial.println("JSON:");

  Serial.println(json);


  int httpCode = http.POST(json);


  if (httpCode > 0) {

    Serial.print("HTTP Response: ");

    Serial.println(httpCode);

    String response = http.getString();

    Serial.println("Server Response:");

    Serial.println(response);

  } else {

    Serial.print(
      "HTTP POST failed: "
    );

    Serial.println(
      http.errorToString(httpCode)
    );
  }


  http.end();
}


// =====================================================
// DASHBOARD COMMANDS (GET /api/pump/status)
// =====================================================
//
// Supported actions:
// on | off | auto_on | auto_off | set_battery:<0-100>

void checkPumpCommand() {

  if (WiFi.status() != WL_CONNECTED) {

    return;
  }

  WiFiClient client;

  HTTPClient http;

  if (!http.begin(client, PUMP_STATUS_URL)) {

    return;
  }

  http.addHeader(
    "x-device-key",
    DEVICE_KEY
  );

  int httpCode = http.GET();

  if (httpCode == 200) {

    String body = http.getString();

    if (body.indexOf("\"pending\":true") >= 0) {

      String action = extractAction(body);

      Serial.print("Command received: ");
      Serial.println(action);

      runCommand(action);
    }
  }

  http.end();
}


// Finds the action text in the server reply.
// Works for {"command":"on"} and {"command":{"action":"on"}}

String extractAction(String body) {

  int pos = body.indexOf("\"action\":\"");

  int skip = 10;

  if (pos < 0) {

    pos = body.indexOf("\"command\":\"");

    skip = 11;
  }

  if (pos < 0) {

    return "";
  }

  int start = pos + skip;

  int end = body.indexOf("\"", start);

  if (end < 0) {

    return "";
  }

  return body.substring(start, end);
}


void runCommand(String action) {

  if (action == "on") {

    if (batteryPercent() <= 5) {

      Serial.println("Battery too low - pump not started.");

      return;
    }

    startPump(MANUAL_MAX_SECONDS);

  } else if (action == "off") {

    stopPump();

  } else if (action == "auto_on") {

    autoMode = true;

    Serial.println("Auto mode ON");

    beep(1, 80);

  } else if (action == "auto_off") {

    autoMode = false;

    Serial.println("Auto mode OFF (manual)");

    beep(1, 80);

  } else if (action.startsWith("set_battery:")) {

    int percent = action.substring(12).toInt();

    if (percent >= 0 && percent <= 100) {

      data.batteryWh = BATTERY_CAPACITY_WH * percent / 100.0;

      saveData();

      Serial.print("Battery set to ");
      Serial.print(percent);
      Serial.println("%");

      beep(1, 80);
    }

  } else {

    Serial.println("Unknown command.");

    return;
  }

  // Send the new state to the dashboard right away
  sendDataToServer();

  lastUploadTime = millis();
}


// =====================================================
// PUMP CONTROL (non-blocking)
// =====================================================

void startPump(int seconds) {

  if (pumpRunning) {

    return;
  }

  updateEnergy();

  relayOn();

  pumpRunning = true;

  pumpStartTime = millis();

  pumpRunLimitMs = seconds * 1000UL;

  data.wateringsToday++;

  beep(1, 150);

  Serial.println("Pump ON");

  sendDataToServer();

  lastUploadTime = millis();
}


void stopPump() {

  if (!pumpRunning) {

    return;
  }

  updateEnergy();   // count energy up to this exact moment

  relayOff();

  pumpRunning = false;

  unsigned long runMs = millis() - pumpStartTime;

  lastRunSeconds = runMs / 1000;

  lastRunWh = PUMP_POWER_W * (runMs / 3600000.0);

  saveData();

  Serial.print("Pump OFF | Ran ");
  Serial.print(lastRunSeconds);
  Serial.print(" s | Used ");
  Serial.print(lastRunWh, 3);
  Serial.println(" Wh");

  sendDataToServer();

  lastUploadTime = millis();
}


// =====================================================
// RELAY ON
// =====================================================

void relayOn() {

  digitalWrite(
    RELAY_PIN,
    RELAY_ACTIVE_HIGH
      ? HIGH
      : LOW
  );
}


// =====================================================
// RELAY OFF
// =====================================================

void relayOff() {

  digitalWrite(
    RELAY_PIN,
    RELAY_ACTIVE_HIGH
      ? LOW
      : HIGH
  );
}


// =====================================================
// BUZZER
// =====================================================

void beep(int times, int ms) {

  for (int i = 0; i < times; i++) {

    digitalWrite(BUZZER_PIN, HIGH);

    delay(ms);

    digitalWrite(BUZZER_PIN, LOW);

    delay(ms);
  }
}


// =====================================================
// SAVE / LOAD (EEPROM)
// =====================================================

void loadData() {

  EEPROM.begin(sizeof(SavedData) + 8);

  EEPROM.get(0, data);

  if (data.magic != MAGIC || isnan(data.batteryWh)) {

    Serial.println("First boot - starting battery at 50%.");

    data.magic = MAGIC;
    data.batteryWh = BATTERY_CAPACITY_WH * 0.5;
    data.pumpEnergyTodayWh = 0;
    data.pumpEnergyTotalWh = 0;
    data.solarEnergyTodayWh = 0;
    data.solarEnergyTotalWh = 0;
    data.wateringsToday = 0;
    data.savedDay = -1;

    saveData();
  }
}


void saveData() {

  EEPROM.put(0, data);

  EEPROM.commit();
}


// =====================================================
// PRINT CURRENT TIME
// =====================================================

void printCurrentTime() {

  time_t now = time(nullptr);

  struct tm* t = localtime(&now);

  Serial.printf(
    "Current time: %02d:%02d:%02d\n",
    t->tm_hour,
    t->tm_min,
    t->tm_sec
  );
}
