'use strict';

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const express = require('express');
const sharp = require('sharp');

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
  if (staticFfmpeg && fs.existsSync(staticFfmpeg)) FFMPEG_BIN = staticFfmpeg;
} catch (_) { /* ffmpeg-static not installed */ }

const PEXELS_API_KEY = process.env.PEXELS_API_KEY || '';
const PEXELS_VIDEO_SEARCH = 'https://api.pexels.com/videos/search';
const PEXELS_PHOTO_SEARCH = 'https://api.pexels.com/v1/search';
const ICONIFY_API = 'https://api.iconify.design';

const STYLE_EMOJI = 'emoji';
const STYLE_FOOTAGE = 'footage';
const BG_TYPES = { video: 'video', image: 'image', icon: 'icon' };
const CAPTION_Y = { center: 900, bottom: 1620 };
const EMOJI_SIZE = 96;
const EMOJI_SPACING = 110;
const EMOJI_LIFT = 130;

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

function createJob({ idea, script, language, style = STYLE_FOOTAGE, backgroundType = null, query = null }) {
  const id = crypto.randomUUID();
  const job = {
    id,
    status: 'queued',
    idea: idea || null,
    script: script || null,
    language,
    style,
    backgroundType,
    query: query || null,
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
    style: job.style,
    backgroundType: job.backgroundType,
    query: job.query,
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
/* Network helpers                                                      */
/* ------------------------------------------------------------------ */

async function fetchJson(url, headers = {}) {
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  } catch (err) {
    const e = new Error(`Network request failed: ${err.message}`);
    e.code = 'network_error';
    throw e;
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = new Error(data && data.error ? data.error : `HTTP ${res.status}`);
    e.code = 'http_error';
    throw e;
  }
  return data;
}

async function fetchText(url, headers = {}) {
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  } catch (err) {
    const e = new Error(`Network request failed: ${err.message}`);
    e.code = 'network_error';
    throw e;
  }
  if (!res.ok) {
    const e = new Error(`HTTP ${res.status}`);
    e.code = 'http_error';
    throw e;
  }
  return res.text();
}

async function downloadFile(url, destPath, timeoutMs = 120000) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const e = new Error(`Download failed: ${err.message}`);
    e.code = 'download_error';
    throw e;
  }
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  await fsp.writeFile(destPath, Buffer.from(await res.arrayBuffer()));
  return destPath;
}

/* ------------------------------------------------------------------ */
/* Emoji + text helpers                                                 */
/* ------------------------------------------------------------------ */

const EMOJI_GROUP_RE = /(?:\p{Extended_Pictographic}\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*|[\u{1F1E6}-\u{1F1FF}]{2})/u;
const EMOJI_GROUP_GLOBAL = new RegExp(EMOJI_GROUP_RE.source, 'gu');
const SCRIPT_WORD_RE = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/u;
const SCRIPT_TOKEN_RE = new RegExp(`${EMOJI_GROUP_RE.source}|${SCRIPT_WORD_RE.source}`, 'gu');

function stripEmojis(text) {
  return text.replace(EMOJI_GROUP_GLOBAL, '');
}

function splitScriptTokens(text) {
  const tokens = [];
  for (const m of text.matchAll(SCRIPT_TOKEN_RE)) {
    const value = m[0];
    tokens.push({ type: EMOJI_GROUP_RE.test(value) ? 'emoji' : 'word', value });
  }
  return tokens;
}

/**
 * Associate emojis found between script words with the word that follows them
 * (falling back to the nearest timing word). Returns an array aligned with
 * `timings`, where each entry is a list of emoji strings.
 */
