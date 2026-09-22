import { Router } from 'express';

const router = Router();

let cache = { data: null, timestamp: 0 };
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

// GET /api/weather?lat=...&lon=... (or uses default from latest reading)
router.get('/', async (req, res) => {
  try {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error: 'OPENWEATHER_API_KEY not configured',
        weather: null,
      });
    }

    const now = Date.now();

    // Return cached data if fresh
    if (cache.data && (now - cache.timestamp) < CACHE_DURATION) {
      return res.json({ ...cache.data, cached: true });
    }

    // Use query params or fall back to default (Tenkasi coordinates)
    const lat = req.query.lat || '8.96';
    const lon = req.query.lon || '77.31';

    const url = new URL('https://api.openweathermap.org/data/2.5/weather');
    url.searchParams.set('lat', lat);
    url.searchParams.set('lon', lon);
    url.searchParams.set('appid', apiKey);
    url.searchParams.set('units', 'metric');

    const response = await fetch(url.toString());

    if (!response.ok) {
      const errBody = await response.text();
      console.error('OpenWeatherMap API error:', response.status, errBody);
      return res.status(502).json({ error: 'Weather API returned an error' });
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
    res.json({ ...weather, cached: false });
  } catch (err) {
    console.error('Weather fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch weather data' });
  }
});

// Exported for use by the AI insight route
export function getCachedWeather() {
  if (cache.data && (Date.now() - cache.timestamp) < CACHE_DURATION) {
    return cache.data;
  }
  return null;
}

export default router;
