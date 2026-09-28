import initSqlJs from 'sql.js';
import path from 'path';
import fs from 'fs';

let db;
let dbFilePath;

export async function initDB(dbPath) {
  dbFilePath = path.resolve(dbPath);
  const dir = path.dirname(dbFilePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const SQL = await initSqlJs();

  // Load existing database file if it exists, otherwise create new
  if (fs.existsSync(dbFilePath)) {
    const fileBuffer = fs.readFileSync(dbFilePath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      temperature REAL,
      solar_voltage REAL,
      solar_current REAL,
      solar_power REAL,
      battery_voltage REAL,
      battery_current REAL,
      battery_power REAL,
      battery_percentage REAL,
      pump_status TEXT DEFAULT 'off',
      pump_last_run TEXT,
      pump_next_scheduled_run TEXT,
      location_name TEXT DEFAULT 'My Garden',
      location_lat REAL,
      location_lon REAL
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_readings_timestamp ON readings(timestamp)');

  // Additive schema migration for the soil-moisture hardware.
  //
  // These are ADD COLUMN only — nothing is dropped or retyped, so the
  // existing rows survive untouched and simply carry NULL for the new
  // fields. That NULL is meaningful, not missing data: a board without
  // current sensors genuinely has no solar_voltage to report, and the UI
  // must render "—" rather than a misleading "0 V". Conversely these new
  // columns are NULL on every reading the measured-sensor ESP32 build
  // posts, for the same reason.
  //
  // is_estimated marks which convention a row follows: 1 = solar_power and
  // battery_percentage are modelled (irradiance + energy balance), 0/NULL =
  // directly measured. That flag is what drives the "Estimated" badges.
  const NEW_READING_COLUMNS = [
    ['soil_moisture', 'REAL'],            // 0-100 %
    ['pump_energy_today_wh', 'REAL'],
    ['pump_energy_total_wh', 'REAL'],
    ['pump_last_run_sec', 'INTEGER'],
    ['pump_last_run_wh', 'REAL'],
    ['waterings_today', 'INTEGER'],
    ['solar_energy_today_wh', 'REAL'],
    // Lifetime solar total. Unlike batteryWh / capacity / pumpHoursLeft —
    // which the dashboard derives from battery_percentage and constants —
    // this one cannot be reconstructed from anything else we store, so it
    // has to be a column.
    ['solar_energy_total_wh', 'REAL'],
    ['irradiance', 'REAL'],               // W/m² from Open-Meteo
    ['auto_mode', 'INTEGER'],             // 0/1
    ['is_estimated', 'INTEGER'],          // 0/1
  ];

  const existing = new Set();
  const info = db.exec('PRAGMA table_info(readings)');
  if (info.length) {
    const nameIdx = info[0].columns.indexOf('name');
    for (const row of info[0].values) existing.add(row[nameIdx]);
  }

  let added = 0;
  for (const [name, type] of NEW_READING_COLUMNS) {
    if (existing.has(name)) continue;
    db.run(`ALTER TABLE readings ADD COLUMN ${name} ${type}`);
    added++;
  }
  if (added) console.log(`🧩 readings: added ${added} column(s) for soil-moisture hardware`);

  db.run(`
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time TEXT NOT NULL,
      days TEXT NOT NULL DEFAULT '[]',
      duration_seconds INTEGER DEFAULT 30,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pump_commands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      command TEXT NOT NULL,
      acknowledged INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ai_insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      insight TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  saveDB();
  console.log('✅ Database initialized at', dbFilePath);
  return db;
}

export function getDB() {
  if (!db) throw new Error('Database not initialized. Call initDB() first.');
  return db;
}

/** Persist in-memory database to disk */
export function saveDB() {
  if (!db || !dbFilePath) return;
  const data = db.export();
  fs.writeFileSync(dbFilePath, Buffer.from(data));
}

/**
 * Helper: run an INSERT/UPDATE/DELETE and persist
 * @returns {{ changes: number, lastInsertRowid: number }}
 */
export function runAndSave(sql, params = []) {
  const d = getDB();
  d.run(sql, params);
  const changes = d.getRowsModified();
  const [row] = d.exec('SELECT last_insert_rowid() as id');
  const lastInsertRowid = row ? row.values[0][0] : 0;
  saveDB();
  return { changes, lastInsertRowid };
}

/**
 * Helper: query rows as array of objects
 */
export function queryAll(sql, params = []) {
  const d = getDB();
  const stmt = d.prepare(sql);
  if (params.length) stmt.bind(params);

  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

/**
 * Helper: query single row as object
 */
export function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}
