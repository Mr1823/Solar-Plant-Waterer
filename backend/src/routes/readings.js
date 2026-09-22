import { Router } from 'express';
import { runAndSave, queryAll, queryOne } from '../db.js';
import { validateReading } from '../middleware/validate.js';

export default function readingsRoutes(io) {
  const router = Router();

  // POST /api/readings — ESP32 pushes a new reading
  router.post('/', validateReading, (req, res) => {
    try {
      const {
        timestamp,
        temperature,
        solar_voltage = 0,
        solar_current = 0,
        battery_voltage = 0,
        battery_current = 0,
        battery_percentage = 0,
        pump_status = 'off',
        pump_last_run,
        pump_next_scheduled_run,
        location_name = 'My Garden',
        location_lat,
        location_lon,
      } = req.body;

      const solar_power = parseFloat((solar_voltage * solar_current).toFixed(2));
      const battery_power = parseFloat((battery_voltage * Math.abs(battery_current)).toFixed(2));
      const ts = timestamp || new Date().toISOString();

      const { lastInsertRowid } = runAndSave(`
        INSERT INTO readings (
          timestamp, temperature,
          solar_voltage, solar_current, solar_power,
          battery_voltage, battery_current, battery_power, battery_percentage,
          pump_status, pump_last_run, pump_next_scheduled_run,
          location_name, location_lat, location_lon
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        ts, temperature,
        solar_voltage, solar_current, solar_power,
        battery_voltage, battery_current, battery_power, battery_percentage,
        pump_status, pump_last_run || null, pump_next_scheduled_run || null,
        location_name, location_lat || null, location_lon || null,
      ]);

      const reading = {
        id: lastInsertRowid,
        timestamp: ts,
        temperature,
        solar_voltage, solar_current, solar_power,
        battery_voltage, battery_current, battery_power, battery_percentage,
        pump_status, pump_last_run, pump_next_scheduled_run,
        location_name, location_lat, location_lon,
      };

      // Broadcast to all connected dashboard clients
      io.emit('new-reading', reading);

      res.status(201).json({ success: true, reading });
    } catch (err) {
      console.error('Error saving reading:', err);
      res.status(500).json({ error: 'Failed to save reading' });
    }
  });

  // GET /api/readings/latest — most recent reading
  router.get('/latest', (req, res) => {
    try {
      const row = queryOne('SELECT * FROM readings ORDER BY id DESC LIMIT 1');
      if (!row) {
        return res.json({ reading: null, message: 'No readings yet' });
      }
      res.json({ reading: row });
    } catch (err) {
      console.error('Error fetching latest reading:', err);
      res.status(500).json({ error: 'Failed to fetch reading' });
    }
  });

  // GET /api/readings/history?range=24h|7d|30d
  router.get('/history', (req, res) => {
    try {
      const range = req.query.range || '24h';

      const rangeMap = {
        '24h': '-24 hours',
        '7d': '-7 days',
        '30d': '-30 days',
      };

      const sqlRange = rangeMap[range];
      if (!sqlRange) {
        return res.status(400).json({ error: 'Invalid range. Use 24h, 7d, or 30d.' });
      }

      const rows = queryAll(
        "SELECT * FROM readings WHERE timestamp >= datetime('now', ?) ORDER BY timestamp ASC",
        [sqlRange]
      );

      res.json({ range, count: rows.length, readings: rows });
    } catch (err) {
      console.error('Error fetching history:', err);
      res.status(500).json({ error: 'Failed to fetch history' });
    }
  });

  return router;
}
