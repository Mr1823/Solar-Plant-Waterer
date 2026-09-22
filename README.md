# 🌱 Solar Plant Waterer — IoT Dashboard

A full-stack IoT dashboard for monitoring and controlling a solar-powered, time-based plant watering system.

## Architecture

```
ESP32 ──HTTP POST──▶ Express Backend ──Socket.IO──▶ React Dashboard
                            │                            │
        ┌───────────────────┼───────────────────┐   Recharts / UI
        │                   │                   │
    SQLite DB           Groq API         OpenWeatherMap
                      (AI insights)   (current conditions)
```

Weather is folded into the AI prompt, so insights can factor in rain when
recommending whether the next watering cycle is needed.

## Tech Stack

| Layer    | Tech                                    |
| -------- | --------------------------------------- |
| Frontend | React (Vite), Tailwind CSS v4, Recharts |
| Backend  | Node.js, Express, Socket.IO             |
| Database | SQLite (via sql.js — zero config)        |
| AI       | Groq API (llama-3.1-8b-instant)         |
| Weather  | OpenWeatherMap Current Weather API      |
| Hardware | ESP32, relay, 12V battery, solar panel   |

## Quick Start

### 1. Backend

```bash
cd backend
cp .env.example .env
# Edit .env — add your GROQ_API_KEY and OPENWEATHER_API_KEY

npm install
npm run seed    # Load demo data (optional)
npm run dev     # Starts on http://localhost:3001
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev     # Starts on http://localhost:5173
```

The Vite dev server proxies `/api/*` and `/socket.io/*` to `localhost:3001`.

## Environment Variables

### Backend (`backend/.env`)

| Variable               | Required | Default           | Description                                  |
| ---------------------- | -------- | ----------------- | -------------------------------------------- |
| `PORT`                 | No       | `3001`            | Server port                                  |
| `FRONTEND_URL`         | No       | `*`               | Origin allowed to open the Socket.IO connection |
| `GROQ_API_KEY`         | Yes\*    | —                 | Groq API key for AI insights                 |
| `OPENWEATHER_API_KEY`  | No       | —                 | OpenWeatherMap key for current conditions    |
| `DB_PATH`              | No       | `./data/solar.db` | SQLite file path                             |

\*Missing keys degrade gracefully: the AI card shows a friendly empty state and
`/api/weather` returns 503. Everything else keeps working.

Leave `FRONTEND_URL` unset in development — the `*` fallback is what lets you
open the dashboard from another device on the LAN (your phone at
`http://192.168.x.x:5173`). Set it to the exact dashboard URL in production.

## API Endpoints

### Readings (ESP32 → Backend)

| Method | Path                     | Description              |
| ------ | ------------------------ | ------------------------ |
| POST   | `/api/readings`          | Push a new sensor reading |
| GET    | `/api/readings/latest`   | Latest reading           |
| GET    | `/api/readings/history?range=24h\|7d\|30d` | Time-series data |

### Pump Control

| Method | Path                     | Description              |
| ------ | ------------------------ | ------------------------ |
| GET    | `/api/pump/schedule`     | List all schedules       |
| POST   | `/api/pump/schedule`     | Create/update schedule   |
| DELETE | `/api/pump/schedule/:id` | Delete a schedule        |
| POST   | `/api/pump/manual`       | Manual pump on/off       |
| GET    | `/api/pump/status`       | ESP32 polls for commands |

### AI

| Method | Path              | Description         |
| ------ | ----------------- | ------------------- |
| POST   | `/api/ai/insight` | Generate AI insight |

