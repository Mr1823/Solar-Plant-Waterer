/**
 * Solar Plant Waterer — ESP-12E (ESP8266) device configuration.
 *
 * Copy this file to `config.h` and fill in your values.
 * `config.h` is gitignored via firmware/.gitignore (its bare `config.h`
 * pattern matches this subfolder too) because it holds your WiFi password.
 *
 * Board target in Arduino IDE: "Generic ESP8266 Module". A bare ESP-12E has
 * no onboard USB-serial, regulator, or boot-strap resistors the way a
 * NodeMCU dev board does — read this folder's README before powering it up.
 */
#pragma once

// ── Network ──────────────────────────────────────────────────────────────
#define WIFI_SSID         "your-wifi-name"
#define WIFI_PASSWORD     "your-wifi-password"

// Where the backend runs. Use the machine's LAN IP, not "localhost".
#define SERVER_HOST       "192.168.1.100"
#define SERVER_PORT       3001

// ── Location ─────────────────────────────────────────────────────────────
#define LOCATION_NAME     "My Garden"
#define LOCATION_LAT      9.59
#define LOCATION_LON      77.95

// UTC offset in seconds — used only for matching schedules against local
// wall-clock time. Timestamps sent to the server are always true UTC,
// independent of this value (see localNow() in the .ino for why).
// India (UTC+5:30) = 19800   UK (GMT) = 0   US Eastern (UTC-5) = -18000
#define UTC_OFFSET_SEC    19800
#define DST_OFFSET_SEC    0      // add 3600 here during DST if your region observes it

// ── Pins (bare ESP-12E module pad names, not NodeMCU "D" labels) ─────────
// GPIO0, GPIO2, GPIO15, GPIO16, GPIO9/10 and TX/RX are deliberately avoided
// below — each carries a boot-mode requirement or is needed for flashing.
// See this folder's README for the full reasoning and the minimal external
// wiring a bare module needs (EN, RST, GPIO0/2/15 pull resistors) that a
// NodeMCU dev board would otherwise handle for you.
#define PIN_I2C_SDA          4   // solar + battery sensors (INA219 x2)
#define PIN_I2C_SCL          5
#define PIN_TEMPERATURE     14   // DS18B20 1-Wire data
#define PIN_RELAY           12   // Pump relay

// Most cheap relay boards switch ON when the pin is pulled LOW.
#define RELAY_ACTIVE_LOW    true

// ── Current/voltage sensing ──────────────────────────────────────────────
// The ESP8266 has exactly ONE analog pin (A0, 0-1V native), which cannot
// cover the four channels (solar V, solar I, battery V, battery I) the way
// the ESP32 build's four separate ADC pins did — there's no multiplexer
// substitute for that on this chip without extra hardware.
//
// Two INA219 breakouts on the same I2C bus solve this cleanly: each one
// measures its own bus voltage AND current, factory-calibrated, no divider
// math or 5V-to-3.3V level shifting required. Default I2C address is 0x40;
// the second board needs its A0 address solder-jumper bridged (see README)
// to move it to 0x41, or the two will collide on the bus.
#define INA219_SOLAR_ADDR    0x40
#define INA219_BATTERY_ADDR  0x41

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
// if it drops here. If the battery sensor can't be reached at boot, charge
// reads as 0% and the pump refuses to start — a safe failure mode.
#define MIN_BATTERY_PCT_TO_PUMP  35.0

// ── Timing (milliseconds) ────────────────────────────────────────────────
#define POST_INTERVAL_MS       60000UL   // push a reading every minute
#define COMMAND_POLL_MS         3000UL   // check for Water Now / Stop
#define SCHEDULE_REFRESH_MS   300000UL   // re-read schedules every 5 min
#define WIFI_RETRY_MS          10000UL

#define MAX_SCHEDULES          8

// How many queued commands to drain in one poll (see pollCommands() in the
// .ino for why this exists even though the backend now acknowledges the
// whole queue in one request).
#define MAX_COMMAND_DRAIN      10
