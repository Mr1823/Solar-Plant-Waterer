/**
 * Solar Plant Waterer — device configuration.
 *
 * Copy this file to `config.h` and fill in your values.
 * `config.h` is gitignored because it holds your WiFi password.
 */
#pragma once

// ── Network ──────────────────────────────────────────────────────────────
#define WIFI_SSID         "your-wifi-name"
#define WIFI_PASSWORD     "your-wifi-password"

// Where the backend runs. Use the machine's LAN IP, not "localhost" —
// localhost on the ESP32 means the ESP32 itself.
#define SERVER_HOST       "192.168.1.100"
#define SERVER_PORT       3001

// ── Location ─────────────────────────────────────────────────────────────
// Shown in the dashboard header; lat/lon also drive the weather lookup.
#define LOCATION_NAME     "My Garden"
#define LOCATION_LAT      8.96
#define LOCATION_LON      77.31

// POSIX timezone string — note the sign is INVERTED from UTC offset.
// India (UTC+5:30) = "IST-5:30"   UK = "GMT0BST,M3.5.0/1,M10.5.0"
// US Eastern = "EST5EDT,M3.2.0,M11.1.0"
// Schedules run on local time; timestamps are sent to the server as UTC.
#define TIMEZONE          "IST-5:30"

// ── Pins ─────────────────────────────────────────────────────────────────
// IMPORTANT: analog inputs must be on ADC1 (GPIO 32-39). ADC2 pins do not
// work while WiFi is active — this is an ESP32 hardware limitation and the
// single most common cause of "my readings are all zero" on this project.
#define PIN_SOLAR_VOLTAGE   34   // ADC1, input-only
#define PIN_SOLAR_CURRENT   35   // ADC1, input-only
#define PIN_BATTERY_VOLTAGE 32   // ADC1
#define PIN_BATTERY_CURRENT 33   // ADC1
#define PIN_TEMPERATURE      4   // DS18B20 1-Wire data
#define PIN_RELAY           26   // Pump relay

// Most cheap relay boards switch ON when the pin is pulled LOW.
#define RELAY_ACTIVE_LOW    true

// ── Voltage dividers ─────────────────────────────────────────────────────
// ratio = (R1 + R2) / R2, where R1 is the top resistor and R2 goes to GND.
// Size them so the divided voltage never exceeds 3.3V at your panel's peak.
// Solar 25V max: R1=100k, R2=15k -> 3.26V  => ratio 7.667
// Battery 15V max: R1=100k, R2=30k -> 3.46V => ratio 4.333
#define SOLAR_VOLTAGE_RATIO    7.667
#define BATTERY_VOLTAGE_RATIO  4.333

// ── Current sensors (ACS712) ─────────────────────────────────────────────
// The ACS712 is a 5V part: its output swings 0-5V and WILL damage a 3.3V
// ADC pin. Put a divider on its OUTPUT (e.g. 10k/20k = ratio 1.5) and set
// it here. Prefer an INA219 breakout if you're buying new — it's 3.3V-safe
// and measures voltage and current together (see firmware/README.md).
#define CURRENT_OUT_DIVIDER    1.5      // ratio applied to the sensor output
#define ACS712_ZERO_MV         2500.0   // output at 0A, before the divider
#define ACS712_MV_PER_AMP      185.0    // 185 = 5A part, 100 = 20A, 66 = 30A

// ── Battery pack ─────────────────────────────────────────────────────────
// Percentages are mapped from resting voltage for a 12V lead-acid battery.
#define BATTERY_NOMINAL_V      12.0

// ── Safety ───────────────────────────────────────────────────────────────
// Hard ceiling on a single pump run. The server has no auto-off: a manual
// "on" runs until a matching "off" arrives, so if WiFi drops in between,
// this timer is the only thing that stops the pump. Keep it conservative.
#define MAX_PUMP_RUNTIME_S     120

// A manual "Water Now" runs for this long unless stopped sooner.
#define MANUAL_PUMP_RUNTIME_S  60

// Refuse to start the pump below this charge, and cut a running pump off
// if it drops here — a flat lead-acid battery is a dead lead-acid battery.
#define MIN_BATTERY_PCT_TO_PUMP  35.0

// ── Timing (milliseconds) ────────────────────────────────────────────────
#define POST_INTERVAL_MS       60000UL   // push a reading every minute
#define COMMAND_POLL_MS         3000UL   // check for Water Now / Stop
#define SCHEDULE_REFRESH_MS   300000UL   // re-read schedules every 5 min
#define WIFI_RETRY_MS          10000UL

#define MAX_SCHEDULES          8

// How many queued commands to drain in one poll. See pollCommands().
#define MAX_COMMAND_DRAIN      10
