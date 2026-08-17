'use strict';

/* Central HTTP error helpers. Handlers `throw httpError(400, 'invalid_*', 'رسالة')`
 * and the final error middleware in server.js converts it to the right response. */

function httpError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function normalizeError(err) {
  const status =
    typeof err.status === 'number' && err.status >= 400 && err.status < 600
      ? err.status
      : 500;
  const code = typeof err.code === 'string' ? err.code : 'internal_error';
  const message = status >= 500 ? 'حدث خطأ غير متوقع، حاول مرة أخرى' : err.message || code;
  return { status, code, message };
}

module.exports = { httpError, normalizeError };