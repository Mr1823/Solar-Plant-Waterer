# ESP-12E (ESP8266) Firmware — Solar Plant Waterer

An ESP8266 build of the same firmware in [`../solar_plant_waterer`](../solar_plant_waterer)
(ESP32), for anyone building on an ESP-12E module instead. It talks to the
same backend, the same endpoints, the same JSON — only the sensing hardware
and a few platform APIs differ. If you're deciding which chip to build on and
haven't bought parts yet, read **"Why this isn't a drop-in port"** below first.

## Why this isn't a drop-in port

The ESP32 build reads solar voltage, solar current, battery voltage and
battery current from **four separate analog pins**. The ESP8266 has **exactly
one** analog pin (`A0`), and there's no way to multiplex four channels onto it
without extra hardware.

This build uses **two INA219 breakouts on I2C** instead — one per rail. Each
INA219 measures its own bus voltage *and* current, factory-calibrated, so
there's no divider math, no 5V-to-3.3V level shifting for the current sensor's
output, and no manual zero-point calibration. This is a strictly better
sensing setup than the ESP32 build's resistor-dividers + ACS712 approach —
it's what that build's own README already recommends as the upgrade path,
we're just starting here instead of migrating to it later.

If you'd rather stick with your existing ACS712 + divider hardware, you'll
need an analog multiplexer (a CD4051 is the usual choice) feeding the single
`A0` pin, cycling through four channels in software. That's a real rewrite of
the sensor-reading functions, not covered by this file — the INA219 path is
simpler and cheaper (~$3 each) if you're still buying parts.

## Setup

1. **Arduino IDE** → Boards Manager → install **esp8266** by ESP8266 Community
   (core 3.0+; earlier cores may lack the modern `HTTPClient::begin(client, url)`
   signature this sketch uses).
2. Library Manager → install:
   - `ArduinoJson` by Benoit Blanchon (**v7+**)
   - `OneWire` by Paul Stoffregen
   - `DallasTemperature` by Miles Burton
   - `Adafruit INA219` by Adafruit
   - `Adafruit BusIO` by Adafruit (INA219's I2C dependency — usually pulled
     in automatically, but check if `begin()` fails to compile)
3. `cp config.example.h config.h` and fill in WiFi, the backend's **LAN IP**
   (not `localhost`), your UTC offset, and the two INA219 addresses.
4. Board: **Generic ESP8266 Module**. Flash mode: DIO. Flash size: whatever
   your specific module has (commonly 4MB). Upload, then Serial Monitor at
   **115200**.

## A bare ESP-12E is not a dev board — read this before powering it up

A NodeMCU or Wemos D1 Mini wires all of this for you. A bare ESP-12E module
needs it done by hand, and skipping it is the most common reason a "new"
module never boots:

| Pin | Requirement |
| --- | ----------- |
| `EN` / `CH_PD` | Pull **HIGH** via 10kΩ to 3.3V. Floating = the module never starts. |
| `RST` | Pull HIGH via 10kΩ to 3.3V (add a push-button to GND if you want a manual reset). |
| `GPIO0` | Pull HIGH via 10kΩ for normal boot. Pull LOW at boot to enter flash mode. |
| `GPIO2` | Pull HIGH via 10kΩ. Must not be LOW at boot. |
| `GPIO15` | Pull **LOW** via 10kΩ to GND. Must not be HIGH at boot — this is the one that's backwards from the other two and easy to get wrong. |

**Power supply:** the ESP8266 draws current spikes up to ~300mA during WiFi
transmission. A weak regulator or a long thin wire from your 3.3V source will
brown out and silently reset the module mid-transmission — this looks like
random reboots or a device that "sometimes doesn't post." Use a proper buck
converter or AMS1117-3.3 rated for at least 500mA, and put a 100–220µF
capacitor across 3.3V/GND right at the module.

## Wiring

| Signal | GPIO (bare module pad) | Notes |
| --- | --- | --- |
| I2C SDA | GPIO4 | shared bus, both INA219s |
| I2C SCL | GPIO5 | shared bus, both INA219s |
| Temperature | GPIO14 | DS18B20 data, 4.7kΩ pull-up to 3.3V |
| Pump relay | GPIO12 | relay IN; set `RELAY_ACTIVE_LOW` to match your board |

`GPIO0`, `GPIO2`, `GPIO15`, `GPIO16`, `GPIO9`/`GPIO10`, and `TX`/`RX` are
deliberately avoided for anything in this build — the first three carry the
boot-mode requirements above, 9/10 are wired to the internal flash chip on
most ESP-12E modules, and TX/RX are needed for Serial output and flashing.

### INA219 wiring

