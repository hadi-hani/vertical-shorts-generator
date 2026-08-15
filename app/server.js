'use strict';

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const express = require('express');

const ENV_FILE = path.join(__dirname, '..', '.env');
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

const ROOT_DIR = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const OUTPUT_DIR = path.join(DATA_DIR, 'output');
const WORK_DIR = path.join(DATA_DIR, 'work');

const PORT = parseInt(process.env.PORT || '8283', 10);
const HOST = process.env.HOST || '0.0.0.0';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

let FFMPEG_BIN = 'ffmpeg';
try {
  const staticFfmpeg = require('ffmpeg-static');
  if (staticFfmpeg) FFMPEG_BIN = staticFfmpeg;
} catch (_) { /* ffmpeg-static not installed */ }

const MAX_SCRIPT_SECONDS = 60;
const WORDS_PER_SECOND = { en: 2.6, ar: 1.6 }; // words/sec typical voice-over pace
const TRAIL_PADDING = 0.6;

const VOICES = {
  en: 'en-US-AriaNeural',
  ar: 'ar-SA-HamedNeural',
};
const FONTS = {
  en: 'DejaVu Sans',
  ar: 'Noto Naskh Arabic',
};

const LANGUAGES = Object.keys(VOICES);

const app = express();
app.use(express.json({ limit: '1mb' }));

/* ------------------------------------------------------------------ */
/* Job store + tiny sequential queue                                    */
/* ------------------------------------------------------------------ */

const jobs = new Map();
let jobQueue = Promise.resolve();

function createJob({ idea, script, language }) {
  const id = crypto.randomUUID();
  const job = {
    id,
    status: 'queued',
    idea: idea || null,
    script: script || null,
    language,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    outputFile: null,
    outputUrl: null,
    error: null,
    errorCode: null,
    estimatedDuration: null,
    meta: {},
  };
  jobs.set(id, job);
  return job;
}

function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  return job;
}

function listJobs() {
  return Array.from(jobs.values()).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    idea: job.idea,
    script: job.script,
    language: job.language,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    outputUrl: job.outputUrl,
    error: job.error,
    errorCode: job.errorCode,
    estimatedDuration: job.estimatedDuration,
    meta: job.meta,
  };
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
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
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
/* Gemini script generation                                             */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT = (language) => {
  const langName = language === 'ar' ? 'Arabic' : 'English';
  return `You are a short-form vertical video voice-over scriptwriter. ` +
    `Write a concise, engaging voice-over script in ${langName} based on the user's one-line idea. ` +
    `The script should take roughly 25-35 seconds to speak. ` +
    `Use short, punchy sentences suitable for TikTok/Shorts. ` +
    `Do not include stage directions, timestamps, markdown, or quotation marks around the whole script. ` +
    `If the idea is in ${langName === 'Arabic' ? 'Arabic' : 'English'} keep the script in that language. ` +
    `Return only the script text.`;
};

async function generateScript(idea, language) {
  if (!GEMINI_API_KEY) {
    const err = new Error('Gemini is not configured (set GEMINI_API_KEY)');
    err.code = 'gemini_not_configured';
    throw err;
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const body = {
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT(language) }],
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
  const wps = WORDS_PER_SECOND[language] || WORDS_PER_SECOND.en;
  return countWords(text) / wps;
}

async function runTts(script, language, workDir) {
  const voice = VOICES[language] || VOICES.en;
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
      { timeout: 120000 }
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
        { timeout: 300000 }
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
/* ASS subtitle generation                                              */
/* ------------------------------------------------------------------ */

function toAssTime(sec) {
  const c = Math.max(0, Math.round(sec * 100));
  const cs = c % 100;
  const s = Math.floor(c / 100) % 60;
  const m = Math.floor(c / 6000) % 60;
  const h = Math.floor(c / 360000);
  const p = (n) => String(n).padStart(2, '0');
  return `${h}:${p(m)}:${p(s)}.${p(cs)}`;
}

function cleanWord(raw) {
  return raw
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '')
    .trim();
}

function fontsizeFor(text) {
  const len = Array.from(text).length;
  const size = Math.round(1900 / Math.max(1, len));
  return Math.max(48, Math.min(96, size));
}

