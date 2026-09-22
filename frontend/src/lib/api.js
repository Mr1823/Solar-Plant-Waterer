const API_BASE = '/api';

async function request(url, options = {}) {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await res.json();
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
export const triggerPump = (action) =>
  request('/pump/manual', { method: 'POST', body: JSON.stringify({ action }) });

// AI
export const fetchAiInsight = (force = false) =>
  request('/ai/insight', { method: 'POST', body: JSON.stringify({ force }) });