function associateEmojis(script, timings) {
  const groups = Array.from({ length: timings.length }, () => []);
  const tokens = splitScriptTokens(script);
  let t = 0;
  const pending = [];
  for (let i = 0; i < timings.length; i++) {
    const timingWord = cleanWord(timings[i].word).toLowerCase();
    while (t < tokens.length && tokens[t].type === 'emoji') {
      pending.push(tokens[t].value);
      t++;
    }
    let matched = false;
    while (t < tokens.length) {
      const tok = tokens[t];
      if (tok.type === 'emoji') {
        pending.push(tok.value);
        t++;
        continue;
      }
      const norm = tok.value.toLowerCase();
      if (
        norm === timingWord ||
        norm.startsWith(timingWord) ||
        timingWord.startsWith(norm)
      ) {
        groups[i] = pending.splice(0);
        t++;
        matched = true;
        break;
      }
      t++;
    }
    if (!matched) groups[i] = pending.splice(0);
  }
  for (let i = t; i < tokens.length; i++) {
    if (tokens[i].type === 'emoji') pending.push(tokens[i].value);
  }
  if (pending.length && groups.length) groups[groups.length - 1].push(...pending);
  return groups;
}

const EMOJI_CACHE_DIR = path.join(DATA_DIR, 'emoji_cache');
const NOTO_EMOJI_CDN =
  'https://raw.githubusercontent.com/googlefonts/noto-emoji/main/png/128/';

function emojiToFileName(emoji) {
  const cp = Array.from(emoji)
    .map((ch) => ch.codePointAt(0).toString(16).padStart(4, '0'))
    .join('_');
  return `emoji_u${cp}.png`;
}

async function fetchEmojiPng(emoji) {
  await fsp.mkdir(EMOJI_CACHE_DIR, { recursive: true });
  const base = emojiToFileName(emoji);
  const cached = path.join(EMOJI_CACHE_DIR, base);
  if (fs.existsSync(cached)) return cached;
  const candidates = [base];
  if (base.includes('_fe0f')) candidates.push(base.replace('_fe0f', ''));
  for (const name of candidates) {
    try {
      await downloadFile(`${NOTO_EMOJI_CDN}${name}`, cached, 30000);
      return cached;
    } catch (_) { /* try the next candidate */ }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Background fetching (Pexels / Iconify)                               */
/* ------------------------------------------------------------------ */

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'to', 'for', 'and', 'or', 'in', 'on', 'at',
  'how', 'what', 'why', 'when', 'is', 'are', 'was', 'were', 'be', 'been',
  'it', 'its', 'you', 'your', 'my', 'me', 'with', 'from', 'this', 'that',
  'we', 'our', 'they', 'them', 'their', 'have', 'has', 'had', 'do', 'does',
  'did', 'not', 'so', 'if', 'but', 'can', 'will', 'would', 'should',
]);

function deriveQuery(idea, script) {
  const source = (idea || script || '').toLowerCase();
  const words = source.match(/[\p{L}]+/gu) || [];
  const keywords = words.filter((w) => w.length > 3 && !STOP_WORDS.has(w));
  return keywords.slice(0, 3).join(' ');
}

async function pexelsPickVideo(query, workDir) {
  const data = await fetchJson(
    `${PEXELS_VIDEO_SEARCH}?query=${encodeURIComponent(query)}&orientation=portrait&per_page=5&size=medium`,
    { Authorization: PEXELS_API_KEY }
  );
  const videos = (data && data.videos) || [];
  const video = videos.find((v) =>
    (v.video_files || []).some(
      (f) =>
        f.file_type === 'video/mp4' &&
        (f.width || 0) > 0 &&
        (f.height || 0) > 0 &&
        f.width < f.height
    )
  ) || videos[0];
  if (!video) {
    const e = new Error('Pexels returned no videos for the query');
    e.code = 'pexels_error';
    throw e;
  }
  const files = (video.video_files || []).filter(
    (f) => f.file_type === 'video/mp4' && f.width < f.height
  ).sort((a, b) => (b.width || 0) - (a.width || 0));
  const chosen = files.find((f) => (f.width || 0) >= 640) || files[files.length - 1];
  if (!chosen || !chosen.link) {
    const e = new Error('Pexels video has no usable mp4 file');
    e.code = 'pexels_error';
    throw e;
  }
  const dest = path.join(workDir, 'bg.mp4');
  await downloadFile(chosen.link, dest);
  return { file: dest, type: BG_TYPES.video, source: 'pexels-video', url: chosen.link };
}

