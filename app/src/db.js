'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DEFAULT_SETTINGS = {
  mileage_rate: '0.76',
  max_shift_hours: '12',
  max_trip_miles: '100',
  pay_period_start: '2026-11-02',
};

function open(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'tracker.db'));
  // Azure App Service keeps /home on a network share, where WAL mode is not supported.
  db.pragma(`journal_mode = ${process.env.WEBSITE_SITE_NAME ? 'DELETE' : 'WAL'}`);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS staff (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('peer','supervisor','admin')),
      supervisor_email TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      address TEXT, city TEXT, state TEXT,
      one_way_miles REAL,
      verified INTEGER NOT NULL DEFAULT 0,
      is_home INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY,
      peer_email TEXT NOT NULL,
      activity TEXT NOT NULL,
      from_location_id INTEGER REFERENCES locations(id),
      to_location_id INTEGER REFERENCES locations(id),
      to_other TEXT,
      resident_ref TEXT,
      purpose TEXT NOT NULL,
      drove INTEGER NOT NULL DEFAULT 0,
      round_trip INTEGER NOT NULL DEFAULT 0,
      odo_start REAL, odo_end REAL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      hours REAL, miles REAL, mileage_source TEXT, rate REAL, mileage_amount REAL,
      flags TEXT,
      notes TEXT,
      status TEXT NOT NULL CHECK (status IN ('active','submitted','approved','returned','denied')),
      approver_email TEXT, approved_at TEXT, approver_comment TEXT
    );
    CREATE INDEX IF NOT EXISTS trips_peer ON trips(peer_email, started_at);
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY,
      at TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      trip_id INTEGER,
      detail TEXT
    );
  `);

  const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);

  if (db.prepare('SELECT COUNT(*) n FROM locations').get().n === 0) {
    const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'locations.json'), 'utf8'));
    const ins = db.prepare(`INSERT INTO locations (name, category, address, city, state, one_way_miles, verified, is_home)
      VALUES (@name, @category, @address, @city, @state, @one_way_miles, @verified, @is_home)`);
    db.transaction(() => seed.forEach((l) => ins.run(l)))();
  }
  return db;
}

function getSettings(db) {
  const raw = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
  return {
    mileage_rate: Number(raw.mileage_rate),
    max_shift_hours: Number(raw.max_shift_hours),
    max_trip_miles: Number(raw.max_trip_miles),
    pay_period_start: raw.pay_period_start,
  };
}

function audit(db, actor, action, tripId, detail) {
  db.prepare('INSERT INTO audit (at, actor, action, trip_id, detail) VALUES (?, ?, ?, ?, ?)')
    .run(new Date().toISOString(), actor, action, tripId ?? null, detail ?? null);
}

module.exports = { open, getSettings, audit };
