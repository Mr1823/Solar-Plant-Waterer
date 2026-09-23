# ESP32 Firmware — Solar Plant Waterer

Reads the solar/battery/temperature sensors, drives the pump relay, and talks
to the backend in [`../backend`](../backend).

## Setup

1. **Arduino IDE** → Boards Manager → install **esp32** by Espressif (v2.0.0+;
   earlier cores lack `analogReadMilliVolts`).
2. Library Manager → install:
   - `ArduinoJson` by Benoit Blanchon (**v7+**)
   - `OneWire` by Paul Stoffregen
   - `DallasTemperature` by Miles Burton
3. `cp solar_plant_waterer/config.example.h solar_plant_waterer/config.h`
   and fill in WiFi, the backend's **LAN IP** (not `localhost` — on the ESP32
   that means the ESP32), your timezone, and the divider ratios.
4. Board: **ESP32 Dev Module**. Upload, then open Serial Monitor at **115200**.

## Wiring

| Signal          | GPIO | Notes                                              |
| --------------- | ---- | -------------------------------------------------- |
| Solar voltage   | 34   | via divider, ADC1, input-only                      |
| Solar current   | 35   | ACS712 output via divider, ADC1                    |
| Battery voltage | 32   | via divider, ADC1                                  |
| Battery current | 33   | ACS712 output via divider, ADC1                    |
| Temperature     | 4    | DS18B20 data, 4.7kΩ pull-up to 3.3V                |
| Pump relay      | 26   | relay IN; set `RELAY_ACTIVE_LOW` to match the board |

### Two things that will cost you an afternoon

**Analog inputs must be on ADC1 (GPIO 32–39).** ADC2 pins stop working the
moment WiFi is active — it is a hardware limitation, not a bug in your code.
Symptom: every reading is 0 or garbage, but only once WiFi connects.

**The ACS712 is a 5V part.** Its output swings to 5V and will damage a 3.3V
ADC pin. Put a divider on its output (10k/20k = ratio 1.5) and set
`CURRENT_OUT_DIVIDER` to match. If you are still buying parts, an **INA219**
breakout is the better choice: 3.3V-safe, I²C, and it measures bus voltage and
current together, replacing both the divider and the ACS712 per channel.

## Calibration

Dividers are never exactly their nominal ratio — resistor tolerance alone is
±1%. With the panel connected:

1. Measure actual voltage at the input with a multimeter.
2. Read what the Serial Monitor reports.
3. `NEW_RATIO = OLD_RATIO × (multimeter ÷ reported)`.

For current, note the millivolts reported with **no load** and set
`ACS712_ZERO_MV` to that — the 2500 mV nominal is rarely exact.

Battery percentage comes from a resting-voltage curve for 12V lead-acid
(`batteryPercent()`). It reads high while charging and low under load. Swap the
table if you move to LiFePO4; that chemistry's curve is nearly flat and this
one would report ~100% until it falls off a cliff.

## How it behaves

| Interval | Action                                                        |
| -------- | ------------------------------------------------------------- |
| 60s      | `POST /api/readings`                                           |
| 3s       | `GET /api/pump/status` — Water Now / Stop Pump                 |
| 5 min    | `GET /api/pump/schedule` — refresh schedules                   |
| every loop | pump safety timers and due-schedule check                    |

### Schedules run on the device

**The backend stores schedules but never fires them** — there is no cron
turning them into pump commands. This firmware executes them itself against
NTP local time, so watering keeps working when WiFi or the server is down.
It also reports `pump_last_run` and `pump_next_scheduled_run` back, which is
what fills those two fields on the dashboard's pump card.

If you later add a server-side scheduler, delete `runDueSchedules()` here
first or the pump will run twice.

### Safety

The server has **no auto-off**: a manual "on" runs until a matching "off"
arrives. If WiFi drops in between, nothing server-side will ever stop the
pump. Three local guards cover that:

- `MAX_PUMP_RUNTIME_S` — hard ceiling on any single run, applied to manual and
  scheduled runs alike.
- `MIN_BATTERY_PCT_TO_PUMP` — refuses to start, and cuts off a running pump,
  below this charge. A flat lead-acid battery is a dead lead-acid battery.
- The relay is driven LOW in `setup()` before anything that can block, so a
  brown-out reboot cannot leave the pump running unattended.

### Stale commands

`GET /api/pump/status` returns the newest pending command and acknowledges
everything queued behind it in the same request, so one GET is normally all it
takes. `pollCommands()` still drains the queue and honours only the first
reply — that is correct against an older backend too, where stale commands
came back on later polls and a superseded "on" could restart a pump you had
just stopped.

## Troubleshooting

| Symptom | Cause |
| ------- | ----- |
| Readings all 0 after WiFi connects | Analog pin is on ADC2 — move to GPIO 32–39 |
| `HTTP 400` in Serial Monitor | The response names the rejected field; usually a negative `solar_current` or a temperature outside −40…80 |
| `HTTP -1` | Wrong `SERVER_HOST`, wrong port, or the device is on a different subnet |
| Temperature reads −127 | DS18B20 not found: check the 4.7kΩ pull-up and the data pin |
| Schedules never fire | NTP not synced (Serial says so) or the schedule's day bit does not include today |
| Pump stops early | `MAX_PUMP_RUNTIME_S` — raise it, it caps scheduled runs too |
