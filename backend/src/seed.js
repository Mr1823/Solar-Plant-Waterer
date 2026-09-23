/**
 * Seed script — populates the database with realistic demo data
 * so you can see the dashboard working before the ESP32 is connected.
 *
 * Usage: node src/seed.js
 */

import 'dotenv/config';
import { initDB, getDB, saveDB } from './db.js';

const dbPath = process.env.DB_PATH || './data/solar.db';

async function seed() {
  await initDB(dbPath);
  const db = getDB();

  // Clear existing data
  db.run('DELETE FROM readings');
  db.run('DELETE FROM schedules');
  db.run('DELETE FROM pump_commands');
  db.run('DELETE FROM ai_insights');

  console.log('🌱 Seeding demo data...\n');

  // Generate 48 hours of readings (one every 30 minutes)
  const now = new Date();

  const insertStmt = db.prepare(`
    INSERT INTO readings (
      timestamp, temperature,
      solar_voltage, solar_current, solar_power,
      battery_voltage, battery_current, battery_power, battery_percentage,
      pump_status, pump_last_run, pump_next_scheduled_run,
      location_name, location_lat, location_lon
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  for (let i = 96; i >= 0; i--) {
    const ts = new Date(now.getTime() - i * 30 * 60 * 1000);
    const hour = ts.getHours();

    // Simulate solar output (peaks at noon, zero at night)
    const solarFactor = hour >= 6 && hour <= 18
      ? Math.sin(((hour - 6) / 12) * Math.PI)
      : 0;

    const solar_voltage = parseFloat(Math.max(0, solarFactor * 18 + (Math.random() * 2 - 1)).toFixed(1));
    const solar_current = parseFloat(Math.max(0, solarFactor * 1.5 + (Math.random() * 0.2)).toFixed(2));
    const solar_power = parseFloat((solar_voltage * solar_current).toFixed(2));

    // Battery: charges during day, discharges at night
    const baseBattery = 60 + solarFactor * 30 - (1 - solarFactor) * 10;
    const battery_percentage = parseFloat(Math.min(100, Math.max(10, baseBattery + (Math.random() * 10 - 5))).toFixed(1));
    const battery_voltage = parseFloat((11.5 + (battery_percentage / 100) * 2.5).toFixed(1));
    const battery_current = parseFloat((solarFactor > 0.2 ? 0.3 + Math.random() * 0.5 : -(0.1 + Math.random() * 0.2)).toFixed(2));
    const battery_power = parseFloat((battery_voltage * Math.abs(battery_current)).toFixed(2));

    // Temperature: warmer during day
    const temperature = parseFloat((22 + solarFactor * 12 + (Math.random() * 3 - 1.5)).toFixed(1));

    // Pump runs at 6 AM and 6 PM
    const isPumpTime = (hour === 6 || hour === 18) && ts.getMinutes() === 0;
    const dateStr = ts.toISOString().split('T')[0];

    insertStmt.bind([
      ts.toISOString(),
      temperature,
      solar_voltage, solar_current, solar_power,
      battery_voltage, battery_current, battery_power, battery_percentage,
      isPumpTime ? 'on' : 'off',
      hour >= 18 ? `${dateStr}T18:00:00.000Z` : hour >= 6 ? `${dateStr}T06:00:00.000Z` : null,
      hour < 6 ? `${dateStr}T06:00:00.000Z` : hour < 18 ? `${dateStr}T18:00:00.000Z` : null,
      'My Garden',
      9.59,
      77.95,
    ]);
    insertStmt.step();
    insertStmt.reset();
    count++;
  }
  insertStmt.free();

  console.log(`✅ Inserted ${count} readings`);

  // Add default schedules
  db.run("INSERT INTO schedules (time, days, duration_seconds, enabled) VALUES (?, ?, ?, ?)", ['06:00', '[0,1,2,3,4,5,6]', 30, 1]);
  db.run("INSERT INTO schedules (time, days, duration_seconds, enabled) VALUES (?, ?, ?, ?)", ['18:00', '[0,1,2,3,4,5,6]', 30, 1]);
  console.log('✅ Inserted 2 default schedules (6 AM & 6 PM daily)');

  // Add a sample AI insight
  db.run("INSERT INTO ai_insights (insight) VALUES (?)", [
    'System looks healthy. Battery is at 75% and charging steadily with good solar input. Next watering cycle is on track for 6 PM today.',
  ]);
  console.log('✅ Inserted sample AI insight');

  saveDB();
  console.log('\n🎉 Seed complete! Start the server with: npm run dev\n');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
