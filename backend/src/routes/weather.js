import { Router } from 'express';

const router = Router();

let cache = { data: null, timestamp: 0, key: null };
// Every dashboard shares this cache, so upstream cost is fixed no matter how
// many are open. The dashboard polls every 30 minutes; caching for 15 keeps
// what it gets reasonably fresh while staying far inside the free tier's
// 60-calls-per-minute limit.
const CACHE_DURATION = (Number(process.env.WEATHER_CACHE_SECONDS) || 900) * 1000;

// Used when a reading carries no coordinates of its own.
const DEFAULT_LAT = parseFloat(process.env.DEFAULT_LAT || '9.67358');
const DEFAULT_LON = parseFloat(process.env.DEFAULT_LON || '77.96465');



/**
 * Cached-or-fetch. Both the route and the AI insight route go through here,
 * so the AI sees live conditions instead of whatever a dashboard visit
 * happened to leave in the cache. Returns null when unavailable — weather is
 * context for the prompt, never a reason to fail the insight.
 */
export async function getWeather(lat, lon) {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) return null;

  const useLat = lat ?? DEFAULT_LAT;
  const useLon = lon ?? DEFAULT_LON;

  // Key the cache on the coordinates, or moving the plant would keep serving
  // the previous location's weather for up to 15 minutes.
  const key = `${useLat},${useLon}`;
  const now = Date.now();
  if (cache.data && cache.key === key && (now - cache.timestamp) < CACHE_DURATION) {
    return { ...cache.data, cached: true };
  }

  const url = new URL('https://api.openweathermap.org/data/2.5/weather');
  url.searchParams.set('lat', useLat);
  url.searchParams.set('lon', useLon);
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

  cache = { data: weather, timestamp: now, key };
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
