# 🌱 Solar Plant Waterer — IoT Dashboard

A full-stack IoT dashboard for monitoring and controlling a solar-powered, time-based plant watering system.

## Architecture

```
ESP32 ──HTTP POST──▶ Express Backend ──Socket.IO──▶ React Dashboard
                          │                              │
                       SQLite DB                    Recharts / UI
                          │
                     Groq API (AI insights)
```

## Tech Stack

| Layer    | Tech                                    |
| -------- | --------------------------------------- |
| Frontend | React (Vite), Tailwind CSS v4, Recharts |
| Backend  | Node.js, Express, Socket.IO             |
| Database | SQLite (via sql.js — zero config)        |
| AI       | Groq API (llama-3.3-70b-versatile)      |
| Hardware | ESP32, relay, 12V battery, solar panel   |

## Quick Start

### 1. Backend

```bash
cd backend
cp .env.example .env
# Edit .env — add your GROQ_API_KEY

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

| Variable       | Required | Default            | Description              |
| -------------- | -------- | ------------------ | ------------------------ |
| `PORT`         | No       | `3001`             | Server port              |
| `GROQ_API_KEY` | Yes*     | —                  | Groq API key for AI insights |
| `DB_PATH`      | No       | `./data/solar.db`  | SQLite file path         |

*AI insights will show a friendly error if not set; everything else works without it.

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

| Method | Path              | Description              |
| ------ | ----------------- | ------------------------ |
| POST   | `/api/ai/insight`  | Generate AI insight      |

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
- **Solar Panel card** — voltage, current, power with generating indicator
- **Battery card** — percentage bar, charge/discharge status, color-coded health
- **Pump card** — manual control, schedule editor with day picker
- **History charts** — solar power, battery level, temperature over 24h/7d/30d
- **AI insights** — Groq-powered plain-English system status analysis
- **Mobile responsive** — works great on phones for field checks
- **Dark glassmorphism theme** — premium look with subtle animations

## License

MIT