Each INA219 measures the voltage and current of whatever passes through its
`VIN+`/`VIN-` terminals — wire it **in series** with the rail it's monitoring:

- **Solar INA219**: `VIN+` to the panel's positive lead, `VIN-` to the charge
  controller's solar input.
- **Battery INA219**: `VIN+` to the battery's positive terminal, `VIN-` to the
  charge controller's battery terminal (current flowing into the battery
  while charging reads positive, matching the dashboard's charging/discharging
  logic).

Both share the same I2C bus (SDA/SCL) but need **different addresses**. The
Adafruit board defaults to `0x40`. Bridge the **A0** solder-jumper pad on the
*second* board (the one you set as `INA219_BATTERY_ADDR`) to move it to
`0x41` — check the silkscreen on the back of the board for the exact pads.
Without this, both sensors answer to the same address and the second `begin()`
call in `setup()` will silently talk to the first sensor instead.

## Calibration

The Adafruit INA219 library's default calibration (`setCalibration_32V_2A()`,
applied automatically by `begin()`) covers up to 3.2A at 32V, which is
comfortably inside range for a small solar setup. If your panel can exceed
that, call a different calibration profile — see the library's examples for
`setCalibration_16V_400mA()` etc. and the tradeoff (lower range = finer
resolution).

Battery percentage comes from a resting-voltage curve for 12V lead-acid
(`batteryPercent()`, identical to the ESP32 build). It reads high while
charging and low under load — an estimate, not a fuel gauge. Swap the table
if you move to LiFePO4; that chemistry's curve is nearly flat and this one
would report ~100% until it falls off a cliff.

## How it behaves

Identical cadence and safety model to the ESP32 build:

| Interval | Action |
| --- | --- |
| 60s | `POST /api/readings` |
| 3s | `GET /api/pump/status` — Water Now / Stop Pump |
| 5 min | `GET /api/pump/schedule` — refresh schedules |
| every loop | pump safety timers and due-schedule check |

**Schedules run on the device** — the backend stores them but never fires
them, so this firmware executes them itself against NTP time. See the ESP32
README's "Schedules run on the device" section for the full reasoning; it
applies here unchanged.

**Safety**: `MAX_PUMP_RUNTIME_S` caps every run (manual or scheduled),
`MIN_BATTERY_PCT_TO_PUMP` refuses to start and cuts off a running pump below
that charge — and if a sensor never responds at boot, its readings are 0V/0A,
which reads as 0% charge and keeps the pump refusing to start. Failing closed,
not open. The relay is driven LOW in `setup()` before anything that can block,
so a brown-out reboot can't leave the pump running unattended.

**Stale commands** are drained the same way as the ESP32 build — see
`pollCommands()`'s comment for why the loop exists even though the backend
now acknowledges its whole queue in one request.

### One implementation difference worth knowing: how local time is computed

The ESP32 build sets its clock via `configTzTime()` with a POSIX timezone
string and lets `localtime_r()`/`mktime()` do the conversion. This build keeps
the clock on **true UTC** (`configTime(0, 0, ...)`) and does the local-time
arithmetic itself in `localNow()` — adding `UTC_OFFSET_SEC` to the epoch and
reading fields via `gmtime_r()`, which never re-applies a timezone. This
sidesteps ESP8266-core-version differences in how `configTime`'s offset
parameters interact with `localtime()`, at the cost of `config.h` taking a
plain numeric UTC offset instead of a POSIX TZ string. No DST rule handling —
set `DST_OFFSET_SEC` to `3600` manually during DST if your region observes it.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Module never boots / nothing on Serial | Check `EN`, `GPIO0`, `GPIO2`, `GPIO15` pull resistors — see the boot-strapping table above |
| Random reboots, especially right after a WiFi POST | Weak power supply — add a bulk capacitor and check the regulator's current rating |
| Both INA219 readings are identical / one is always 0 | Address collision — confirm the second board's A0 jumper is actually bridged |
| `[i2c] ... NOT FOUND` in Serial | Check SDA/SCL wiring, and that both breakouts share a common GND with the ESP8266 |
| Temperature reads −127 | DS18B20 not found: check the 4.7kΩ pull-up and the data pin |
| `HTTP 400` in Serial Monitor | The response names the rejected field; usually a negative `solar_current` or a temperature outside −40…80 |
| `HTTP -1` | Wrong `SERVER_HOST`, wrong port, or the device is on a different subnet |
| Schedules never fire | NTP not synced (Serial says so), or `UTC_OFFSET_SEC` is wrong for your region |
| Pump stops early | `MAX_PUMP_RUNTIME_S` — raise it, it caps scheduled runs too |