async function pexelsPickPhoto(query, workDir) {
  const data = await fetchJson(
    `${PEXELS_PHOTO_SEARCH}?query=${encodeURIComponent(query)}&orientation=portrait&per_page=3`,
    { Authorization: PEXELS_API_KEY }
  );
  const photo = (data && data.photos && data.photos[0]) || null;
  if (!photo) {
    const e = new Error('Pexels returned no photos for the query');
    e.code = 'pexels_error';
    throw e;
  }
  const url = photo.src && (photo.src.large2x || photo.src.original);
  if (!url) {
    const e = new Error('Pexels photo has no downloadable source');
    e.code = 'pexels_error';
    throw e;
  }
  const dest = path.join(workDir, 'bg.jpg');
  await downloadFile(url, dest);
  return { file: dest, type: BG_TYPES.image, source: 'pexels-image', url };
}

const ICON_KEYWORDS = {
  cook: 'mdi:chef-hat', food: 'mdi:chef-hat', recipe: 'mdi:chef-hat', bake: 'mdi:chef-hat',
  coffee: 'mdi:coffee', drink: 'mdi:cup-water', fruit: 'mdi:fruit-watermelon',
  tech: 'mdi:robot', ai: 'mdi:robot', code: 'mdi:code-tags', program: 'mdi:code-tags',
  computer: 'mdi:laptop', phone: 'mdi:cellphone', internet: 'mdi:wifi',
  fitness: 'mdi:weight-lifter', workout: 'mdi:weight-lifter', gym: 'mdi:weight-lifter',
  run: 'mdi:run', sport: 'mdi:soccer',
  money: 'mdi:currency-usd', finance: 'mdi:finance', business: 'mdi:briefcase',
  invest: 'mdi:chart-line', crypto: 'mdi:bitcoin',
  travel: 'mdi:airplane', trip: 'mdi:airplane', vacation: 'mdi:beach',
  nature: 'mdi:tree', plant: 'mdi:flower', animal: 'mdi:paw', cat: 'mdi:cat', dog: 'mdi:dog',
  music: 'mdi:music-note', movie: 'mdi:movie', film: 'mdi:clapperboard',
  book: 'mdi:book-open', learn: 'mdi:school', study: 'mdi:school',
  car: 'mdi:car', drive: 'mdi:car', engine: 'mdi:engine',
  star: 'mdi:star', heart: 'mdi:heart', idea: 'mdi:lightbulb-on',
};

function pickIcon(query) {
  const q = (query || '').toLowerCase();
  for (const [key, icon] of Object.entries(ICON_KEYWORDS)) {
    if (q.includes(key)) return icon;
  }
  return 'mdi:clapperboard';
}

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

async function createIconBackground(query, workDir) {
  const icon = pickIcon(query);
  const bgPath = path.join(workDir, 'bg.png');
  const svgUrl = `${ICONIFY_API}/${icon}.svg?color=%23ffffff&width=720&height=720`;
  const svg = await fetchText(svgUrl);
  const fadedSvg = svg.replace('<svg', '<svg style="opacity:0.20"', 1);
  const iconBuffer = await sharp(Buffer.from(fadedSvg))
    .resize(900, 900, { fit: 'inside' })
    .png()
    .toBuffer();
  const gradientBuffer = await sharp(Buffer.from(gradientSvg(1080, 1920)))
    .png()
    .toBuffer();
  const finalBuffer = await sharp(gradientBuffer)
    .composite([{ input: iconBuffer, gravity: 'centre' }])
    .png()
    .toBuffer();
  await fsp.writeFile(bgPath, finalBuffer);
  return { file: bgPath, type: BG_TYPES.image, source: 'iconify', icon };
}

async function fetchBackground({ backgroundType, query, workDir }) {
  const q = (query || '').trim();
  if (backgroundType === BG_TYPES.video || backgroundType === BG_TYPES.image) {
    if (!PEXELS_API_KEY) {
      const e = new Error(
        'Footage backgrounds (video/image) require PEXELS_API_KEY'
      );
      e.code = 'pexels_not_configured';
      throw e;
    }
    return backgroundType === BG_TYPES.video
      ? pexelsPickVideo(q, workDir)
      : pexelsPickPhoto(q, workDir);
  }
  return createIconBackground(q, workDir);
}

