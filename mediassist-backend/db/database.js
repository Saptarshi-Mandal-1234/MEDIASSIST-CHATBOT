// db/database.js
// Sets up a simple SQLite database file (mediassist.db) on disk.
// Creates all tables on first run and seeds the symptom-disease
// reference dataset from data/symptom_dataset.csv.

const path = require('path');
const fs = require('fs');
// Node 22.5+ ships SQLite built in — no native module / compiler needed.
const { DatabaseSync } = require('node:sqlite');
const isPostgres = Boolean(process.env.DATABASE_URL);

const DB_PATH = process.env.MEDIASSIST_DB_PATH || path.join(__dirname, '..', 'mediassist.db');
const CSV_PATH = path.join(__dirname, '..', 'data', 'symptom_dataset.csv');

const db = isPostgres ? require('./postgres').createPostgres(new (require('pg').Pool)({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 15000, idleTimeoutMillis: 10000 })) : new DatabaseSync(DB_PATH);
if (!isPostgres) db.exec('PRAGMA journal_mode = WAL;');

async function init() {
  let schema = `
    CREATE TABLE IF NOT EXISTS diseases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      symptoms TEXT NOT NULL,
      description TEXT NOT NULL,
      precautions TEXT NOT NULL,
      severity TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mood_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1,
      score INTEGER NOT NULL,
      label TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS medications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      dosage TEXT,
      frequency TEXT,
      time_of_day TEXT,
      status TEXT NOT NULL DEFAULT 'due',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      doctor TEXT,
      appointment_time TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS health_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1,
      entry TEXT NOT NULL,
      category TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS vitals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1,
      blood_pressure TEXT,
      heart_rate INTEGER,
      blood_sugar REAL,
      temperature REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1,
      mode TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `;
  if (isPostgres) schema = schema.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY').replace(/datetime\('now'\)/g, "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')");
  await db.exec(schema);
  await seedDiseasesIfEmpty();
}

// Very small, dependency-free CSV parser good enough for our
// quoted-comma-list CSV file (no need to pull in a CSV library).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') { field += '"'; i++; }
      else if (char === '"') { inQuotes = false; }
      else { field += char; }
    } else {
      if (char === '"') inQuotes = true;
      else if (char === ',') { row.push(field); field = ''; }
      else if (char === '\n') {
        if (field !== '' || row.length) { row.push(field); rows.push(row); }
        row = []; field = '';
      } else if (char === '\r') { /* skip */ }
      else { field += char; }
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function seedDiseasesIfEmpty() {
  const count = (await db.prepare('SELECT COUNT(*) AS c FROM diseases').get()).c;
  if (count > 0) return;

  if (!fs.existsSync(CSV_PATH)) {
    console.warn('No symptom_dataset.csv found — skipping disease seed.');
    return;
  }

  const text = fs.readFileSync(CSV_PATH, 'utf-8');
  const rows = parseCsv(text);
  const [header, ...data] = rows;

  const insert = db.prepare(`
    INSERT INTO diseases (name, symptoms, description, precautions, severity)
    VALUES (@name, @symptoms, @description, @precautions, @severity) ON CONFLICT(name) DO NOTHING
  `);

  const records = data
    .filter(r => r.length >= 5 && r[0])
    .map(r => ({
      name: r[0],
      symptoms: r[1],
      description: r[2],
      precautions: r[3],
      severity: r[4]
    }));

  for (const r of records) await insert.run(r);

  console.log(`Seeded ${records.length} diseases from symptom_dataset.csv`);
}

module.exports = { db, init, isPostgres };
