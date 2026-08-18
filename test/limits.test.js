'use strict';

/* HTTP-level integration tests for the queue / concurrency / project limits.
 * Spawns a temporary server with tiny limits (MAX_JOBS_PER_USER=1,
 * MAX_QUEUED_JOBS=1, MAX_PROJECTS_PER_USER=1) and seeds rows directly into
 * the SQLite DB to deterministically trigger each guard. */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = parseInt(process.env.LIMITS_HTTP_PORT || '8499', 10);
const BASE = `http://127.0.0.1:${PORT}`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'limits-http-'));
const DB_PATH = path.join(tmp, 'limits.db');
const OUTPUT_DIR = path.join(tmp, 'output');
const WORK_DIR = path.join(tmp, 'work');

let failures = 0;
let checks = 0;
function check(name, cond) {
  checks++;
  if (cond) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}`); failures++; }
}

async function request(method, urlPath, { body, cookie } = {}) {
  const res = await fetch(BASE + urlPath, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data, setCookie: res.headers.get('set-cookie') };
}

function cookieOf(res) {
  return res.setCookie ? res.setCookie.split(';')[0] : '';
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
      SESSIONS_SECRET: 'limits-http-test-secret-abcd',
      PAYPAL_MODE: 'mock',
      MAX_JOBS_PER_USER: '1',
      MAX_QUEUED_JOBS: '1',
      MAX_PROJECTS_PER_USER: '1',
      FREE_MONTHLY_VIDEO_LIMIT: '10',
      ADMIN_EMAILS: 'limits@example.com',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  const Db = require('better-sqlite3');
  let db = null;

  try {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`${BASE}/api/health`);
        if (r.ok) break;
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 500));
    }

    const reg = await request('POST', '/api/auth/register', {
      body: { email: 'limits@example.com', password: 'password123' },
    });
    check('user registers', reg.status === 201 && Boolean(reg.data.user));
    const uid = reg.data.user.id;
    const jar = cookieOf(reg);
    check('session cookie set', Boolean(jar));

    db = new Db(DB_PATH);

    // Helper to insert a project row in a given state.
    const insertProject = (id, userId, status) => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO projects (id, user_id, idea, script, language, caption_style, timing_mode, words_per_segment, status, meta, created_at, updated_at)
         VALUES (?, ?, NULL, NULL, 'ar', 'word', 'auto', 4, ?, '{}', ?, ?)`
      ).run(id, userId, status, now, now);
    };
    // Ensure the other user exists so FK constraints hold.
    const insertUser = (id, email) => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT OR IGNORE INTO users (id, email, password_hash, email_verified, plan, created_at, updated_at)
         VALUES (?, ?, 'x', 1, 'free', ?, ?)`
      ).run(id, email, now, now);
    };

    // 1) Per-user concurrency: seed 1 processing job for this user, then submit
    //    a new one -> should be rejected (MAX_JOBS_PER_USER=1).
    insertProject('seed-user-1', uid, 'processing');
    const tooMany = await request('POST', '/api/generate/subtitles', {
      cookie: jar,
      body: { script: 'نص اختبار قصير', language: 'ar', captionStyle: 'word' },
    });
    check('per-user job cap rejected (429 too_many_jobs)', tooMany.status === 429 && tooMany.data.error === 'too_many_jobs');

    // 2) Global queue cap: another user's job fills the global slot; this user
    //    now has no active jobs (delete the seeded one), but global cap is full.
    db.prepare("DELETE FROM projects WHERE id = 'seed-user-1'").run();
    insertUser('other-user', 'other@example.com');
    insertProject('seed-other-1', 'other-user', 'queued');
    const queueFull = await request('POST', '/api/generate/subtitles', {
      cookie: jar,
      body: { script: 'نص اختبار قصير 2', language: 'ar', captionStyle: 'word' },
    });
    check('global queue cap rejected (429 queue_full)', queueFull.status === 429 && queueFull.data.error === 'queue_full');

    // 3) Project limit: user already has 1 completed project, cap is 1.
    db.prepare("DELETE FROM projects WHERE id = 'seed-other-1'").run();
    insertProject('seed-done-1', uid, 'completed');
    const projLimit = await request('POST', '/api/generate/subtitles', {
      cookie: jar,
      body: { script: 'نص اختبار قصير 3', language: 'ar', captionStyle: 'word' },
    });
    check('project count cap rejected (429 project_limit)', projLimit.status === 429 && projLimit.data.error === 'project_limit');

    db.close();
  } finally {
    if (db) { try { db.close(); } catch (_) {} }
    child.kill('SIGTERM');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('----------------------------------------');
  console.log(`${checks - failures}/${checks} checks passed`);
  if (failures) process.exitCode = 1;
}

main().catch((err) => {
  console.error('LIMITS HTTP TEST ERROR:', err);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  process.exitCode = 1;
});