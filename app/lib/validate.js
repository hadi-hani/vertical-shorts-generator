'use strict';

/* Small dependency-free request validation helpers. Each returns the
 * normalized value or an object describing the first error. Keeps handlers
 * short and gives consistent Arabic 400 responses. */

function str(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function email(value) {
  const v = str(value).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

function oneOf(value, allowed) {
  const v = str(value);
  return allowed.includes(v) ? v : null;
}

function intInRange(value, min, max) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

module.exports = { str, email, oneOf, intInRange };