/**
 * Build an ASS subtitle file with animated, word-by-word captions.
 * Each word becomes its own Dialogue event (contiguous so captions never
 * flicker), with a scale "pop" + fade animation. Single-word events keep
 * rendering robust for RTL (Arabic) scripts too.
 */
function makeAss(timings, language) {
  const font = FONTS[language] || FONTS.en;
  const accent = language === 'ar' ? '\\1c&H47F7F0&' : '\\1c&H62C8FF&'; // subtle tint

  const events = [];
  for (let i = 0; i < timings.length; i++) {
    const word = cleanWord(timings[i].word);
    if (!word) continue;
    const start = Math.max(0, timings[i].start);
    const end = i + 1 < timings.length
      ? Math.max(timings[i].end, timings[i + 1].start)
      : timings[i].end + 0.35;
    const size = fontsizeFor(word);
    const fade = 90;
    const pop = `\\t(0,130,\\fscx100\\fscy100)`;
    const text = `{\\pos(540,1480)\\an5\\fs${size}\\fscx80\\fscy80\\fad(${fade},${fade})${pop}${accent}}${word}`;
    events.push(
      `Dialogue: 0,${toAssTime(start)},${toAssTime(end)},Karaoke,,0,0,0,,${text}`
    );
  }

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Karaoke,${font},70,&H00FFFFFF,&H00000000,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,5,2,5,60,60,60,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* FFmpeg render                                                        */
/* ------------------------------------------------------------------ */

async function renderVideo({ audioPath, assPath, outputPath, duration }) {
  const totalDuration = duration + TRAIL_PADDING;
  const args = [
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=black:s=1080x1920:r=30:d=${totalDuration.toFixed(3)}`,
    '-i', audioPath,
    '-vf', `ass=${assPath}`,
    '-t', totalDuration.toFixed(3),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    outputPath,
  ];
  await runProcess(FFMPEG_BIN, args, { timeout: 300000 });
  return outputPath;
}

/* ------------------------------------------------------------------ */
/* Job processing                                                       */
/* ------------------------------------------------------------------ */

async function processJob(job) {
  updateJob(job.id, { status: 'processing' });
  const workDir = path.join(WORK_DIR, job.id);
  await fsp.mkdir(workDir, { recursive: true });

  try {
    let script = job.script;
    if (!script) {
      if (!GEMINI_API_KEY) {
        const e = new Error(
          'No script provided and Gemini is not configured (set GEMINI_API_KEY)'
        );
        e.code = 'gemini_not_configured';
        throw e;
      }
      script = await generateScript(job.idea, job.language);
      updateJob(job.id, { script });
    }

    script = script.trim();
    if (!script) {
      const e = new Error('Script is empty');
      e.code = 'empty_script';
      throw e;
    }

    const estimated = estimateDuration(script, job.language);
    updateJob(job.id, { estimatedDuration: Math.round(estimated * 10) / 10 });
    if (estimated > MAX_SCRIPT_SECONDS) {
      const e = new Error(
        `Estimated script duration (${estimated.toFixed(1)}s) exceeds the ${MAX_SCRIPT_SECONDS}s limit`
      );
      e.code = 'script_over_60_seconds';
      throw e;
    }

    const { audioPath, timings, duration, source } = await runTts(
      script,
      job.language,
      workDir
    );

    if (duration > MAX_SCRIPT_SECONDS + TRAIL_PADDING) {
      const e = new Error(
        `Audio duration (${duration.toFixed(1)}s) exceeds the ${MAX_SCRIPT_SECONDS}s limit`
      );
      e.code = 'script_over_60_seconds';
      throw e;
    }

    const assContent = makeAss(timings, job.language);
    const assPath = path.join(workDir, 'subs.ass');
    await fsp.writeFile(assPath, assContent, 'utf-8');

    const outputFile = `${job.id}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFile);
    await renderVideo({ audioPath, assPath, outputPath, duration });

    updateJob(job.id, {
      status: 'completed',
      outputFile,
      outputUrl: `/api/outputs/${outputFile}`,
      meta: {
        ttsSource: source,
        wordCount: timings.length,
        audioDuration: Math.round(duration * 100) / 100,
      },
    });
  } catch (err) {
    const code = err.code || 'render_failed';
    updateJob(job.id, {
      status: 'failed',
      error: err.message,
      errorCode: code,
    });
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
}

function enqueue(job) {
  jobQueue = jobQueue
    .then(() => processJob(job))
    .catch((err) => {
      updateJob(job.id, {
        status: 'failed',
        error: err.message,
        errorCode: err.code || 'internal_error',
      });
    });
  return job;
}

/* ------------------------------------------------------------------ */
/* Routes                                                               */
/* ------------------------------------------------------------------ */

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    app: 'shorts-video-mvp',
    jobCount: jobs.size,
    jobs: listJobs().reduce((acc, j) => {
      acc[j.status] = (acc[j.status] || 0) + 1;
      return acc;
    }, {}),
    geminiConfigured: Boolean(GEMINI_API_KEY),
    ffmpegAvailable: isToolAvailable('ffmpeg'),
  });
});

