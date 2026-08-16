'use strict';

const crypto = require('crypto');
const { scryptSync, timingSafeEqual, randomBytes } = crypto;

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function toPublicUser(user) {
  return { id: user.id, email: user.email, createdAt: user.created_at };
}

module.exports = {
  hashPassword,
  verifyPassword,
  toPublicUser,
};