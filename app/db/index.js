'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { DB_PATH } = require('../config');

let db = null;

function migrate(database) {
  const dir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  database.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)'
  );
  const applied = new Set(
    database.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name)
  );
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf-8');
    const tx = database.transaction(() => {
      database.exec(sql);
      database
        .prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)')
        .run(file, new Date().toISOString());
    });
    tx();
  }
}

function initDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

module.exports = { initDb, getDb };
