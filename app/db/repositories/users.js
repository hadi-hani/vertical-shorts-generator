'use strict';

const { getDb } = require('../index');

function findByEmail(email) {
  return getDb()
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(String(email || '').trim().toLowerCase()) || null;
}

function findById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

function create({ email, passwordHash }) {
  const id = require('crypto').randomUUID();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(id, email, passwordHash, now, now);
  return findById(id);
}

module.exports = { findByEmail, findById, create };
