const API_BASE = '/api';

/**
 * The admin PIN lives only in this browser's localStorage and is sent as a
 * header on commands. It is never bundled, never in source, and read-only
 * endpoints don't need it — so a visitor can watch the dashboard but cannot
 * run the pump.
 */
const PIN_KEY = 'solar.adminPin';

export function getAdminPin() {
  try {
    return localStorage.getItem(PIN_KEY) || '';
  } catch {
    return ''; // private mode / blocked storage
  }
}

export function setAdminPin(pin) {
  try {
    if (pin) localStorage.setItem(PIN_KEY, pin);
    else localStorage.removeItem(PIN_KEY);
  } catch {
    /* non-fatal: the command just fails auth and re-prompts */
  }
}

/** Thrown when the PIN is missing or rejected, so the UI can re-prompt. */
export class UnauthorizedError extends Error {
  constructor(message = 'Invalid PIN') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

async function request(url, options = {}) {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new UnauthorizedError(data.error);
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Readings
export const fetchLatestReading = () => request('/readings/latest');
export const fetchHistory = (range = '24h') => request(`/readings/history?range=${range}`);

// Pump
export const fetchSchedules = () => request('/pump/schedule');
export const saveSchedule = (schedule) =>
  request('/pump/schedule', { method: 'POST', body: JSON.stringify(schedule) });
export const deleteSchedule = (id) =>
  request(`/pump/schedule/${id}`, { method: 'DELETE' });
// Every device command queues through this one endpoint and reaches the ESP
// on its next /api/pump/status poll (5s). The backend validates the action
// string, so set_battery is range-checked server-side before it can ever
// reach the firmware.
export const triggerPump = (action) =>
  request('/pump/manual', {
    method: 'POST',
    headers: { 'x-admin-pin': getAdminPin() },
    body: JSON.stringify({ action }),
  });

export const setAutoMode = (enabled) => triggerPump(enabled ? 'auto_on' : 'auto_off');

/** Calibrate the battery estimate against the charge controller's reading. */
export const calibrateBattery = (pct) =>
  triggerPump(`set_battery:${Math.max(0, Math.min(100, Math.round(pct)))}`);

// Weather
export const fetchWeather = (lat, lon) => {
  const q = lat != null && lon != null ? `?lat=${lat}&lon=${lon}` : '';
  return request(`/weather${q}`);
};

// AI
export const fetchAiInsight = (force = false) =>
  request('/ai/insight', { method: 'POST', body: JSON.stringify({ force }) });
