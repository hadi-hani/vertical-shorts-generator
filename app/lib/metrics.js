'use strict';

/* Lightweight in-memory metrics for /api/metrics (Prometheus text format).
 * Counters reset on restart — good enough for per-process monitoring. */

const counters = new Map(); // key -> number
const histograms = new Map(); // key -> { count, sum, buckets }

const DURATION_BUCKETS_MS = [50, 100, 250, 500, 1000, 2500, 5000, 10000];

function inc(key) {
  counters.set(key, (counters.get(key) || 0) + 1);
}

function observe(name, value) {
  const h = histograms.get(name) || { count: 0, sum: 0, buckets: {} };
  h.count++;
  h.sum += value;
  for (const b of DURATION_BUCKETS_MS) {
    if (value <= b) h.buckets[b] = (h.buckets[b] || 0) + 1;
  }
  histograms.set(name, h);
}

function trackRequest(method, path, status, durationMs) {
  inc(`method="${method}",path="${path}",status="${status}"`);
  observe('http_request_duration_ms', durationMs);
}

function recordJob(status) {
  inc(`status="${status}"`);
}

function formatPrometheus() {
  const lines = [
    '# HELP http_requests_total Total HTTP requests served',
    '# TYPE http_requests_total counter',
  ];
  for (const [k, v] of [...counters.entries()].sort()) {
    if (k.startsWith('status=')) continue;
    lines.push(`http_requests_total{${k}} ${v}`);
  }
  lines.push(
    '# HELP http_request_duration_ms Request duration in ms',
    '# TYPE http_request_duration_ms histogram'
  );
  for (const [name, h] of histograms.entries()) {
    for (const b of DURATION_BUCKETS_MS) {
      lines.push(`${name}_bucket{le="${b}"} ${h.buckets[b] || 0}`);
    }
    lines.push(`${name}_bucket{le="+Inf"} ${h.count}`);
    lines.push(`${name}_sum ${Math.round(h.sum)}`);
    lines.push(`${name}_count ${h.count}`);
  }
  lines.push('# HELP jobs_total Completed/failed job events', '# TYPE jobs_total counter');
  for (const [k, v] of counters.entries()) {
    if (k.startsWith('status=')) lines.push(`jobs_total{${k}} ${v}`);
  }
  return lines.join('\n') + '\n';
}

module.exports = { trackRequest, recordJob, formatPrometheus };