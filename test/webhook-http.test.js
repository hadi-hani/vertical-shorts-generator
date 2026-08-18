'use strict';

/* HTTP-level webhook integration tests. Spawns a temporary server instance
 * (same harness as smoke-auth.js) with PAYPAL_MODE=mock and
 * PAYPAL_MOCK_VERIFY=0 so signature verification always fails. Verifies
 * the /api/billing/webhook route rejects with 400. */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = parseInt(process.env.WEBHOOK_HTTP_PORT || '8399', 10);
const BASE = `http://127.0.0.1:${PORT}`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'webhook-http-'));
const DB_PATH = path.join(tmp, 'wh.db');
const OUTPUT_DIR = path.join(tmp, 'output');
const WORK_DIR = path.join(tmp, 'work');

let failures = 0;
let checks = 0;
function check(name, cond) {
  checks++;
  if (cond) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}`); failures++; }
}

async function request(method, urlPath, opts = {}) {
  const res = await fetch(BASE + urlPath, {
    method,
    headers: opts.headers || { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

async function main() {
  const child = spawn(process.execPath, ['app/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DB_PATH,
      OUTPUT_DIR,
      WORK_DIR,
      NODE_ENV: 'test',
      SESSIONS_SECRET: 'webhook-http-test-secret-abcd',
      PAYPAL_MODE: 'mock',
      PAYPAL_CLIENT_ID: 'mock-client',
      PAYPAL_CLIENT_SECRET: 'mock-secret',
      PAYPAL_PLAN_ID: 'mock-plan-id',
      PAYPAL_WEBHOOK_ID: 'mock-webhook',
      PAYPAL_BASE_URL: `http://127.0.0.1:${PORT}`,
      PAYPAL_MOCK_VERIFY: '0', // force signature verification to fail
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  try {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`${BASE}/api/health`);
        if (r.ok) break;
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 500));
    }

    const hdrs = {
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-cert-url': 'https://www.paypal.com/cgi-bin/webscr?cmd=_cert-id',
      'paypal-transmission-id': 'abc',
      'paypal-transmission-sig': 'sig',
      'paypal-transmission-time': new Date().toISOString(),
    };
    const evt = {
      id: 'evt-bad',
      event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
      resource: { id: 'sub-x', custom_id: 'user-x' },
    };

    const badSig = await request('POST', '/api/billing/webhook', { headers: hdrs, body: evt });
    check('invalid signature rejected (400)', badSig.status === 400);

    const missingEvtId = await request('POST', '/api/billing/webhook', { headers: hdrs, body: { event_type: 'X', resource: {} } });
    check('missing event id rejected (400)', missingEvtId.status === 400);

    const missingType = await request('POST', '/api/billing/webhook', { headers: hdrs, body: { id: 'x' } });
    check('missing event type rejected (400)', missingType.status === 400);
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('----------------------------------------');
  console.log(`${checks - failures}/${checks} checks passed`);
  if (failures) process.exitCode = 1;
}

main().catch((err) => {
  console.error('WEBHOOK HTTP TEST ERROR:', err);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exitCode = 1;
});
