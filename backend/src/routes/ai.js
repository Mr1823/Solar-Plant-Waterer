import { Router } from 'express';
import { queryOne, queryAll, runAndSave } from '../db.js';
import { getInsight } from '../services/groq.js';
import { getWeather } from './weather.js';

const router = Router();

// POST /api/ai/insight — generate AI insight from recent readings
router.post('/insight', async (req, res) => {
  try {
    const latest = queryOne('SELECT * FROM readings ORDER BY id DESC LIMIT 1');
    if (!latest) {
      return res.json({
        insight: 'No sensor data available yet. Waiting for the first reading from your ESP32.',
        cached: false,
      });
    }

    // Get recent readings for trend (last 10)
    const recent = queryAll('SELECT * FROM readings ORDER BY id DESC LIMIT 10');

    // Check for cached insight (less than 5 minutes old)
    // created_at is stored in SQLite's own "YYYY-MM-DD HH:MM:SS" UTC form.
    // Handing that to the browser makes `new Date()` read it as LOCAL time,
    // so a fresh insight displayed as "5h ago" under IST. Emit ISO 8601 with
    // an explicit Z instead. (The window comparison below stays in SQLite
    // format on both sides, which is consistent.)
    const cached = queryOne(
      `SELECT insight, strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at
         FROM ai_insights
        WHERE created_at >= datetime('now', '-5 minutes')
        ORDER BY id DESC LIMIT 1`
    );

    if (cached && !req.body.force) {
      return res.json({ insight: cached.insight, cached: true, generated_at: cached.created_at });
    }

    // Generate new insight. Weather is fetched (not just read from cache) at
    // the plant's own coordinates, so the prompt's weather section is real
    // rather than empty whenever nobody happened to open /api/weather lately.
    const weather = await getWeather(latest.location_lat, latest.location_lon);
    const insight = await getInsight(latest, recent, weather);

    // Cache it
    runAndSave('INSERT INTO ai_insights (insight) VALUES (?)', [insight]);

    res.json({ insight, cached: false, generated_at: new Date().toISOString() });
  } catch (err) {
    // Full detail (including any config problem) stays in the server log;
    // the client only ever sees a generic message.
    console.error('Error generating AI insight:', err);

    if (err.message?.includes('GROQ_API_KEY')) {
      return res.status(503).json({
        error: 'AI insights are not available',
        insight: 'AI insights are unavailable right now. Please try again later.',
      });
    }

    res.status(500).json({
      error: 'Failed to generate insight',
      insight: 'Unable to generate AI insight at this time. Please try again later.',
    });
  }
});

export default router;
