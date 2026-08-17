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

function create({ email, passwordHash, emailVerified = 1 }) {
  const id = require('crypto').randomUUID();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      'INSERT INTO users (id, email, password_hash, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(id, email, passwordHash, emailVerified ? 1 : 0, now, now);
  return findById(id);
}

function updateFields(id, fields) {
  const allowed = [
    'email_verified',
    'email_verify_token',
    'email_verify_expires_at',
    'password_reset_token',
    'password_reset_expires_at',
    'password_hash',
    'updated_at',
  ];
  const entries = Object.entries(fields).filter(([k]) => allowed.includes(k));
  if (entries.length === 0) return null;
  const sets = entries.map(([k]) => `${k} = ?`).join(', ');
  getDb()
    .prepare(`UPDATE users SET ${sets} WHERE id = ?`)
    .run(...entries.map(([, v]) => v), id);
  return findById(id);
}

function findByEmailVerifyToken(token) {
  return (
    getDb()
      .prepare(
        "SELECT * FROM users WHERE email_verify_token = ? AND email_verify_expires_at > ? AND email_verified = 0"
      )
      .get(token, new Date().toISOString()) || null
  );
}

function findByPasswordResetToken(token) {
  return (
    getDb()
      .prepare(
        "SELECT * FROM users WHERE password_reset_token = ? AND password_reset_expires_at > ?"
      )
      .get(token, new Date().toISOString()) || null
  );
}

module.exports = {
  findByEmail,
  findById,
  create,
  updateFields,
  findByEmailVerifyToken,
  findByPasswordResetToken,
};
