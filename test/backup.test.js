'use strict';

/* Unit tests for backupDb / pruneBackups against a temp SQLite DB.
 * Runs offline (no server needed). Verify backup integrity + pruning. */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);

const keepN = 3;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
const DB_PATH = path.join(tmpDir, 'test.db');
const BK_DIR = path.join(tmpDir, 'backups');

function teardown() {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
}

// Re-require local modules after env injection so they pick up new values.
function boot() {
  process.env.DB_PATH = DB_PATH;
  process.env.BACKUP_DIR = BK_DIR;
  process.env.BACKUP_KEEP = String(keepN);
  const localPkgs = [path.join(ROOT, 'app/config'), path.join(ROOT, 'app/db'), path.join(ROOT, 'app/services/backup')];
  for (const p of localPkgs) {
    try { delete require.cache[require.resolve(p)]; } catch (_) {}
  }
}
boot();

const { initDb } = require(path.join(ROOT, 'app/db'));
const { backupDb, pruneBackups } = require(path.join(ROOT, 'app/services/backup'));

async function run() {
  initDb();

  const Db = require('better-sqlite3');
  const db = new Db(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS _seed (id TEXT PRIMARY KEY, val TEXT);
    INSERT OR IGNORE INTO _seed VALUES ('k', 'v');
  `);
  db.close();

  const backupPath = await backupDb();
  if (!fs.existsSync(backupPath)) throw new Error('backup file was not created');

  const Db2 = require('better-sqlite3');
  const backupDb2 = new Db2(backupPath);
  const integrity = backupDb2.prepare('PRAGMA integrity_check').get().integrity_check;
  backupDb2.close();
  if (integrity !== 'ok') throw new Error(`integrity_check failed: ${integrity}`);

  const Db3 = require('better-sqlite3');
  const live = new Db3(DB_PATH);
  const row = live.prepare('SELECT val FROM _seed WHERE id = ?').get('k');
  live.close();
  if (!row || row.val !== 'v') throw new Error('seed row missing after backup');

  // Create keepN+2 extra files and let pruneBackups trim to keepN.
  const stampNow = () => new Date(Date.now() - Math.random() * 1000 * 60 * 60).toISOString().replace(/[:.]/g, '-');
  for (let i = 0; i < keepN + 2; i++) {
    fs.writeFileSync(path.join(BK_DIR, `app-${stampNow()}.db`), 'x');
  }
  pruneBackups();
  const remaining = fs.readdirSync(BK_DIR).filter((f) => f.endsWith('.db'));
  if (remaining.length !== keepN) throw new Error(`expected ${keepN} backup(s), got ${remaining.length}`);

  teardown();
  console.log('backup unit tests OK');
  process.exitCode = 0;
}

run().catch((err) => {
  console.error('backup test FAILED:', err.message);
  teardown();
  process.exitCode = 1;
});