app.get('/api/jobs', (req, res) => {
  res.json({ jobs: listJobs().map(publicJob) });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'job_not_found' });
  res.json({ job: publicJob(job) });
});

app.post('/api/generate', (req, res) => {
  const { idea, script, language } = req.body || {};
  const lang = LANGUAGES.includes(language) ? language : 'en';

  if (!idea && !script) {
    return res
      .status(400)
      .json({ error: 'invalid_request', message: 'Provide "idea" and/or "script"' });
  }
  if (script && typeof script !== 'string') {
    return res
      .status(400)
      .json({ error: 'invalid_request', message: '"script" must be a string' });
  }
  if (idea && !script && !GEMINI_API_KEY) {
    return res.status(400).json({
      error: 'gemini_not_configured',
      message: 'No script provided and GEMINI_API_KEY is not set',
    });
  }

  const job = createJob({ idea, script, language: lang });
  enqueue(job);
  res.status(202).json({ job: publicJob(job) });
});

app.post('/api/generate-script', async (req, res) => {
  const { idea, language } = req.body || {};
  const lang = LANGUAGES.includes(language) ? language : 'en';
  if (!idea) {
    return res.status(400).json({ error: 'invalid_request', message: 'Provide "idea"' });
  }
  try {
    const script = await generateScript(idea, lang);
    res.json({ idea, script, language: lang });
  } catch (err) {
    res.status(500).json({ error: err.code || 'gemini_error', message: err.message });
  }
});

app.get('/api/outputs/:file', (req, res) => {
  const file = path.basename(req.params.file);
  if (file !== req.params.file || !/^[a-zA-Z0-9._-]+\.mp4$/.test(file)) {
    return res.status(400).json({ error: 'invalid_file' });
  }
  const full = path.join(OUTPUT_DIR, file);
  if (!fs.existsSync(full)) {
    return res.status(404).json({ error: 'file_not_found' });
  }
  res.setHeader('Content-Type', 'video/mp4');
  res.sendFile(full);
});

/* Static UI */
if (fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) {
  app.use(express.static(PUBLIC_DIR));
} else {
  app.get('/', (req, res) => {
    res.type('text/plain').send('shorts-video-mvp API is running');
  });
}

/* ------------------------------------------------------------------ */
/* Boot                                                                  */
/* ------------------------------------------------------------------ */

async function boot() {
  await fsp.mkdir(OUTPUT_DIR, { recursive: true });
  await fsp.mkdir(WORK_DIR, { recursive: true });

  if (!isToolAvailable(FFMPEG_BIN)) {
    console.warn('[boot] WARNING: ffmpeg not found — rendering will fail');
  }

  app.listen(PORT, HOST, () => {
    console.log(`[boot] shorts-video-mvp listening on http://${HOST}:${PORT}`);
    console.log(`[boot] gemini=${GEMINI_API_KEY ? 'configured' : 'NOT configured'}`);
    console.log(`[boot] model=${GEMINI_MODEL}`);
  });
}

boot().catch((err) => {
  console.error('[boot] failed to start:', err);
  process.exit(1);
});
