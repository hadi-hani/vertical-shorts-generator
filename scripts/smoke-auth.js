'use strict';

/* Re-runnable smoke test: boots the app on a temp DB/port and exercises the
 * auth + caption flow end to end:
 *   401 anon -> register -> duplicate -> me -> logout -> login ->
 *   wrong password -> generate (word & progressive) -> download -> block anon.
 * Exits 0 on success, 1 on any failure. Requires ffmpeg + edge-tts (same as
 * the app). Run: npm run smoke
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));

const ROOT = path.join(__dirname, '..');
const PORT = parseInt(process.env.SMOKE_PORT || '8299', 10);
const BASE = `http://127.0.0.1:${PORT}`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shorts-smoke-'));
const DB_PATH = path.join(tmp, 'smoke.db');
const OUTPUT_DIR = path.join(tmp, 'output');
const WORK_DIR = path.join(tmp, 'work');

let failures = 0;
let checks = 0;

function check(name, cond) {
  checks++;
  if (cond) console.log(`PASS  ${name}`);
  else {
    console.log(`FAIL  ${name}`);
    failures++;
  }
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
  try {
    data = await res.json();
  } catch (_) {}
  return { status: res.status, data, setCookie: res.headers.get('set-cookie') };
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function pollJob(jobId, cookie, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data } = await request('GET', `/api/jobs/${jobId}`, { cookie });
    const status = data && data.job && data.job.status;
    if (status === 'completed' || status === 'failed') return status;
    if (status === 'interrupted') return status;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return 'timeout';
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
      SESSIONS_SECRET: 'smoke-test-session-secret-0123456789abcdef',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  try {
    if (!(await waitForServer(30000))) {
      console.error('FATAL: server did not boot');
      process.exitCode = 1;
      return;
    }
    console.log('PASS  server booted');

    check('health is open', (await request('GET', '/api/health')).status === 200);
    check('GET /api/jobs requires auth', (await request('GET', '/api/jobs')).status === 401);
    check('GET /api/outputs/* requires auth', (await request('GET', '/api/outputs/x.mp4')).status === 401);
    check('POST generate requires auth', (await request('POST', '/api/generate/subtitles', { body: { script: 'مرحبا' } })).status === 401);

    const reg = await request('POST', '/api/auth/register', {
      body: { email: 'smoke@example.com', password: 'password123' },
    });
    check('register returns a user', reg.status === 201 && Boolean(reg.data.user && reg.data.user.id));
    const userIdA = reg.data.user.id;
    const jar = cookieOf(reg);
    check('register sets a session cookie', Boolean(jar));

    const dup = await request('POST', '/api/auth/register', {
      body: { email: 'smoke@example.com', password: 'password123' },
    });
    check('duplicate email rejected (409)', dup.status === 409);

    const me = await request('GET', '/api/auth/me', { cookie: jar });
    check('GET /api/auth/me returns email', me.data && me.data.user && me.data.user.email === 'smoke@example.com');

    const logout = await request('POST', '/api/auth/logout', { cookie: jar });
    check('logout succeeds', logout.status === 200);
    check('GET /api/auth/me after logout is 401', (await request('GET', '/api/auth/me', { cookie: jar })).status === 401);

    const login = await request('POST', '/api/auth/login', {
      body: { email: 'smoke@example.com', password: 'password123' },
    });
    check('login succeeds', login.status === 200);
    const authedJar = cookieOf(login);
    check('login rotates the session cookie', Boolean(authedJar));

    const badLogin = await request('POST', '/api/auth/login', {
      body: { email: 'smoke@example.com', password: 'wrongpass1' },
    });
    check('wrong password rejected (401)', badLogin.status === 401);

    const SCRIPT =
      'مرحبا بك في تطبيق الكابشن العربي. هذا اختبار قصير للتأكد أن الميزة الجديدة لم تكسر شيئا.';

    let firstJobId = '';
    for (const style of ['word', 'progressive']) {
      const job = await request('POST', '/api/generate/subtitles', {
        cookie: authedJar,
        body: { script: SCRIPT, language: 'ar', captionStyle: style, timingMode: 'auto' },
      });
      const jobId = job.data && job.data.job && job.data.job.id;
      check(`submit ${style} job (202)`, job.status === 202 && Boolean(jobId));
      if (!firstJobId) firstJobId = jobId;

      const final = await pollJob(jobId, authedJar, 180000);
      check(`${style} job completed`, final === 'completed');

      const detail = await request('GET', `/api/jobs/${jobId}`, { cookie: authedJar });
      const dJob = detail.data && detail.data.job;
      check(`${style} job has completion meta`, Boolean(dJob && dJob.meta && dJob.meta.stage === 'done'));

      const mp4 = await request('GET', `/api/outputs/${jobId}.mp4`, { cookie: authedJar });
      check(`${style} mp4 downloadable`, mp4.status === 200);
      const srt = await request('GET', `/api/outputs/${jobId}.srt`, { cookie: authedJar });
      check(`${style} srt downloadable`, srt.status === 200);
      const anon = await request('GET', `/api/outputs/${jobId}.mp4`);
      check(`${style} mp4 blocked without auth`, anon.status === 401);
    }

    const aList = await request('GET', '/api/jobs', { cookie: authedJar });
    check('user A sees all their projects', aList.data && aList.data.jobs.length === 2);

    const uaDir = path.join(OUTPUT_DIR, userIdA);
    check('outputs live in per-user folder (mp4)', fs.existsSync(path.join(uaDir, `${firstJobId}.mp4`)));
    check('outputs live in per-user folder (srt)', fs.existsSync(path.join(uaDir, `${firstJobId}.srt`)));
    check('outputs live in per-user folder (ass)', fs.existsSync(path.join(uaDir, `${firstJobId}.ass`)));
    check('no flat output in OUTPUT_DIR root', !fs.existsSync(path.join(OUTPUT_DIR, `${firstJobId}.mp4`)));

    const regB = await request('POST', '/api/auth/register', {
      body: { email: 'other@example.com', password: 'password456' },
    });
    const jarB = cookieOf(regB);
    check('second user registers', regB.status === 201 && Boolean(jarB));

    const bJobs = await request('GET', '/api/jobs', { cookie: jarB });
    check('user B sees no projects', bJobs.data && bJobs.data.jobs.length === 0);
    check("user B cannot read A's job (404)", (await request('GET', `/api/jobs/${firstJobId}`, { cookie: jarB })).status === 404);
    check("user B cannot download A's file (404)", (await request('GET', `/api/outputs/${firstJobId}.mp4`, { cookie: jarB })).status === 404);
    check('A can still read own job', (await request('GET', `/api/jobs/${firstJobId}`, { cookie: authedJar })).status === 200);

    const delAnon = await request('DELETE', `/api/jobs/${firstJobId}`);
    check('DELETE requires auth', delAnon.status === 401);
    const delB = await request('DELETE', `/api/jobs/${firstJobId}`, { cookie: jarB });
    check("user B cannot delete A's job (404)", delB.status === 404);

    const del = await request('DELETE', `/api/jobs/${firstJobId}`, { cookie: authedJar });
    check('A deletes own job (200)', del.status === 200);
    check('deleted job returns 404', (await request('GET', `/api/jobs/${firstJobId}`, { cookie: authedJar })).status === 404);
    check('deleted output file returns 404', (await request('GET', `/api/outputs/${firstJobId}.mp4`, { cookie: authedJar })).status === 404);
    const aList2 = await request('GET', '/api/jobs', { cookie: authedJar });
    check('A has one project after delete', aList2.data && aList2.data.jobs.length === 1);

    const secret = path.join(WORK_DIR, 'secret-dir');
    const db = new Database(DB_PATH);
    db.prepare(
      'INSERT INTO projects (id, user_id, idea, script, language, caption_style, timing_mode, words_per_segment, status, error, error_code, meta, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run('leak-test', userIdA, null, null, 'ar', 'word', 'auto', 4, 'failed', `boom at ${secret}`, 'render_failed', '{}', new Date().toISOString(), new Date().toISOString());
    db.close();
    const leak = await request('GET', '/api/jobs/leak-test', { cookie: authedJar });
    const leaked = leak.data && leak.data.job && leak.data.job.error;
    check('error paths are sanitized in API', leak.status === 200 && leaked && !leaked.includes(secret) && leaked.includes('[server path]'));
    await request('DELETE', '/api/jobs/leak-test', { cookie: authedJar });

    console.log('----------------------------------------');
    console.log(`${checks - failures}/${checks} checks passed`);
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('SMOKE ERROR:', err);
  process.exitCode = 1;
});