import { useCallback, useEffect, useState } from 'react';
import { fetchWeather } from '../lib/api';

// The server caches for 15 minutes and shares that across every open
// dashboard, so a 30-minute poll is never more than ~15 minutes stale while
// costing the free tier almost nothing.
const REFRESH_MS = 30 * 60 * 1000;

/**
 * Current conditions at the plant, following the coordinates the ESP32
 * reports so the weather tracks the hardware rather than a fixed config
 * value. Weather is supporting context, so every
 * failure path resolves to `null` and the UI simply omits it — a missing API
 * key or a flaky upstream must never take the dashboard down with it.
 */
export function useWeather(lat, lon, { enabled = true } = {}) {
  const [weather, setWeather] = useState(null);

  const load = useCallback(async () => {
    try {
      setWeather(await fetchWeather(lat, lon));
    } catch (err) {
      console.error('Weather request failed:', err);
      setWeather(null);
    }
  }, [lat, lon]);

  // Gated on the caller knowing where the plant is. Without this the first
  // render fires a request with no coordinates, so the header shows the
  // server's default location for a beat before correcting itself — a visible
  // flash of the wrong city, and a wasted upstream call on every page load.
  useEffect(() => {
    if (!enabled) return undefined;
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load, enabled]);

  return { weather, refresh: load };
}
