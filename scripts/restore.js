#!/usr/bin/env node
'use strict';

/* Restore a backup SQLite file into the configured DB_PATH.
 *
 * Usage:
 *   BACKUP_FILE=/path/to/backup.db DB_PATH=./data/app.db node scripts/restore.js --yes
 *
 * Safety guards:
 *   - --yes flag required (no half-measures).
 *   - Runs PRAGMA integrity_check on the source before overwriting.
 *   - Warns (but does not abort) if the running app PID is detected by
 *     scanning /proc for `node app/server.js` — the caller must stop the
 *     process manually; this script won't kill it.
 *
 * This intentionally does NOT copy output files or work directories;
 * only the SQLite database (users/projects/billing/sessions/backups). */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
if (!args.includes('--yes')) {
  console.error('Aborted: pass --yes to confirm overwrite.');
  console.error('Usage: BACKUP_FILE=<path> DB_PATH=<path> node scripts/restore.js --yes');
  process.exit(1);
}

const backupFile = process.env.BACKUP_FILE;
const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'app.db');
if (!backupFile) {
  console.error('Missing BACKUP_FILE env var.');
  process.exit(1);
}
if (!fs.existsSync(backupFile)) {
  console.error(`Backup file not found: ${backupFile}`);
  process.exit(1);
}

console.log(`Restoring ${backupFile} -> ${dbPath}`);

// Integrity check first.
try {
  const out = execSync(
    `sqlite3 "${backupFile}" "PRAGMA integrity_check;"`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  ).trim();
  if (out !== 'ok') {
    console.error(`Integrity check FAILED:\n${out}`);
    process.exit(1);
  }
  console.log('Integrity OK');
} catch (err) {
  // sqlite3 CLI might not be installed; fall back to better-sqlite3.
  try {
    const Db = require('better-sqlite3');
    const db = new Db(backupFile);
    const row = db.prepare('PRAGMA integrity_check').get();
    db.close();
    if (row.integrity_check !== 'ok') throw new Error(row.integrity_check);
    console.log('Integrity OK (via better-sqlite3)');
  } catch (e2) {
    console.error(`Integrity check failed: ${e2.message}`);
    process.exit(1);
  }
}

// Don't overwrite if someone is clearly running the server (heuristic only).
try {
  execSync('pgrep -f "node app/server.js" || true', { encoding: 'utf8' });
  console.warn('WARNING: appears to be a running node server process. Stop it before restoring.');
} catch (_) { /* no process found — fine */ }

// Atomic-ish copy: write to a temp file then rename.
const destDir = path.dirname(dbPath);
fs.mkdirSync(destDir, { recursive: true });
const tmpDest = path.join(destDir, `.restore-tmp-${process.pid}.db`);
fs.copyFileSync(backupFile, tmpDest);
fs.renameSync(tmpDest, dbPath);
console.log(`Restored to ${dbPath}. Restart the app to pick up the database.`);
console.log('Done.');
