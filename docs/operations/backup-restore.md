# Backup & Restore

The app takes automatic SQLite backups using the online backup API. See
`.env.example` for `BACKUP_DIR`, `BACKUP_KEEP`, `BACKUP_INTERVAL_MS`.

## Automatic backups

- On boot and every `BACKUP_INTERVAL_MS` (default 24 h) the app writes a
  snapshot to `<BACKUP_DIR>/app-<timestamp>.db`.
- `BACKUP_KEEP` (default 5) most recent backups are retained; older files are
  pruned.
- Backups are plain SQLite files — a consistent point-in-time copy of the
  whole database (users, projects, billing, sessions, usage).

## Manual backup

Run the same routine on demand:

```sh
node -e "require('./app/services/backup').backupDb().then(p=>console.log('backup:',p))"
```

## Restore

Stop the app first (SQLite WAL means a running process can still be writing).

```sh
# Requires the sqlite3 CLI OR better-sqlite3 (installed). Confirms the
# integrity of the source file before overwriting.
BACKUP_FILE=/path/to/app-<timestamp>.db DB_PATH=./data/app.db node scripts/restore.js --yes
```

The script:
1. Aborts unless `--yes` is passed.
2. Runs `PRAGMA integrity_check` on the backup (via `sqlite3` CLI or
   `better-sqlite3` fallback).
3. Copies the file to `DB_PATH` atomically (temp file + rename).

After restoring, start the app again. Output files are NOT restored by this
script — only the database. If outputs are on S3, `output_url` values still
point at the objects; local-only outputs whose files were lost will 404 on
download.

## Verify a backup file

```sh
sqlite3 backup.db "PRAGMA integrity_check;"
```

`test/backup.test.js` exercises the whole cycle (create → integrity check →
prune) in CI.
