'use strict';

const session = require('express-session');
const { getDb } = require('./index');

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

class SqliteSessionStore extends session.Store {
  get(sid, cb) {
    try {
      const row = getDb()
        .prepare('SELECT data FROM sessions WHERE id = ? AND expires_at > ?')
        .get(sid, Date.now());
      cb(null, row ? JSON.parse(row.data) : null);
    } catch (err) {
      cb(err);
    }
  }

  set(sid, session, cb) {
    try {
      const expires = session && session.cookie && session.cookie.expires;
      const expiresAt = expires ? new Date(expires).getTime() : Date.now() + DEFAULT_TTL_MS;
      getDb()
        .prepare(
          'INSERT INTO sessions (id, data, expires_at, created_at) VALUES (?, ?, ?, ?) ' +
            'ON CONFLICT(id) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at'
        )
        .run(sid, JSON.stringify(session), expiresAt, new Date().toISOString());
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sid);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  cleanupExpired() {
    return getDb().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now()).changes;
  }
}

module.exports = SqliteSessionStore;
