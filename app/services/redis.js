'use strict';

/* Optional Redis client (ioredis) for simple key/value caching. No-op when
 * REDIS_URL is not set — every helper degrades to a pass-through so the app
 * behaves exactly as before. Used today for script-generation caching. */

const config = require('../config');
const { log } = require('../lib/logger');

let client = null;

function init() {
  if (!config.REDIS_URL) return null;
  try {
    const Redis = require('ioredis');
    client = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });
    client.on('error', (err) => log('warn', 'redis_error', { message: err.message }));
    client.connect().catch((err) => {
      log('warn', 'redis_connect_failed', { message: err.message });
      client = null;
    });
  } catch (err) {
    log('warn', 'redis_init_failed', { message: err.message });
    client = null;
  }
  return client;
}

async function get(key) {
  if (!client) return null;
  try {
    const raw = await client.get(key);
    return raw == null ? null : JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

async function set(key, value, ttlSeconds) {
  if (!client) return false;
  try {
    await client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    return true;
  } catch (_) {
    return false;
  }
}

/* Cache-aside: try cache, on miss compute and store. */
async function wrap(key, ttlSeconds, compute) {
  if (!client) return compute();
  const hit = await get(key);
  if (hit !== null && hit !== undefined) return hit;
  const value = await compute();
  if (value !== undefined) await set(key, value, ttlSeconds);
  return value;
}

module.exports = { init, get, set, wrap, isEnabled: () => Boolean(client) };