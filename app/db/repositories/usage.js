'use strict';

const { getDb } = require('../index');

function periodFor(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getRow(userId, period = periodFor()) {
  return (
    getDb()
      .prepare('SELECT * FROM usage_monthly WHERE user_id = ? AND period = ?')
      .get(userId, period) || null
  );
}

function normalize(row) {
  return {
    period: row ? row.period : null,
    videosGenerated: row ? row.videos_generated : 0,
    secondsGenerated: row ? row.seconds_generated : 0,
  };
}

function increment(userId, { videos = 0, seconds = 0 } = {}) {
  const period = periodFor();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO usage_monthly (user_id, period, videos_generated, seconds_generated, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, period)
       DO UPDATE SET videos_generated = videos_generated + excluded.videos_generated,
                     seconds_generated = seconds_generated + excluded.seconds_generated,
                     updated_at = excluded.updated_at`
    )
    .run(userId, period, videos, seconds, now);
  return normalize(getRow(userId, period));
}

function checkAndIncrement(userId, { videos = 1, seconds = 0, limit }) {
  const period = periodFor();
  const tx = getDb().transaction(() => {
    const row = getRow(userId, period);
    const consumed = row ? row.videos_generated : 0;
    if (consumed + videos > limit) {
      return { allowed: false, usage: normalize(row) };
    }
    return { allowed: true, usage: increment(userId, { videos, seconds }) };
  });
  return tx();
}

module.exports = { periodFor, getRow, normalize, increment, checkAndIncrement };
