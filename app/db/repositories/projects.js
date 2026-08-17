'use strict';

const os = require('os');
const { getDb } = require('../index');
const config = require('../../config');

const UPDATABLE = new Set([
  'status',
  'error',
  'error_code',
  'output_url',
  'subtitle_srt_url',
  'subtitle_ass_url',
  'estimated_duration',
  'completed_at',
  'meta',
  'script',
]);

function create({ id, userId, idea, script, language, captionStyle, timingMode, wordsPerSegment }) {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      'INSERT INTO projects (id, user_id, idea, script, language, caption_style, timing_mode, words_per_segment, status, meta, created_at, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      id,
      userId,
      idea || null,
      script || null,
      language,
      captionStyle,
      timingMode,
      wordsPerSegment,
      'queued',
      '{}',
      now,
      now
    );
  return findById(id);
}

function findById(id) {
  return getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) || null;
}

function listByUser(userId) {
  return getDb()
    .prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId);
}

function remove(id) {
  return getDb().prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0;
}

function update(id, patch) {
  const keys = Object.keys(patch).filter((k) => UPDATABLE.has(k));
  if (keys.length) {
    const values = keys.map((k) => {
      if (k === 'meta' && patch[k] && typeof patch[k] === 'object') {
        const row = getDb().prepare('SELECT meta FROM projects WHERE id = ?').get(id);
        const prev = parseMeta(row && row.meta);
        return JSON.stringify({ ...prev, ...patch[k] });
      }
      return patch[k] === undefined ? null : patch[k];
    });
    keys.push('updated_at');
    values.push(new Date().toISOString());
    getDb()
      .prepare(`UPDATE projects SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...values, id);
  }
  return findById(id);
}

function parseMeta(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch (_) {
    return {};
  }
}

function statusCounts() {
  const rows = getDb()
    .prepare('SELECT status, COUNT(*) AS c FROM projects GROUP BY status')
    .all();
  const counts = {};
  for (const r of rows) counts[r.status] = r.c;
  return counts;
}

function listForAdmin({ status, limit = 50, offset = 0 } = {}) {
  const where = status ? 'WHERE status = ?' : '';
  const params = status ? [status, limit, offset] : [limit, offset];
  return getDb()
    .prepare(`SELECT * FROM projects ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params);
}

function stats() {
  const byStatus = statusCounts();
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const proc = getDb()
    .prepare(
      "SELECT COUNT(*) AS c, COALESCE(SUM(CAST(json_extract(meta, '$.processingMs') AS INTEGER)), 0) AS totalMs FROM projects WHERE status = 'completed'"
    )
    .get();
  return {
    total,
    byStatus,
    completed: proc.c,
    totalProcessingMs: proc.totalMs,
    avgProcessingMs: proc.c ? Math.round(proc.totalMs / proc.c) : 0,
  };
}

function toPublicProject(row) {
  return {
    id: row.id,
    status: row.status,
    idea: row.idea,
    script: row.script,
    language: row.language,
    captionStyle: row.caption_style,
    timingMode: row.timing_mode,
    wordsPerSegment: row.words_per_segment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    outputUrl: row.output_url,
    subtitleSrtUrl: row.subtitle_srt_url,
    subtitleAssUrl: row.subtitle_ass_url,
    error: sanitizeError(row.error),
    errorCode: row.error_code,
    estimatedDuration: row.estimated_duration,
    meta: parseMeta(row.meta),
  };
}

function sanitizeError(msg) {
  if (!msg) return msg;
  let out = String(msg);
  const sensitive = [
    config.ROOT_DIR,
    config.DATA_DIR,
    config.OUTPUT_DIR,
    config.WORK_DIR,
    os.tmpdir(),
    process.env.HOME,
  ].filter(Boolean);
  for (const dir of sensitive) {
    if (out.includes(dir)) out = out.split(dir).join('[server path]');
  }
  out = out.replace(/\/tmp\/[A-Za-z0-9._/-]+/g, '[server path]');
  out = out.replace(/\/(home|Users)\/[A-Za-z0-9._/-]+/g, '[server path]');
  return out;
}

module.exports = { create, findById, listByUser, remove, update, toPublicProject, parseMeta, statusCounts, listForAdmin, stats };