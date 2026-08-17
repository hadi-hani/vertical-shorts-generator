'use strict';

const fs = require('fs');
const path = require('path');
const { getDb } = require('../db');
const config = require('../config');

async function backupDb() {
  fs.mkdirSync(config.BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(config.BACKUP_DIR, `app-${stamp}.db`);
  await getDb().backup(dest);
  pruneBackups();
  return dest;
}

function pruneBackups() {
  let files = [];
  try {
    files = fs
      .readdirSync(config.BACKUP_DIR)
      .filter((f) => f.endsWith('.db'))
      .map((f) => ({
        f,
        t: fs.statSync(path.join(config.BACKUP_DIR, f)).mtimeMs,
      }));
  } catch (_) {
    return;
  }
  files.sort((a, b) => b.t - a.t);
  for (const old of files.slice(config.BACKUP_KEEP)) {
    fs.rmSync(path.join(config.BACKUP_DIR, old.f), { force: true });
    console.log(`[backup] pruned ${old.f}`);
  }
}

module.exports = { backupDb, pruneBackups };