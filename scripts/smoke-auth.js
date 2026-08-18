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
      FREE_MONTHLY_VIDEO_LIMIT: '2',
      ADMIN_EMAILS: 'smoke@example.com',
      BACKUP_DIR: path.join(tmp, 'backups'),
      PAYPAL_MODE: 'mock',
      PAYPAL_CLIENT_ID: 'mock-client',
      PAYPAL_CLIENT_SECRET: 'mock-secret',
      PAYPAL_PLAN_ID: 'mock-plan-id',
      PAYPAL_WEBHOOK_ID: 'mock-webhook',
      PAYPAL_BASE_URL: `http://127.0.0.1:${PORT}`,
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
    const h = await request('GET', '/api/health');
    check('health reports db ok', h.data && h.data.db && h.data.db.ok === true);
    check('health reports ffmpeg', h.data && h.data.ffmpegAvailable === true);
    check('health reports disk', h.data && h.data.disk && h.data.disk.freeBytes > 0);
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

    check('GET /api/usage requires auth', (await request('GET', '/api/usage')).status === 401);
    const u0 = await request('GET', '/api/usage', { cookie: authedJar });
    check('usage starts at 0/2', u0.data && u0.data.usage && u0.data.usage.consumed === 0 && u0.data.usage.remaining === 2 && u0.data.usage.limit === 2);

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

    check('admin overview requires auth', (await request('GET', '/api/admin/overview')).status === 401);
    check('non-admin user blocked (403)', (await request('GET', '/api/admin/overview', { cookie: jarB })).status === 403);
    const ov = await request('GET', '/api/admin/overview', { cookie: authedJar });
    check(
      'admin overview reports stats',
      ov.status === 200 && ov.data && ov.data.stats && ov.data.stats.completed === 2 && ov.data.stats.total === 2
    );
    check(
      'admin overview reports duration',
      Boolean(ov.data && ov.data.stats && ov.data.stats.avgProcessingMs > 0)
    );
    check(
      'admin overview reports storage',
      ov.data && ov.data.storage && ov.data.storage.outputBytes > 0 && ov.data.storage.dbBytes > 0
    );
    const allJobs = await request('GET', '/api/admin/jobs', { cookie: authedJar });
    check('admin lists all jobs', allJobs.status === 200 && allJobs.data && allJobs.data.jobs.length === 2);
    const failedJobs = await request('GET', '/api/admin/jobs?status=failed', { cookie: authedJar });
    check('admin filters by status', failedJobs.status === 200 && failedJobs.data && failedJobs.data.jobs.length === 0);

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

    const u1 = await request('GET', '/api/usage', { cookie: authedJar });
    check('usage consumed 2 after jobs', u1.data && u1.data.usage && u1.data.usage.consumed === 2 && u1.data.usage.remaining === 0 && u1.data.usage.secondsGenerated > 0);
    const over = await request('POST', '/api/generate/subtitles', {
      cookie: authedJar,
      body: { script: 'نص يتجاوز الحصة المجانية المفروضة', captionStyle: 'word' },
    });
    check('quota exceeded blocked (429)', over.status === 429 && over.data && over.data.error === 'quota_exceeded');
    check('quota message is Arabic', Boolean(over.data && over.data.message && /حصتك/.test(over.data.message)));
    const uB2 = await request('GET', '/api/usage', { cookie: jarB });
    check('user B usage independent (0/2)', uB2.data && uB2.data.usage && uB2.data.usage.consumed === 0 && uB2.data.usage.remaining === 2);

    check('billing checkout requires auth', (await request('POST', '/api/billing/checkout')).status === 401);
    const checkout = await request('POST', '/api/billing/checkout', { cookie: authedJar });
    check('checkout returns approval URL', checkout.status === 200 && Boolean(checkout.data && checkout.data.approvalUrl));

    const activate = await request('POST', '/api/billing/webhook', {
      body: {
        id: 'evt-activate-1',
        event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
        resource: { id: 'sub-test-1', custom_id: userIdA },
      },
    });
    check('webhook ACTIVATED accepted', activate.status === 200 && activate.data && activate.data.ok === true);

    const uAfter = await request('GET', '/api/usage', { cookie: authedJar });
    check(
      'premium plan applied after activation',
      uAfter.data && uAfter.data.usage && uAfter.data.usage.plan === 'premium' && uAfter.data.usage.limit === 200 && uAfter.data.usage.remaining === 198
    );

    const adminBilling = await request('GET', '/api/admin/overview', { cookie: authedJar });
    check('admin overview counts premium users', adminBilling.data && adminBilling.data.billing && adminBilling.data.billing.premiumUsers === 1);

    const dupCheckout = await request('POST', '/api/billing/checkout', { cookie: authedJar });
    check('checkout blocked while already premium (409)', dupCheckout.status === 409);

    const thirdJob = await request('POST', '/api/generate/subtitles', {
      cookie: authedJar,
      body: { script: SCRIPT, language: 'ar', captionStyle: 'word', timingMode: 'auto' },
    });
    const thirdJobId = thirdJob.data && thirdJob.data.job && thirdJob.data.job.id;
    check('premium user can generate beyond free quota', thirdJob.status === 202 && Boolean(thirdJobId));
    check('premium job completed', (await pollJob(thirdJobId, authedJar, 180000)) === 'completed');

    const dupWebhook = await request('POST', '/api/billing/webhook', {
      body: {
        id: 'evt-activate-1',
        event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
        resource: { id: 'sub-test-1', custom_id: userIdA },
      },
    });
    check('duplicate webhook is idempotent', dupWebhook.status === 200 && dupWebhook.data && dupWebhook.data.duplicate === true);

    const cancelled = await request('POST', '/api/billing/webhook', {
      body: {
        id: 'evt-cancel-1',
        event_type: 'BILLING.SUBSCRIPTION.CANCELLED',
        resource: { id: 'sub-test-1', custom_id: userIdA },
      },
    });
    check('webhook CANCELLED accepted', cancelled.status === 200);
    const uAfterCancel = await request('GET', '/api/usage', { cookie: authedJar });
    check(
      'plan back to free after cancel',
      uAfterCancel.data && uAfterCancel.data.usage && uAfterCancel.data.usage.plan === 'free' && uAfterCancel.data.usage.limit === 2
    );
    const cancelNoSub = await request('POST', '/api/billing/cancel', { cookie: authedJar });
    check('cancel with no active subscription rejected (400)', cancelNoSub.status === 400);

    /* --- Payment-failed / refund / delayed-webhook cases (mock mode) --- */
    const refunded = await request('POST', '/api/billing/webhook', {
      body: {
        id: 'evt-refund-1',
        event_type: 'PAYMENT.SALE.REFUNDED',
        resource: { id: 'sub-test-1', custom_id: userIdA },
      },
    });
    check('webhook REFUNDED accepted', refunded.status === 200);
    const uRefund = await request('GET', '/api/usage', { cookie: authedJar });
    check('plan downgrades after refund', uRefund.data && uRefund.data.usage && uRefund.data.usage.plan === 'free');

    const paymentFailed = await request('POST', '/api/billing/webhook', {
      body: {
        id: 'evt-payfail-1',
        event_type: 'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
        resource: { id: 'sub-test-1', custom_id: userIdA },
      },
    });
    check('webhook PAYMENT.FAILED accepted', paymentFailed.status === 200);

    // Re-activate via a fresh checkout+approve flow in mock mode.
    const checkout2 = await request('POST', '/api/billing/checkout', { cookie: authedJar });
    check('checkout works again after downgrade', checkout2.status === 200);
    const activate2 = await request('POST', '/api/billing/webhook', {
      body: {
        id: 'evt-activate-2',
        event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
        resource: { id: 'sub-test-2', custom_id: userIdA },
      },
    });
    check('webhook second activation accepted', activate2.status === 200);
    const uPremium2 = await request('GET', '/api/usage', { cookie: authedJar });
    check(
      'plan back to premium after new subscription',
      uPremium2.data && uPremium2.data.usage && uPremium2.data.usage.plan === 'premium'
    );

    /* Delayed webhook protection: send an ACTIVATED for the OLD sub-id after
     * it was already cancelled — must be ignored, not re-activate. */
    const staleActivate = await request('POST', '/api/billing/webhook', {
      body: {
        id: 'evt-stale-1',
        event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
        resource: { id: 'sub-test-1', custom_id: userIdA }, // old sub
      },
    });
    check('stale delayed ACTIVATE ignored', staleActivate.status === 200);
    const uStale = await request('GET', '/api/usage', { cookie: authedJar });
    check(
      'plan stays premium despite stale activate (old sub)',
      uStale.data && uStale.data.usage && uStale.data.usage.plan === 'premium'
    );

    /* Limits / body caps */
    const tooLongScript = await request('POST', '/api/generate/subtitles', {
      cookie: authedJar,
      body: { script: 'x'.repeat(6000), language: 'ar', captionStyle: 'word' },
    });
    check('script exceeds MAX_SCRIPT_CHARS (400)', tooLongScript.status === 400);

    const tooLongIdea = await request('POST', '/api/generate-script', {
      cookie: authedJar,
      body: { idea: 'y'.repeat(21000) },
    });
    check('idea exceeds limit (400)', tooLongIdea.status === 400);

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