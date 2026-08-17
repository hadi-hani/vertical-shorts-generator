'use strict';

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { spawn } = require('child_process');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const sharp = require('sharp');

const captions = require('./captions');
const { segmentCaptions, buildAss, buildSrt } = captions;

const config = require('./config');
const session = require('express-session');
const SqliteSessionStore = require('./db/session-store');
const authRoutes = require('./routes/auth');
const billingRoutes = require('./routes/billing');
const { requireAuth } = require('./middleware/auth');
const { generateLimiter } = require('./middleware/rate-limit');
const { httpError, normalizeError } = require('./lib/http-error');
const { initDb, getDb } = require('./db');
const projectsRepo = require('./db/repositories/projects');
const usageRepo = require('./db/repositories/usage');
const billingRepo = require('./db/repositories/billing');
const usersRepo = require('./db/repositories/users');
const { log } = require('./lib/logger');
const { requireAdmin } = require('./middleware/admin');
const { backupDb } = require('./services/backup');

const {
  PUBLIC_DIR,
  OUTPUT_DIR,
  WORK_DIR,
  PORT,
  HOST,
  GEMINI_API_KEY,
  GEMINI_MODEL,
  JOB_TIMEOUT_MS,
  OUTPUT_RETENTION_DAYS,
  MAX_SCRIPT_CHARS,
  DATA_DIR,
} = config;

let FFMPEG_BIN = 'ffmpeg';
try {
  const staticFfmpeg = require('ffmpeg-static');
  if (staticFfmpeg && fs.existsSync(staticFfmpeg)) FFMPEG_BIN = staticFfmpeg;
} catch (_) { /* ffmpeg-static not installed */ }

const STYLE_SUBTITLES = 'subtitles';
const CAPTION_Y = { center: 900 };
const CAPTION_STYLES = { word: 'word', progressive: 'progressive' };
const TIMING_MODES = { auto: 'auto', words: 'words' };
const DEFAULT_WORDS_PER_SEGMENT = 4;

const MAX_SCRIPT_SECONDS = 60;
const WORDS_PER_SECOND = { ar: 1.6 }; // words/sec typical Arabic voice-over pace
const TRAIL_PADDING = 0.6;

const VOICES = { ar: 'ar-SA-HamedNeural' };
const FONTS = { ar: 'Noto Naskh Arabic' };

const LANGUAGES = Object.keys(VOICES);