Insights are cached for 5 minutes. Send `{ "force": true }` to bypass the cache
(this is what the dashboard's **Refresh Insight** button does).

### Weather

| Method | Path                          | Description                      |
| ------ | ----------------------------- | -------------------------------- |
| GET    | `/api/weather?lat=&lon=`      | Current conditions for the plant |

Returns `{ temperature, humidity, condition, description, icon, ... }`, cached
for 15 minutes to stay inside the free tier's rate limit. `lat`/`lon` are
optional and fall back to the configured default location.

### Health

| Method | Path          | Description                |
| ------ | ------------- | -------------------------- |
| GET    | `/api/health` | Status, uptime, server time |

## ESP32 POST Format

Your ESP32 should send HTTP POST requests to `http://<server-ip>:3001/api/readings` with this JSON body:

```json
{
  "temperature": 28.5,
  "solar_voltage": 15.2,
  "solar_current": 1.1,
  "battery_voltage": 12.8,
  "battery_current": 0.45,
  "battery_percentage": 72,
  "pump_status": "off",
  "pump_last_run": "2024-01-15T06:00:00.000Z",
  "pump_next_scheduled_run": "2024-01-15T18:00:00.000Z",
  "location_name": "My Garden"
}
```

**Notes:**
- `solar_power` and `battery_power` are auto-calculated (V × I)
- `timestamp` defaults to server time if omitted
- All fields are optional; send what your sensors provide

### ESP32 Command Polling

For receiving pump commands from the dashboard, poll `GET /api/pump/status` every few seconds:

```json
// Response when a command is pending:
{ "pending": true, "command": "on", "id": 1 }

// Response when no command:
{ "pending": false }
```

## ESP32 Arduino Example

```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* serverUrl = "http://192.168.1.100:3001";

void postReading() {
  HTTPClient http;
  http.begin(String(serverUrl) + "/api/readings");
  http.addHeader("Content-Type", "application/json");

  JsonDocument doc;
  doc["temperature"] = readTemperature();
  doc["solar_voltage"] = readSolarVoltage();
  doc["solar_current"] = readSolarCurrent();
  doc["battery_voltage"] = readBatteryVoltage();
  doc["battery_current"] = readBatteryCurrent();
  doc["battery_percentage"] = readBatteryPercentage();
  doc["pump_status"] = digitalRead(PUMP_PIN) ? "on" : "off";

  String payload;
  serializeJson(doc, payload);
  http.POST(payload);
  http.end();
}

void checkPumpCommand() {
  HTTPClient http;
  http.begin(String(serverUrl) + "/api/pump/status");
  int code = http.GET();

  if (code == 200) {
    JsonDocument doc;
    deserializeJson(doc, http.getString());
    if (doc["pending"] == true) {
      String cmd = doc["command"].as<String>();
      digitalWrite(PUMP_PIN, cmd == "on" ? HIGH : LOW);
    }
  }
  http.end();
}
```

## Dashboard Features

- **Live updates** — Socket.IO pushes new readings to the dashboard instantly
- **Solar Panel card** — current output, voltage, current, and a sparkline of the recent trend
- **Battery card** — charge level, charge/discharge state, recent-trend sparkline
- **Pump card** — manual control, schedule editor with day picker
- **History charts** — solar power, battery level, temperature over 24h/7d/30d
- **AI insights** — Groq-powered plain-English status, weather-aware
- **Live/offline badge** — derived from the latest reading's timestamp, not a
  hardcoded state: it flips to *Offline* once the ESP32 has been quiet for 2 minutes
- **Mobile responsive** — single column below 768px, for field checks on a phone

## Design System

The visual identity is tokenized in **`frontend/src/styles/theme.css`**. Components
reference tokens only — there are no hex values anywhere in `src/components`.

```
frontend/src/
├── styles/theme.css      ← all color, type, radius and glow tokens
├── index.css             ← base layer, card/label classes, keyframes
├── components/ui/        ← Card, CardHeader, StatusBadge, ProgressBar,
│                           EmptyState, Sparkline, MetricRow
└── lib/trend.js          ← windows readings for the card sparklines
```

### Status colors are functional, not decorative

The one rule to preserve when editing: **status meaning maps to color, and a
normal operating state never borrows the brand red.**

| Token               | Meaning                          | Used by                          |
| ------------------- | -------------------------------- | -------------------------------- |
| `--status-good`     | Operating normally, nothing to do | Generating, Charging, AI seedling |
| `--status-idle`     | Off, nothing to see              | Idle, Discharging, Offline        |
| `--status-live`     | Happening now / needs you        | Live dot, Water Now, real alerts  |
| `--status-warning`  | Needs attention soon             | Reserved (low battery, missed run) |

Per-metric accents are separate from status: `--solar`, `--battery` and `--temp`
each own one metric across both its sparkline and its history chart, so the
Battery card's mini trend and the Battery Level chart always match.

> **Tailwind v4 note:** the CSS reset in `index.css` lives inside `@layer base`
> on purpose. Tailwind emits utilities in `@layer utilities`, and an *unlayered*
> rule outranks any layered one — an unlayered `* { padding: 0 }` silently kills
> every `p-*`, `m-*` and `space-y-*` utility in the app.

## License

MIT
