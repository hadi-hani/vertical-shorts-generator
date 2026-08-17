'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'too_many_requests',
    message: 'محاولات كثيرة جداً. حاول بعد 15 دقيقة.',
  },
});

/* Limits video/script generation per IP. The per-user sequential queue
 * already caps concurrency; this guards against token/account abuse. */
const generateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.RATE_LIMIT_GENERATE_PER_MIN,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'too_many_requests',
    message: 'طلبات كثيرة جداً. حاول بعد دقيقة.',
  },
});

module.exports = { authLimiter, generateLimiter };