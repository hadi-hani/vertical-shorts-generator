'use strict';

/* Structured logger: one JSON line per event. Never log passwords, secrets,
 * or full request bodies. `redact` is a safety net for any unexpected value.
 *
 * Logs to stdout/stderr always. When LOG_DIR is set, lines are also appended
 * to <LOG_DIR>/app.log with daily rotation (app-YYYY-MM-DD.log). */

const fs = require('fs');
const path = require('path');

const LOG_DIR = process.env.LOG_DIR || '';
let logStream = null;
let logDate = '';

function rotate() {
  const today = new Date().toISOString().slice(0, 10);
  if (today === logDate) return;
  logDate = today;
  if (logStream) logStream.end();
  logStream = fs.createWriteStream(path.join(LOG_DIR, `app-${today}.log`), {
    flags: 'a',
  });
}

function write(level, line) {
  if (!LOG_DIR) return;
  try {
    rotate();
    logStream.write(line + '\n');
  } catch (_) {
    /* disk write failure must never crash the request path */
  }
}

function redact(value) {
  const s = String(value);
  return s.replace(
    /(password|passwd|secret|token|authorization|api[_-]?key)["']?\s*[:=]\s*["']?[^\s,"'}]+/gi,
    (m) => m.replace(/([:=]\s*["']?)[^\s,"'}]+/i, '$1[REDACTED]')
  );
}

function log(level, event, fields = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  write(level, line);
}

module.exports = { log, redact };