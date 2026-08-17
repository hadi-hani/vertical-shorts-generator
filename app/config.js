'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.join(__dirname, '..');
const ENV_FILE = path.join(ROOT_DIR, '.env');

if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

const NODE_ENV = process.env.NODE_ENV || 'development';

let sessionsSecret = process.env.SESSIONS_SECRET || '';
let sessionsSecretGenerated = false;
if (!sessionsSecret) {
  if (NODE_ENV === 'production') {
    throw new Error('SESSIONS_SECRET must be set in .env when NODE_ENV=production');
  }
  sessionsSecret = crypto.randomBytes(32).toString('hex');
  sessionsSecretGenerated = true;
}

const COOKIE_SECURE = process.env.COOKIE_SECURE === '1' || process.env.COOKIE_SECURE === 'true';
const TRUST_PROXY = parseInt(process.env.TRUST_PROXY || '0', 10);

module.exports = {
  ROOT_DIR,
  PUBLIC_DIR: path.join(ROOT_DIR, 'public'),
  DATA_DIR: path.join(ROOT_DIR, 'data'),
  OUTPUT_DIR: process.env.OUTPUT_DIR || path.join(ROOT_DIR, 'data', 'output'),
  WORK_DIR: process.env.WORK_DIR || path.join(ROOT_DIR, 'data', 'work'),
  NODE_ENV,
  PORT: parseInt(process.env.PORT || '8283', 10),
  HOST: process.env.HOST || '0.0.0.0',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  SESSIONS_SECRET: sessionsSecret,
  SESSIONS_SECRET_GENERATED: sessionsSecretGenerated,
  COOKIE_SECURE,
  TRUST_PROXY,
  DB_PATH: process.env.DB_PATH || path.join(ROOT_DIR, 'data', 'app.db'),
  JOB_TIMEOUT_MS: parseInt(process.env.JOB_TIMEOUT_MS || '600000', 10),
  OUTPUT_RETENTION_DAYS: parseInt(process.env.OUTPUT_RETENTION_DAYS || '7', 10),
  MAX_SCRIPT_CHARS: parseInt(process.env.MAX_SCRIPT_CHARS || '5000', 10),
  FREE_MONTHLY_VIDEO_LIMIT: parseInt(process.env.FREE_MONTHLY_VIDEO_LIMIT || '10', 10),
  PREMIUM_MONTHLY_VIDEO_LIMIT: parseInt(process.env.PREMIUM_MONTHLY_VIDEO_LIMIT || '200', 10),
  PAYPAL_MODE: process.env.PAYPAL_MODE || 'sandbox', // sandbox | live | mock
  PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID || '',
  PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET || '',
  PAYPAL_PLAN_ID: process.env.PAYPAL_PLAN_ID || '',
  PAYPAL_WEBHOOK_ID: process.env.PAYPAL_WEBHOOK_ID || '',
  PAYPAL_BASE_URL: process.env.PAYPAL_BASE_URL || '', // public base used for PayPal return URLs
  ADMIN_EMAILS: (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  BACKUP_DIR: process.env.BACKUP_DIR || path.join(ROOT_DIR, 'data', 'backups'),
  BACKUP_KEEP: parseInt(process.env.BACKUP_KEEP || '5', 10),
  BACKUP_INTERVAL_MS: parseInt(process.env.BACKUP_INTERVAL_MS || String(24 * 60 * 60 * 1000), 10),
};

module.exports.PLAN_LIMITS = {
  free: module.exports.FREE_MONTHLY_VIDEO_LIMIT,
  premium: module.exports.PREMIUM_MONTHLY_VIDEO_LIMIT,
};

module.exports.planLimit = (plan) => module.exports.PLAN_LIMITS[plan] || module.exports.PLAN_LIMITS.free;
