'use strict';

/* Structured logger: one JSON line per event. Never log passwords, secrets,
 * or full request bodies. `redact` is a safety net for any unexpected value. */

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
}

module.exports = { log, redact };