/* ------------------------------------------------------------------ */
/* Gemini script generation                                             */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT = (language, withEmojis = false) => {
  const langName = language === 'ar' ? 'Arabic' : 'English';
  let prompt =
    `You are a short-form vertical video voice-over scriptwriter. ` +
    `Write a concise, engaging voice-over script in ${langName} based on the user's one-line idea. ` +
    `The script should take roughly 25-35 seconds to speak. ` +
    `Use short, punchy sentences suitable for TikTok/Shorts. ` +
    `Do not include stage directions, timestamps, markdown, or quotation marks around the whole script. ` +
    `If the idea is in ${langName === 'Arabic' ? 'Arabic' : 'English'} keep the script in that language. ` +
    `Return only the script text.`;
  if (withEmojis) {
    prompt += ` Sprinkle 3-5 relevant emojis directly into the script text to make it playful and engaging.`;
  }
  return prompt;
};

async function generateScript(idea, language, withEmojis = false) {
  if (!GEMINI_API_KEY) {
    const err = new Error('Gemini is not configured (set GEMINI_API_KEY)');
    err.code = 'gemini_not_configured';
    throw err;
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const body = {
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT(language, withEmojis) }],
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
function makeAss(timings, language, options = {}) {
  const { y = CAPTION_Y.bottom } = options;
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
    const text = `{\\pos(540,${y})\\an5\\fs${size}\\fscx80\\fscy80\\fad(${fade},${fade})${pop}${accent}}${word}`;
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

async function renderVideo({
  audioPath,
  assPath,
  outputPath,
  duration,
  background,
  emojiOverlays = [],
}) {
  const totalDuration = duration + TRAIL_PADDING;
  const total = totalDuration.toFixed(3);

  const inputs = ['-y'];
  let bgChain;

  if (background.type === BG_TYPES.video) {
    inputs.push('-stream_loop', '-1', '-i', background.file);
    bgChain = '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,'
      + 'crop=1080:1920,fps=30,ass=' + assPath;
  } else {
    inputs.push('-loop', '1', '-framerate', '30', '-i', background.file);
    bgChain = '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,'
      + 'crop=1080:1920,fps=30,'
      + "zoompan=z='min(zoom+0.0015,1.15)':d=1:s=1080x1920:fps=30,"
      + 'ass=' + assPath;
  }
  inputs.push('-i', audioPath);
  for (const em of emojiOverlays) {
    inputs.push('-loop', '1', '-framerate', '30', '-i', em.file);
  }

  const parts = [];
  parts.push(bgChain + '[base]');
  let cur = '[base]';
  for (let k = 0; k < emojiOverlays.length; k++) {
    const em = emojiOverlays[k];
    const outLabel = `[v${k}]`;
    parts.push(
      `${cur}[${2 + k}:v]overlay=x=${em.x}:y=${em.y}:` +
      `enable='between(t,${em.start.toFixed(3)},${em.end.toFixed(3)})'${outLabel}`
    );
    cur = outLabel;
  }

  const args = [
    ...inputs,
    '-filter_complex', parts.join(';'),
    '-map', cur,
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
      script = await generateScript(
        job.idea,
        job.language,
        job.style === STYLE_EMOJI
      );
      updateJob(job.id, { script });
    }

    const style = job.style === STYLE_EMOJI ? STYLE_EMOJI : STYLE_FOOTAGE;

    // TTS always runs on the emoji-free text so word timings stay clean.
    const cleanScript = stripEmojis(script).replace(/\s+/g, ' ').trim();
    if (!cleanScript) {
      const e = new Error('Script has no speakable text');
      e.code = 'empty_script';
      throw e;
    }

    const estimated = estimateDuration(cleanScript, job.language);
    updateJob(job.id, { estimatedDuration: Math.round(estimated * 10) / 10 });
    if (estimated > MAX_SCRIPT_SECONDS) {
      const e = new Error(
        `Estimated script duration (${estimated.toFixed(1)}s) exceeds the ${MAX_SCRIPT_SECONDS}s limit`
      );
      e.code = 'script_over_60_seconds';
      throw e;
    }

    const { audioPath, timings, duration, source } = await runTts(
      cleanScript,
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

    const emojiGroups =
      style === STYLE_EMOJI ? associateEmojis(script, timings) : [];

    let background;
    if (style === STYLE_FOOTAGE) {
      const query =
        (job.query && job.query.trim()) ||
        deriveQuery(job.idea, cleanScript);
      const bgType = job.backgroundType || BG_TYPES.video;
      background = await fetchBackground({
        backgroundType: bgType,
        query,
        workDir,
      });
    } else {
      const bgPath = path.join(workDir, 'bg.png');
      await fsp.writeFile(
        bgPath,
        await sharp(Buffer.from(gradientSvg(1080, 1920))).png().toBuffer()
      );
      background = { file: bgPath, type: 'solid', source: 'gradient' };
    }

    const assContent =
      style === STYLE_EMOJI
        ? makeAss(timings, job.language, { y: CAPTION_Y.center })
        : makeAss(timings, job.language, { y: CAPTION_Y.bottom });
    const assPath = path.join(workDir, 'subs.ass');
    await fsp.writeFile(assPath, assContent, 'utf-8');

    const emojiOverlays = [];
    if (style === STYLE_EMOJI) {
      for (let i = 0; i < emojiGroups.length; i++) {
        const group = emojiGroups[i];
        if (!group.length) continue;
        const n = group.length;
        const wordEnd =
          i + 1 < timings.length
            ? Math.max(timings[i].end, timings[i + 1].start)
            : timings[i].end + 0.35;
        for (let k = 0; k < n; k++) {
          const emojiPath = await fetchEmojiPng(group[k]);
          if (!emojiPath) continue;
          const x = Math.round(
            540 + (k - (n - 1) / 2) * EMOJI_SPACING - EMOJI_SIZE / 2
          );
          const y = CAPTION_Y.center - EMOJI_LIFT - EMOJI_SIZE / 2;
          emojiOverlays.push({
            file: emojiPath,
            x,
            y,
            start: Math.max(0, timings[i].start - 0.08),
            end: wordEnd + 0.15,
          });
        }
      }
    }

    const outputFile = `${job.id}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFile);
    await renderVideo({
      audioPath,
      assPath,
      outputPath,
      duration,
      background,
      emojiOverlays,
    });

    updateJob(job.id, {
      status: 'completed',
      outputFile,
      outputUrl: `/api/outputs/${outputFile}`,
      meta: {
        style,
        backgroundType: background.type,
        footageSource: background.source || null,
        footageUrl: background.url || null,
        icon: background.icon || null,
        emojiCount: emojiOverlays.length,
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
    pexelsConfigured: Boolean(PEXELS_API_KEY),
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

function validateGenerateBody(req, res) {
  const { idea, script, language } = req.body || {};
  const lang = LANGUAGES.includes(language) ? language : 'en';
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
  if (idea && !script && !GEMINI_API_KEY) {
    res.status(400).json({
      error: 'gemini_not_configured',
      message: 'No script provided and GEMINI_API_KEY is not set',
    });
    return null;
  }
  return { idea, script, language: lang };
}

app.post('/api/generate/emoji', (req, res) => {
  const v = validateGenerateBody(req, res);
  if (!v) return;
  const job = createJob({
    idea: v.idea,
    script: v.script,
    language: v.language,
    style: STYLE_EMOJI,
  });
  enqueue(job);
  res.status(202).json({ job: publicJob(job) });
});

app.post('/api/generate/footage', (req, res) => {
  const v = validateGenerateBody(req, res);
  if (!v) return;
  const { background, query } = req.body || {};
  const bgType = BG_TYPES[background] || BG_TYPES.video;
  const job = createJob({
    idea: v.idea,
    script: v.script,
    language: v.language,
    style: STYLE_FOOTAGE,
    backgroundType: bgType,
    query: typeof query === 'string' && query.trim() ? query.trim() : null,
  });
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
