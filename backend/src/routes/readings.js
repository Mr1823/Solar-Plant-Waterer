import { Router } from 'express';
import { runAndSave, queryAll, queryOne } from '../db.js';
import { validateReading } from '../middleware/validate.js';
import { requireDeviceKey } from '../middleware/auth.js';

export default function readingsRoutes(io) {
  const router = Router();

  // POST /api/readings — ESP32 pushes a new reading
  router.post('/', requireDeviceKey, validateReading, (req, res) => {
    try {
      const {
        timestamp,
        pump_status = 'off',
        pump_last_run,
        pump_next_scheduled_run,
        location_name = 'My Garden',
      } = req.body;

      // Absent means "this board has no such sensor", which is not the same
      // as zero. Defaulting these to 0 (as this handler used to) makes a
      // soil-moisture board report a confident "0 V" solar panel, which the
      // dashboard would then draw as a real measurement.
      const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      const int = (v) => (Number.isInteger(v) ? v : num(v) === null ? null : Math.round(v));
      // express-validator's isBoolean() accepts true/false, "true"/"false"
      // and 0/1, so normalise all of them down to SQLite's 0/1.
      const bool01 = (v) =>
        v === undefined || v === null ? null : v === true || v === 'true' || v === 1 || v === '1' ? 1 : 0;
      const round2 = (v) => (v === null ? null : Math.round(v * 100) / 100);

      const solar_voltage = num(req.body.solar_voltage);
      const solar_current = num(req.body.solar_current);
      const battery_voltage = num(req.body.battery_voltage);
      const battery_current = num(req.body.battery_current);
      const battery_percentage = num(req.body.battery_percentage);
      const temperature = num(req.body.temperature);
      const location_lat = num(req.body.location_lat);
      const location_lon = num(req.body.location_lon);

      // A board with current sensors gets power derived from V x I. A board
      // that models it (irradiance estimate) sends solar_power directly.
      // Deriving from absent sensors would turn "not measured" into 0 W.
      const solar_power =
        num(req.body.solar_power) ??
        (solar_voltage !== null && solar_current !== null ? round2(solar_voltage * solar_current) : null);
      const battery_power =
        num(req.body.battery_power) ??
        (battery_voltage !== null && battery_current !== null
          ? round2(battery_voltage * Math.abs(battery_current))
          : null);

      const soil_moisture = num(req.body.soil_moisture);
      const pump_energy_today_wh = num(req.body.pump_energy_today_wh);
      const pump_energy_total_wh = num(req.body.pump_energy_total_wh);
      const pump_last_run_sec = int(req.body.pump_last_run_sec);
      const pump_last_run_wh = num(req.body.pump_last_run_wh);
      const waterings_today = int(req.body.waterings_today);
      const solar_energy_today_wh = num(req.body.solar_energy_today_wh);
      const solar_energy_total_wh = num(req.body.solar_energy_total_wh);
      const irradiance = num(req.body.irradiance);
      const auto_mode = bool01(req.body.auto_mode);
      const is_estimated = bool01(req.body.is_estimated);

      const ts = timestamp || new Date().toISOString();

      const { lastInsertRowid } = runAndSave(`
        INSERT INTO readings (
          timestamp, temperature,
          solar_voltage, solar_current, solar_power,
          battery_voltage, battery_current, battery_power, battery_percentage,
          pump_status, pump_last_run, pump_next_scheduled_run,
          location_name, location_lat, location_lon,
          soil_moisture, pump_energy_today_wh, pump_energy_total_wh,
          pump_last_run_sec, pump_last_run_wh, waterings_today,
          solar_energy_today_wh, solar_energy_total_wh, irradiance, auto_mode, is_estimated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        ts, temperature,
        solar_voltage, solar_current, solar_power,
        battery_voltage, battery_current, battery_power, battery_percentage,
        pump_status, pump_last_run || null, pump_next_scheduled_run || null,
        location_name, location_lat, location_lon,
        soil_moisture, pump_energy_today_wh, pump_energy_total_wh,
        pump_last_run_sec, pump_last_run_wh, waterings_today,
        solar_energy_today_wh, solar_energy_total_wh, irradiance, auto_mode, is_estimated,
      ]);

      const reading = {
        id: lastInsertRowid,
        timestamp: ts,
        temperature,
        solar_voltage, solar_current, solar_power,
        battery_voltage, battery_current, battery_power, battery_percentage,
        pump_status, pump_last_run, pump_next_scheduled_run,
        location_name, location_lat, location_lon,
        soil_moisture, pump_energy_today_wh, pump_energy_total_wh,
        pump_last_run_sec, pump_last_run_wh, waterings_today,
        solar_energy_today_wh, solar_energy_total_wh, irradiance, auto_mode, is_estimated,
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
  //
  // Downsampled server-side. At the ESP32's 1-minute posting rate a raw 24h
  // window is ~1,440 rows and 30d is ~43,200 — far more points than a chart
  // a few hundred pixels wide can express, and all of it serialised, shipped
  // and turned into SVG path commands in the browser. Averaging into buckets
  // gives the same curve for a fraction of the payload.
  const RANGES = {
    '24h': { sqlRange: '-24 hours', bucketSeconds: 300 },   // 5-minute buckets
    '7d': { sqlRange: '-7 days', bucketSeconds: 3600 },     // hourly
    '30d': { sqlRange: '-30 days', bucketSeconds: 3600 },   // hourly
  };

  // Short-lived response cache. The ESP32 only posts once a minute, so
  // re-running the aggregate for every dashboard that asks within the same
  // few seconds is wasted work — and every open dashboard polls this.
  const HISTORY_CACHE_MS = 30 * 1000;
  const historyCache = new Map();

  router.get('/history', (req, res) => {
    try {
      const range = req.query.range || '24h';
      const config = RANGES[range];
      if (!config) {
        return res.status(400).json({ error: 'Invalid range. Use 24h, 7d, or 30d.' });
      }

      const cached = historyCache.get(range);
      if (cached && Date.now() - cached.at < HISTORY_CACHE_MS) {
        return res.json({ ...cached.body, cached: true });
      }

      // Two things to note in this query:
      //
      // Filtering compares as julianday, not as text. Stored timestamps are
      // ISO-8601 ("2026-09-23T05:13:03.687Z") while datetime('now', ?)
      // returns "2026-09-22 05:31:51" — and since 'T' > ' ', a plain string
      // compare let every row from the prior calendar day through (a 24h
      // request returned ~29h). julianday() also copes with the column's own
      // DEFAULT (datetime('now')) format, so mixed rows still filter right.
      //
      // Only the columns the charts actually draw are selected, rather than
      // SELECT * dragging all 16 across the wire. pump_on is carried as a
      // per-bucket flag so the UI can shade watering periods without a
      // second query.
      const rows = queryAll(
        `SELECT
           MIN(timestamp)                                     AS timestamp,
           AVG(solar_power)                                    AS solar_power,
           AVG(battery_percentage)                             AS battery_percentage,
           AVG(temperature)                                    AS temperature,
           MAX(CASE WHEN pump_status = 'on' THEN 1 ELSE 0 END) AS pump_on,
           COUNT(*)                                            AS samples
         FROM readings
         WHERE julianday(timestamp) >= julianday('now', ?)
         GROUP BY CAST(strftime('%s', timestamp) / ? AS INTEGER)
         ORDER BY timestamp ASC`,
        [config.sqlRange, config.bucketSeconds]
      );

      // Averaging leaves long decimal tails that inflate the JSON for
      // precision no one can see on a chart.
      const readings = rows.map((r) => ({
        timestamp: r.timestamp,
        solar_power: r.solar_power == null ? null : Math.round(r.solar_power * 100) / 100,
        battery_percentage: r.battery_percentage == null ? null : Math.round(r.battery_percentage * 10) / 10,
        temperature: r.temperature == null ? null : Math.round(r.temperature * 10) / 10,
        pump_on: r.pump_on === 1,
        samples: r.samples,
      }));

      const body = { range, count: readings.length, bucketSeconds: config.bucketSeconds, readings };
      historyCache.set(range, { at: Date.now(), body });

      res.json({ ...body, cached: false });
    } catch (err) {
      console.error('Error fetching history:', err);
      res.status(500).json({ error: 'Failed to fetch history' });
    }
  });

  return router;
}
