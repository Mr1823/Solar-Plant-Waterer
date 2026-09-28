/*
  Copy this file to `secrets.h` and fill in your own values.

  `secrets.h` is gitignored — it holds your WiFi password and the device key
  that authorises this board to post readings. `secrets.example.h` (this
  file) is committed with placeholders only, so a fresh clone knows what to
  create without ever carrying a real credential.
*/
#pragma once

// ── WiFi ─────────────────────────────────────────────────────────────────
#define WIFI_SSID_VALUE      "your-wifi-name"
#define WIFI_PASSWORD_VALUE  "your-wifi-password"

// ── Backend ──────────────────────────────────────────────────────────────
// Your PC's LAN IP (run `ipconfig` on Windows, `ifconfig` on macOS/Linux).
// NOT "localhost" — on the ESP that would mean the ESP itself.
#define READINGS_URL_VALUE     "http://192.168.1.100:3001/api/readings"
#define PUMP_STATUS_URL_VALUE  "http://192.168.1.100:3001/api/pump/status"

// Must match ESP_DEVICE_KEY in backend/.env. The backend returns 401 on
// POST /api/readings without it.
#define DEVICE_KEY_VALUE       "paste_the_ESP_DEVICE_KEY_from_backend_env"