const app = express();
app.set('trust proxy', config.TRUST_PROXY);
app.use(
  express.json({
    limit: '512kb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use(
  helmet({
    contentSecurityPolicy: false, // pages use inline scripts/styles on purpose
    crossOriginResourcePolicy: false, // allow fonts/images from the same origin
  })
);
app.use(compression());
if (config.CORS_ORIGIN) {
  app.use(cors({ origin: config.CORS_ORIGIN, credentials: true }));
}

app.use(
  session({
    name: 'sid',
    secret: config.SESSIONS_SECRET,
    store: new SqliteSessionStore(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.COOKIE_SECURE,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

app.use('/api/auth', authRoutes);
app.use('/api/billing', billingRoutes);

/* ------------------------------------------------------------------ */
/* Job persistence + tiny sequential queue (reads/writes SQLite)        */
/* ------------------------------------------------------------------ */

let jobQueue = Promise.resolve();
let activeChild = null;

function createJob({
  userId,
  idea,
  script,
  language,
  captionStyle = CAPTION_STYLES.word,
  timingMode = TIMING_MODES.auto,
  wordsPerSegment = DEFAULT_WORDS_PER_SEGMENT,
}) {
  return projectsRepo.create({
    id: crypto.randomUUID(),
    userId,
    idea: idea || null,
    script: script || null,
    language,
    captionStyle,
    timingMode,
    wordsPerSegment,
  });
}

function updateJob(id, patch) {
  const dbPatch = {
    ...(patch.status !== undefined && { status: patch.status }),
    ...(patch.script !== undefined && { script: patch.script }),
    ...(patch.error !== undefined && { error: patch.error }),
    ...(patch.errorCode !== undefined && { error_code: patch.errorCode }),
    ...(patch.outputUrl !== undefined && { output_url: patch.outputUrl }),
    ...(patch.subtitleSrtUrl !== undefined && { subtitle_srt_url: patch.subtitleSrtUrl }),
    ...(patch.subtitleAssUrl !== undefined && { subtitle_ass_url: patch.subtitleAssUrl }),
    ...(patch.estimatedDuration !== undefined && { estimated_duration: patch.estimatedDuration }),
    ...(patch.completedAt !== undefined && { completed_at: patch.completedAt }),
    ...(patch.meta !== undefined && { meta: patch.meta }),
  };
  if (Object.keys(dbPatch).length) projectsRepo.update(id, dbPatch);
  return projectsRepo.findById(id);
}

/* ------------------------------------------------------------------ */
/* Process helpers                                                      */
/* ------------------------------------------------------------------ */

function runProcess(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    });
    activeChild = child;
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    const clearChild = () => {
      if (activeChild === child) activeChild = null;
    };
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          clearChild();
          child.kill('SIGKILL');
          const e = new Error(`${cmd} timed out after ${opts.timeoutMs}ms`);
          e.code = 'process_timeout';
          reject(e);
        }, opts.timeoutMs)
      : null;
    child.on('error', (err) => {
      clearChild();
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearChild();
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr, code });
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr}`));
    });
  });
}

function getAudioDuration(file) {
  return runProcess('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'csv=p=0',
    file,
  ]).then((r) => parseFloat(r.stdout.trim()) || 0);
}

function isToolAvailable(cmd) {
  const { spawnSync } = require('child_process');
  const res = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
  return !res.error && res.status !== null;
}

/* ------------------------------------------------------------------ */
/* Background                                                           */
/* ------------------------------------------------------------------ */

function gradientSvg(w, h, top = '#141b36', bottom = '#222b52') {
  return [
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">`,
    '  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">',
    `    <stop offset="0" stop-color="${top}"/>`,
    `    <stop offset="1" stop-color="${bottom}"/>`,
    '  </linearGradient></defs>',
    '  <rect width="100%" height="100%" fill="url(#g)"/>',
    '</svg>',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Script generation (Gemini)                                           */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT = () =>
  `You are a short-form vertical video voice-over scriptwriter. ` +
  `Write a concise, engaging Arabic voice-over script based on the user's one-line idea. ` +
  `The script should take roughly 25-35 seconds to speak. ` +
  `Use short, punchy sentences suitable for TikTok/Shorts. ` +
  `Do not include stage directions, timestamps, markdown, or quotation marks around the whole script. ` +
  `Return only the script text.`;

async function generateScript(idea) {
  if (!GEMINI_API_KEY) {
    const err = new Error('Gemini is not configured (set GEMINI_API_KEY)');
    err.code = 'gemini_not_configured';
    throw err;
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const body = {
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT() }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: `Idea: ${idea}` }],
      },
    ],
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
  } catch (err) {
    const e = new Error(`Gemini request failed: ${err.message}`);
    e.code = 'gemini_error';
    throw e;
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data && data.error && data.error.message ? data.error.message : `HTTP ${res.status}`;
    const e = new Error(`Gemini error: ${msg}`);
    e.code = 'gemini_error';
    throw e;
  }

  const text = data && data.candidates && data.candidates[0]
    && data.candidates[0].content && data.candidates[0].content.parts
    ? data.candidates[0].content.parts.map((p) => p.text || '').join('').trim()
    : '';
  if (!text) {
    const e = new Error('Gemini returned an empty script');
    e.code = 'gemini_error';
    throw e;
  }
  return text;
}

/* ------------------------------------------------------------------ */
/* TTS + word timings                                                   */
/* ------------------------------------------------------------------ */

