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

let sessionsSecret = process.env.SESSIONS_SECRET || '';
let sessionsSecretGenerated = false;
if (!sessionsSecret) {
  sessionsSecret = crypto.randomBytes(32).toString('hex');
  sessionsSecretGenerated = true;
}

const COOKIE_SECURE = process.env.COOKIE_SECURE === '1' || process.env.COOKIE_SECURE === 'true';

module.exports = {
  ROOT_DIR,
  PUBLIC_DIR: path.join(ROOT_DIR, 'public'),
  DATA_DIR: path.join(ROOT_DIR, 'data'),
  OUTPUT_DIR: path.join(ROOT_DIR, 'data', 'output'),
  WORK_DIR: path.join(ROOT_DIR, 'data', 'work'),
  PORT: parseInt(process.env.PORT || '8283', 10),
  HOST: process.env.HOST || '0.0.0.0',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  SESSIONS_SECRET: sessionsSecret,
  SESSIONS_SECRET_GENERATED: sessionsSecretGenerated,
  COOKIE_SECURE,
  DB_PATH: process.env.DB_PATH || path.join(ROOT_DIR, 'data', 'app.db'),
};
