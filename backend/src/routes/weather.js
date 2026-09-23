import { Router } from 'express';

const router = Router();

let cache = { data: null, timestamp: 0 };
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

// Used when a reading carries no coordinates of its own.
const DEFAULT_LAT = process.env.DEFAULT_LAT || '8.96';
const DEFAULT_LON = process.env.DEFAULT_LON || '77.31';

/**
 * Cached-or-fetch. Both the route and the AI insight route go through here,
 * so the AI sees live conditions instead of whatever a dashboard visit
 * happened to leave in the cache. Returns null when unavailable — weather is
 * context for the prompt, never a reason to fail the insight.
 */
export async function getWeather(lat, lon) {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) return null;

  const now = Date.now();
  if (cache.data && (now - cache.timestamp) < CACHE_DURATION) {
    return { ...cache.data, cached: true };
  }

  const url = new URL('https://api.openweathermap.org/data/2.5/weather');
  url.searchParams.set('lat', lat ?? DEFAULT_LAT);
  url.searchParams.set('lon', lon ?? DEFAULT_LON);
  url.searchParams.set('appid', apiKey);
  url.searchParams.set('units', 'metric');

  const response = await fetch(url.toString());

  if (!response.ok) {
    const errBody = await response.text();
    console.error('OpenWeatherMap API error:', response.status, errBody);
    return null;
  }

  const data = await response.json();
  const weather = {
    temperature: data.main.temp,
    feels_like: data.main.feels_like,
    humidity: data.main.humidity,
    condition: data.weather[0].main,
    description: data.weather[0].description,
    icon: data.weather[0].icon,
    wind_speed: data.wind?.speed,
    clouds: data.clouds?.all,
    city: data.name,
  };

  cache = { data: weather, timestamp: now };
  return { ...weather, cached: false };
}

// GET /api/weather?lat=...&lon=...
router.get('/', async (req, res) => {
  try {
    if (!process.env.OPENWEATHER_API_KEY) {
      return res.status(503).json({
        error: 'Weather is not available',
        weather: null,
      });
    }

    const weather = await getWeather(req.query.lat, req.query.lon);
    if (!weather) return res.status(502).json({ error: 'Weather API returned an error' });

    res.json(weather);
  } catch (err) {
    console.error('Weather fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch weather data' });
  }
});

export default router;