function countWords(text) {
  const cleaned = text
    .replace(/[\u0600-\u06FF]+/g, (m) => ` ${m} `)
    .trim();
  return cleaned.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

function estimateDuration(text, language) {
  const wps = WORDS_PER_SECOND[language] || WORDS_PER_SECOND.ar;
  return countWords(text) / wps;
}

async function runTts(script, language, workDir) {
  const voice = VOICES[language] || VOICES.ar;
  const scriptPath = path.join(workDir, 'script.txt');
  const audioPath = path.join(workDir, 'audio.mp3');
  const timingsPath = path.join(workDir, 'timings.json');
  const edgeTimingsPath = path.join(workDir, 'timings_edge.json');

  await fsp.writeFile(scriptPath, script, 'utf-8');

  let source = 'edge-tts';
  try {
    await runProcess(
      'python3',
      [
        path.join(__dirname, 'tts_word_timings.py'),
        '--voice', voice,
        '--text-file', scriptPath,
        '--audio', audioPath,
        '--timings', edgeTimingsPath,
      ],
      { timeoutMs: 120000 }
    );
    let timings = JSON.parse(await fsp.readFile(edgeTimingsPath, 'utf-8'));
    if (!Array.isArray(timings) || timings.length === 0) {
      throw new Error('edge-tts produced no word timings');
    }
    await fsp.writeFile(timingsPath, JSON.stringify(timings), 'utf-8');
  } catch (err) {
    // Fall back to the whisper-based alignment approach.
    try {
      await runProcess(
        'python3',
        [
          path.join(__dirname, 'align_words.py'),
          '--audio', audioPath,
          '--text-file', scriptPath,
          '--timings', timingsPath,
          '--language', language,
        ],
        { timeoutMs: 300000 }
      );
      source = 'whisper';
    } catch (fallbackErr) {
      const e = new Error(
        `TTS/word-timing extraction failed (edge-tts: ${err.message}; whisper: ${fallbackErr.message})`
      );
      e.code = 'tts_word_timings_missing';
      throw e;
    }
  }

  const timings = JSON.parse(await fsp.readFile(timingsPath, 'utf-8'));
  if (!timings.length) {
    const e = new Error('No word timings were extracted from the audio');
    e.code = 'tts_word_timings_missing';
    throw e;
  }

  const duration = await getAudioDuration(audioPath);
  return { audioPath, timings, duration, source };
}

/* ------------------------------------------------------------------ */
/* FFmpeg render                                                        */
/* ------------------------------------------------------------------ */

async function renderVideo({ audioPath, assPath, outputPath, duration }) {
  const total = (duration + TRAIL_PADDING).toFixed(3);
  const bgPath = path.join(path.dirname(assPath), 'bg.png');
  await fsp.writeFile(
    bgPath,
    await sharp(Buffer.from(gradientSvg(1080, 1920))).png().toBuffer()
  );

  const args = [
    '-y',
    '-loop', '1', '-framerate', '30', '-i', bgPath,
    '-i', audioPath,
    '-filter_complex',
    `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
      `crop=1080:1920,fps=30,` +
      `zoompan=z='min(zoom+0.0015,1.15)':d=1:s=1080x1920:fps=30,fps=30,` +
      `ass=${assPath}[base]`,
    '-map', '[base]',
    '-map', '1:a',
    '-t', total,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    outputPath,
  ];

  console.log(`[render] total=${total} bg=solid`);
  await runProcess(FFMPEG_BIN, args, { timeoutMs: 300000 });
  return outputPath;
}

/* ------------------------------------------------------------------ */
/* Job processing                                                       */
/* ------------------------------------------------------------------ */

async function processJobById(jobId) {
  const row = projectsRepo.findById(jobId);
  if (!row) return;
  if (row.status !== 'queued') return;
  await processJob(row);
}

async function processJob(row) {
  const jobId = row.id;
  const userId = row.user_id;
  const startedAt = Date.now();
  const workDir = path.join(WORK_DIR, jobId);
  await fsp.mkdir(workDir, { recursive: true });
  updateJob(jobId, { status: 'processing', meta: { stage: 'start' } });
  log('info', 'job_start', {
    jobId,
    userId,
    captionStyle: row.caption_style,
    timingMode: row.timing_mode,
    wordsPerSegment: row.words_per_segment,
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (activeChild) activeChild.kill('SIGKILL');
  }, JOB_TIMEOUT_MS);

  try {
    let script = row.script;
    if (!script) {
      if (!GEMINI_API_KEY) {
        const e = new Error(
          'No script provided and Gemini is not configured (set GEMINI_API_KEY)'
        );
        e.code = 'gemini_not_configured';
        throw e;
      }
      script = await generateScript(row.idea);
      updateJob(jobId, { script });
    }

    const cleanScript = script.replace(/\s+/g, ' ').trim();
    if (!cleanScript) {
      const e = new Error('Script has no speakable text');
      e.code = 'empty_script';
      throw e;
    }

    const estimated = estimateDuration(cleanScript, row.language);
    updateJob(jobId, { estimatedDuration: Math.round(estimated * 10) / 10 });
    if (estimated > MAX_SCRIPT_SECONDS) {
      const e = new Error(
        `Estimated script duration (${estimated.toFixed(1)}s) exceeds the ${MAX_SCRIPT_SECONDS}s limit`
      );
      e.code = 'script_over_60_seconds';
      throw e;
    }

    updateJob(jobId, { meta: { stage: 'tts' } });
    const { audioPath, timings, duration, source } = await runTts(
      cleanScript,
      row.language,
      workDir
    );

    if (duration > MAX_SCRIPT_SECONDS + TRAIL_PADDING) {
      const e = new Error(
        `Audio duration (${duration.toFixed(1)}s) exceeds the ${MAX_SCRIPT_SECONDS}s limit`
      );
      e.code = 'script_over_60_seconds';
      throw e;
    }

    const captionStyle = CAPTION_STYLES[row.caption_style] || CAPTION_STYLES.word;
    const segments = segmentCaptions(timings, cleanScript, {
      timingMode: row.timing_mode,
      wordsPerSegment: row.words_per_segment,
      duration,
    });
    updateJob(jobId, { meta: { stage: 'captions' } });
    const assContent = buildAss(segments, row.language, {
      style: captionStyle,
      y: CAPTION_Y.center,
      font: FONTS[row.language] || FONTS.ar,
    });
    const assPath = path.join(workDir, 'subs.ass');
    await fsp.writeFile(assPath, assContent, 'utf-8');

    const outputFile = `${jobId}.mp4`;
    const userDir = path.join(OUTPUT_DIR, row.user_id);
    await fsp.mkdir(userDir, { recursive: true });
    const outputPath = path.join(userDir, outputFile);
    updateJob(jobId, { meta: { stage: 'render' } });
    await renderVideo({ audioPath, assPath, outputPath, duration });

    // Downloadable subtitle files (style-independent .srt + styled .ass).
    await fsp.copyFile(assPath, path.join(userDir, `${jobId}.ass`));
    await fsp.writeFile(
      path.join(userDir, `${jobId}.srt`),
      buildSrt(segments),
      'utf-8'
    );

    // The user may have deleted this project while it was rendering — if so,
    // discard the produced files instead of re-adding a completed project.
    const current = projectsRepo.findById(jobId);
    if (!current || current.status !== 'processing') {
      for (const ext of ['mp4', 'srt', 'ass']) {
        await fsp.unlink(path.join(userDir, `${jobId}.${ext}`)).catch(() => {});
      }
      log('info', 'job_discarded', { jobId, userId });
      return;
    }

    updateJob(jobId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      outputUrl: `/api/outputs/${outputFile}`,
      subtitleSrtUrl: `/api/outputs/${jobId}.srt`,
      subtitleAssUrl: `/api/outputs/${jobId}.ass`,
      meta: {
        stage: 'done',
        style: STYLE_SUBTITLES,
        captionStyle,
        timingMode: row.timing_mode,
        wordsPerSegment: row.words_per_segment,
        ttsSource: source,
        wordCount: timings.length,
        audioDuration: Math.round(duration * 100) / 100,
        processingMs: Date.now() - startedAt,
      },
    });
    usageRepo.increment(row.user_id, { videos: 0, seconds: Math.round(duration) });
    log('info', 'job_completed', {
      jobId,
      userId,
      processingMs: Date.now() - startedAt,
      audioDuration: Math.round(duration * 100) / 100,
    });
  } catch (err) {
    const code = timedOut ? 'job_timeout' : err.code || 'render_failed';
    const message = timedOut
      ? `Job exceeded the ${Math.round(JOB_TIMEOUT_MS / 1000)}s time limit`
      : err.message;
    log('error', 'job_failed', { jobId, userId, code, message });
    updateJob(jobId, {
      status: 'failed',
      error: message,
      errorCode: code,
    });
  } finally {
    clearTimeout(timer);
    await fsp.rm(workDir, { recursive: true, force: true });
  }
}

function enqueue(jobId) {
  jobQueue = jobQueue
    .then(() => processJobById(jobId))
    .catch((err) => {
      updateJob(jobId, {
        status: 'failed',
        error: err.message,
        errorCode: err.code || 'internal_error',
      });
    });
  return jobId;
}

function recoverStaleJobs() {
  const rows = getDb()
    .prepare("SELECT id, user_id, status FROM projects WHERE status IN ('queued', 'processing')")
    .all();
  for (const r of rows) {
    updateJob(r.id, {
      status: 'interrupted',
      error: 'Server restarted while this job was in progress',
      errorCode: 'interrupted',
    });
    log('warn', 'job_interrupted', { jobId: r.id, userId: r.user_id });
  }
}

/* ------------------------------------------------------------------ */
/* Storage lifecycle                                                    */
/* ------------------------------------------------------------------ */

const OUTPUT_EXTS = ['mp4', 'srt', 'ass'];

function deleteProjectFiles(userId, id) {
  const dir = path.join(OUTPUT_DIR, userId);
  for (const ext of OUTPUT_EXTS) {
    const file = path.join(dir, `${id}.${ext}`);
    try {
      fs.unlinkSync(file);
    } catch (_) {}
  }
}

// Move legacy flat output files (data/output/<id>.*) into per-user folders.
function migrateOutputLayout() {
  const rows = getDb()
    .prepare("SELECT id, user_id, status FROM projects WHERE status = 'completed'")
    .all();
  for (const r of rows) {
    const userDir = path.join(OUTPUT_DIR, r.user_id);
    fs.mkdirSync(userDir, { recursive: true });
    for (const ext of OUTPUT_EXTS) {
      const oldFile = path.join(OUTPUT_DIR, `${r.id}.${ext}`);
      const newFile = path.join(userDir, `${r.id}.${ext}`);
      if (!fs.existsSync(newFile) && fs.existsSync(oldFile)) {
        fs.renameSync(oldFile, newFile);
        console.log(`[storage] moved ${r.id}.${ext} into per-user folder`);
      }
    }
  }
}

function retireExpiredProjects() {
  const cutoffMs = Date.now() - OUTPUT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const rows = getDb()
    .prepare(
      'SELECT id, user_id, COALESCE(completed_at, created_at) AS last FROM projects WHERE COALESCE(completed_at, created_at) < ?'
    )
    .all(new Date(cutoffMs).toISOString());
  for (const r of rows) {
    deleteProjectFiles(r.user_id, r.id);
    projectsRepo.remove(r.id);
    console.log(`[storage] expired ${r.id} (older than ${OUTPUT_RETENTION_DAYS}d)`);
  }
  return rows.length;
}

function sweepOrphanFiles() {
  const known = new Set(
    getDb().prepare('SELECT id FROM projects').all().map((r) => r.id)
  );
  const cutoffMs = Date.now() - OUTPUT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const dirs = [OUTPUT_DIR];
  for (const entry of fs.readdirSync(OUTPUT_DIR)) {
    const full = path.join(OUTPUT_DIR, entry);
    let stat = null;
    try {
      stat = fs.statSync(full);
    } catch (_) {}
    if (stat && stat.isDirectory()) dirs.push(full);
  }
  let removed = 0;
  for (const dir of dirs) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir);
    } catch (_) {
      continue;
    }
    for (const e of entries) {
      if (!/\.(mp4|srt|ass)$/.test(e)) continue;
      const id = e.replace(/\.(mp4|srt|ass)$/, '');
      if (known.has(id)) continue;
      const full = path.join(dir, e);
      try {
        if (fs.statSync(full).mtimeMs < cutoffMs) {
          fs.rmSync(full, { force: true });
          removed++;
          console.log(`[storage] removed orphan ${path.relative(OUTPUT_DIR, full)}`);
        }
      } catch (_) {}
    }
  }
  return removed;
}

function sweepWorkDirs() {
  let entries = [];
  try {
    entries = fs.readdirSync(WORK_DIR);
  } catch (_) {}
  for (const e of entries) {
    fs.rmSync(path.join(WORK_DIR, e), { recursive: true, force: true });
  }
  if (entries.length) console.log(`[storage] cleared ${entries.length} stale work dir(s)`);
}

function runStorageSweep() {
  try {
    const expired = retireExpiredProjects();
    const orphans = sweepOrphanFiles();
    if (expired || orphans) {
      console.log(`[storage] sweep done: ${expired} expired, ${orphans} orphans removed`);
    }
  } catch (err) {
    console.error('[storage] sweep error:', err.message);
  }
}

/* ------------------------------------------------------------------ */
/* Free-plan quota                                                      */
/* ------------------------------------------------------------------ */

function buildUsageView(userId) {
  const period = usageRepo.periodFor();
  const usage = usageRepo.getRow(userId, period);
  const consumed = usage ? usage.videos_generated : 0;
  const user = usersRepo.findById(userId);
  const plan = (user && user.plan) || 'free';
  const limit = config.planLimit(plan);
  const remaining = Math.max(0, limit - consumed);
  const [y, m] = period.split('-').map(Number);
  const resetsAt = new Date(Date.UTC(y, m, 1)).toISOString();
  const sub = user && user.plan === 'premium' ? billingRepo.getByUser(userId) : null;
  return {
    plan,
    period,
    limit,
    consumed,
    remaining,
    secondsGenerated: usage ? usage.seconds_generated : 0,
    resetsAt,
    subscription: sub ? { status: sub.status } : null,
  };
}

/* ------------------------------------------------------------------ */
/* Routes                                                               */
/* ------------------------------------------------------------------ */

app.get('/api/health', (req, res) => {
  let dbOk = false;
  try {
    getDb().prepare('SELECT 1').get();
    dbOk = true;
  } catch (_) {}
  let disk = null;
  try {
    const s = fs.statfsSync(DATA_DIR);
    const free = s.bavail * s.bsize;
    const total = s.blocks * s.bsize;
    disk = {
      freeBytes: free,
      totalBytes: total,
      freePercent: total ? Math.round((free / total) * 100) : 100,
    };
  } catch (_) {}
  const counts = projectsRepo.statusCounts();
  res.json({
    ok: dbOk,
    app: 'shorts-video-mvp',
    db: { ok: dbOk },
    disk,
    jobCount: Object.values(counts).reduce((a, b) => a + b, 0),
    jobs: counts,
    geminiConfigured: Boolean(GEMINI_API_KEY),
    ffmpegAvailable: isToolAvailable('ffmpeg'),
  });
});

app.get('/api/jobs', requireAuth, (req, res) => {
  const rows = projectsRepo.listByUser(req.user.id);
  res.json({ jobs: rows.map(projectsRepo.toPublicProject) });
});

app.get('/api/usage', requireAuth, (req, res) => {
  res.json({ usage: buildUsageView(req.user.id) });
});

/* --- Admin (internal, ADMIN_EMAILS only) --- */

function measureStorage() {
  let bytes = 0;
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir);
    } catch (_) {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e);
      try {
        const st = fs.statSync(full);
        if (st.isDirectory()) walk(full);
        else if (st.isFile()) bytes += st.size;
      } catch (_) {}
    }
  };
  walk(OUTPUT_DIR);
  return bytes;
}

app.get('/api/admin/overview', requireAdmin, (req, res) => {
  let dbBytes = 0;
  try {
    dbBytes = fs.statSync(config.DB_PATH).size;
  } catch (_) {}
  res.json({
    stats: projectsRepo.stats(),
    billing: { premiumUsers: billingRepo.premiumCount() },
    storage: {
      outputBytes: measureStorage(),
      dbBytes,
    },
    admin: req.user.email,
  });
});

app.get('/api/admin/jobs', requireAdmin, (req, res) => {
  const status = (req.query.status || '').trim();
  const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
  const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);
  const rows = projectsRepo.listForAdmin({
    status: status || undefined,
    limit,
    offset,
  });
  res.json({
    jobs: rows.map(projectsRepo.toPublicProject),
    count: rows.length,
  });
});

app.get('/api/jobs/:id', requireAuth, (req, res) => {
  const row = projectsRepo.findById(req.params.id);
  if (!row || row.user_id !== req.user.id) {
    return res.status(404).json({ error: 'job_not_found' });
  }
  res.json({ job: projectsRepo.toPublicProject(row) });
});

app.delete('/api/jobs/:id', requireAuth, (req, res) => {
  const row = projectsRepo.findById(req.params.id);
  if (!row || row.user_id !== req.user.id) {
    return res.status(404).json({ error: 'job_not_found' });
  }
  projectsRepo.remove(req.params.id);
  deleteProjectFiles(row.user_id, req.params.id);
  res.json({ ok: true });
});

function validateGenerateBody(req, res) {
  const { idea, script, language } = req.body || {};
  const lang = LANGUAGES.includes(language) ? language : 'ar';
  if (!idea && !script) {
    res
      .status(400)
      .json({ error: 'invalid_request', message: 'Provide "idea" and/or "script"' });
    return null;
  }
  if (script && typeof script !== 'string') {
    res
      .status(400)
      .json({ error: 'invalid_request', message: '"script" must be a string' });
    return null;
  }
  if (script && script.length > MAX_SCRIPT_CHARS) {
    res.status(400).json({
      error: 'script_too_long',
      message: `Script exceeds the ${MAX_SCRIPT_CHARS}-character limit`,
    });
    return null;
  }
  if (idea && !script && !GEMINI_API_KEY) {
    res.status(400).json({
      error: 'gemini_not_configured',
      message: 'No script provided and GEMINI_API_KEY is not set',
    });
    return null;
  }
  return { idea, script, language: lang };
}

app.post('/api/generate/subtitles', requireAuth, generateLimiter, (req, res) => {
  const v = validateGenerateBody(req, res);
  if (!v) return;

  const user = usersRepo.findById(req.user.id);
  const plan = (user && user.plan) || 'free';
  const limit = config.planLimit(plan);
  const quota = usageRepo.checkAndIncrement(req.user.id, {
    videos: 1,
    seconds: 0,
    limit,
  });
  if (!quota.allowed) {
    const view = buildUsageView(req.user.id);
    const resets = new Date(view.resetsAt).toLocaleDateString('ar');
    return res.status(429).json({
      error: 'quota_exceeded',
      message: `لقد استهلكت حصتك الشهرية (${limit} فيديو). سيتجدد رصيدك في ${resets}، أو قم بالترقية إلى الخطة المدفوعة.`,
      usage: view,
    });
  }

  const b = req.body || {};
  const captionStyle = CAPTION_STYLES[b.captionStyle] || CAPTION_STYLES.word;
  const timingMode = TIMING_MODES[b.timingMode] || TIMING_MODES.auto;
  const wpsRaw = parseInt(b.wordsPerSegment, 10);
  const wordsPerSegment = Number.isFinite(wpsRaw)
    ? Math.max(1, Math.min(10, wpsRaw))
    : DEFAULT_WORDS_PER_SEGMENT;
  const row = createJob({
    userId: req.user.id,
    idea: v.idea,
    script: v.script,
    language: v.language,
    captionStyle,
    timingMode,
    wordsPerSegment,
  });
  enqueue(row.id);
  res.status(202).json({ job: projectsRepo.toPublicProject(row) });
});

app.post('/api/generate-script', requireAuth, generateLimiter, async (req, res) => {
  const { idea, language } = req.body || {};
  const lang = LANGUAGES.includes(language) ? language : 'ar';
  if (typeof idea !== 'string' || !idea.trim()) {
    return res.status(400).json({ error: 'invalid_request', message: 'Provide "idea"' });
  }
  if (idea.length > MAX_SCRIPT_CHARS * 4) {
    return res.status(400).json({
      error: 'idea_too_long',
      message: 'الفكرة طويلة جداً، اختصرها ثم أعد المحاولة',
    });
  }
  try {
    const script = await generateScript(idea);
    res.json({ idea, script, language: lang });
  } catch (err) {
    res.status(500).json({ error: err.code || 'gemini_error', message: err.message });
  }
});

app.get('/api/outputs/:file', requireAuth, (req, res) => {
  const file = path.basename(req.params.file);
  if (file !== req.params.file || !/^[a-zA-Z0-9._-]+\.(mp4|srt|ass)$/.test(file)) {
    return res.status(400).json({ error: 'invalid_file' });
  }
  const projectId = file.replace(/\.(mp4|srt|ass)$/, '');
  const row = projectsRepo.findById(projectId);
  if (!row || row.user_id !== req.user.id) {
    return res.status(404).json({ error: 'file_not_found' });
  }
  const full = path.join(OUTPUT_DIR, row.user_id, file);
  if (!fs.existsSync(full)) {
    return res.status(404).json({ error: 'file_not_found' });
  }
  const ext = path.extname(file).toLowerCase();
  const types = {
    '.mp4': 'video/mp4',
    '.srt': 'application/x-subrip',
    '.ass': 'text/plain; charset=utf-8',
  };
  res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
  res.sendFile(full);
});

/* Static UI */
if (fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) {
  app.use(express.static(PUBLIC_DIR));
  app.get('/projects', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'projects.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.type('text/plain').send('shorts-video-mvp API is running');
  });
}

/* ------------------------------------------------------------------ */
/* Not found + centralized error handling                               */
/* ------------------------------------------------------------------ */

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'not_found', message: 'المسار غير موجود' });
  }
  const notFoundPage = path.join(PUBLIC_DIR, '404.html');
  if (fs.existsSync(notFoundPage)) {
    return res.status(404).sendFile(notFoundPage);
  }
  res.status(404).type('text/plain').send('404 — Not found');
});

app.use((err, req, res, next) => {
  const { status, code, message } = normalizeError(err);
  if (status >= 500) {
    log('error', 'request_failed', {
      method: req.method,
      path: req.path,
      userId: (req.session && req.session.userId) || null,
      status,
      code,
      message: err.message,
    });
  }
  if (req.path.startsWith('/api/')) {
    return res.status(status).json({ error: code, message });
  }
  const errorPage = path.join(PUBLIC_DIR, `${status}.html`);
  if (fs.existsSync(errorPage)) {
    return res.status(status).sendFile(errorPage);
  }
  res.status(status).type('text/plain').send(`${status} — ${message}`);
});

/* ------------------------------------------------------------------ */
/* Boot                                                                  */
/* ------------------------------------------------------------------ */

async function boot() {
  await fsp.mkdir(OUTPUT_DIR, { recursive: true });
  await fsp.mkdir(WORK_DIR, { recursive: true });

  initDb();

  recoverStaleJobs();
  sweepWorkDirs();
  migrateOutputLayout();
  runStorageSweep();

  if (!isToolAvailable(FFMPEG_BIN)) {
    console.warn('[boot] WARNING: ffmpeg not found — rendering will fail');
  }
  if (config.SESSIONS_SECRET_GENERATED) {
    console.warn(
      '[boot] WARNING: SESSIONS_SECRET not set in .env — using a random secret; sessions reset on restart'
    );
  }
  for (const w of config.CONFIG_WARNINGS) {
    console.warn(`[boot] WARNING: ${w}`);
  }

  const sessionStore = new SqliteSessionStore();
  setInterval(() => {
    const removed = sessionStore.cleanupExpired();
    if (removed > 0) console.log(`[sessions] cleaned ${removed} expired session(s)`);
  }, 60 * 60 * 1000).unref();

  setInterval(runStorageSweep, 60 * 60 * 1000).unref();

  const runBackup = () => {
    backupDb()
      .then((p) => log('info', 'backup_done', { file: path.basename(p) }))
      .catch((err) => log('error', 'backup_failed', { message: err.message }));
  };
  runBackup();
  setInterval(runBackup, config.BACKUP_INTERVAL_MS).unref();

  app.listen(PORT, HOST, () => {
    console.log(`[boot] shorts-video-mvp listening on http://${HOST}:${PORT}`);
    console.log(`[boot] gemini=${GEMINI_API_KEY ? 'configured' : 'NOT configured'}`);
    console.log(`[boot] model=${GEMINI_MODEL}`);
  });
}

if (require.main === module) {
  boot().catch((err) => {
    console.error('[boot] failed to start:', err);
    process.exit(1);
  });
}

module.exports = { renderVideo, CAPTION_Y };