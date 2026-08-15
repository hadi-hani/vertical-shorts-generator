'use strict';

/* ------------------------------------------------------------------ */
/* Caption engine: segmentation + ASS/SRT builders                     */
/*                                                                     */
/* The three caption styles:                                           */
/*   word        — Word by Word: each word appears alone, pops and     */
/*                 fades, quickly, one after another.                  */
/*   sentence    — Highlighted Sentence: the whole sentence stays      */
/*                 visible while the active word is tinted + popped,   */
/*                 moving word to word in sync with the audio.         */
/*   progressive — Progressive Word Delivery: words accumulate until   */
/*                 the sentence is complete, then it rolls over.       */
/*                                                                     */
/* Timing: word-level millisecond timestamps when available, otherwise */
/*   a fixed "N words per caption" fallback.                            */
/* ------------------------------------------------------------------ */

const ASS_ACCENT = { en: '&H62C8FF&', ar: '&H47F7F0&' };
const ASS_DIM = '&H6A6A6A&';
const ASS_WHITE = '&HFFFFFF&';

/* ------------------------------------------------------------------ */
/* Time / text helpers                                                 */
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

function toSrtTime(sec) {
  const v = Math.max(0, sec);
  const h = Math.floor(v / 3600);
  const m = Math.floor(v / 60) % 60;
  const s = Math.floor(v) % 60;
  const ms = Math.round((v - Math.floor(v)) * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)},${String(ms).padStart(3, '0')}`;
}

function cleanWord(raw) {
  return String(raw || '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '')
    .trim();
}

/** Split text on whitespace, keeping punctuation attached to tokens. */
function tokenizeWords(text) {
  return String(text || '').split(/\s+/).filter(Boolean);
}

function splitSentences(text) {
  const out = [];
  const re = /[^.!?؟…]*[.!?؟…]+/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    out.push(text.slice(last, re.lastIndex).trim());
    last = re.lastIndex;
  }
  if (last < text.length) {
    const rest = text.slice(last).trim();
    if (rest) out.push(rest);
  }
  return out.filter(Boolean);
}

/** Single-word font size (used by the Word-by-Word style). */
function fontsizeFor(text) {
  const len = Array.from(text).length;
  const size = Math.round(1900 / Math.max(1, len));
  return Math.max(48, Math.min(96, size));
}

/** Sentence font size — scales with the full line length. */
function sentenceSize(tokens) {
  const len = Array.from(tokens.join(' ')).length;
  const size = Math.round(1700 / Math.max(1, len));
  return Math.max(40, Math.min(84, size));
}

/** Wrap word tokens into display lines (ASS hard breaks). */
function splitLines(words, maxChars = 26) {
  const lines = [];
  let cur = '';
  for (const w of words) {
    const piece = cur ? `${cur} ${w}` : w;
    if (cur && Array.from(piece).length > maxChars) {
      lines.push(cur);
      cur = w;
    } else {
      cur = piece;
    }
  }
  if (cur) lines.push(cur);
  return lines.join('\\N');
}

/* ------------------------------------------------------------------ */
/* Segmentation                                                        */
/* ------------------------------------------------------------------ */

/**
 * Build per-word entries `{ text, start, end }`.
 * Uses millisecond word-level timestamps when the TTS engine provided
 * enough of them; otherwise falls back to an even split across the
 * audio duration (or a words-per-second estimate).
 */
function buildWordList(timings, tokens, opts) {
  const n = tokens.length;
  const hasTimings =
    Array.isArray(timings) &&
    timings.length >= n &&
    timings.every((t) => t && typeof t.start === 'number');

  if (hasTimings) {
    return Array.from({ length: n }, (_, i) => ({
      text: tokens[i],
      start: Math.max(0, timings[i].start),
      end: timings[i].end != null ? timings[i].end : timings[i].start + 0.3,
    }));
  }

  const duration =
    opts.duration || n / (opts.wordsPerSecond || 2.6);
  const step = duration / n;
  return tokens.map((t, i) => ({
    text: t,
    start: i * step,
    end: (i + 1) * step,
  }));
}

function sentenceChunks(words, text) {
  const counts = splitSentences(text).map((s) => tokenizeWords(s).length);
  const chunks = [];
  let k = 0;
  for (const sc of counts) {
    const slice = words.slice(k, k + sc);
    if (slice.length) {
      chunks.push(slice);
      k += sc;
    }
  }
  if (k < words.length) chunks.push(words.slice(k));
  return chunks.filter((c) => c.length);
}

function chunkByCount(words, n) {
  const chunks = [];
  for (let i = 0; i < words.length; i += n) chunks.push(words.slice(i, i + n));
  return chunks.filter((c) => c.length);
}

/**
 * Segment the script into caption display units.
 *   timingMode 'auto'  — group by sentence using ms word timestamps.
 *   timingMode 'words' — fixed `wordsPerSegment` words per caption.
 * Returns `[{ words: [{text,start,end}...], start, end }]`.
 */
function segmentCaptions(timings, text, opts = {}) {
  const tokens = tokenizeWords(text);
  if (!tokens.length) return [];
  const words = buildWordList(timings, tokens, opts);
  const mode = opts.timingMode === 'words' ? 'words' : 'auto';
  const chunks =
    mode === 'words'
      ? chunkByCount(words, Math.max(1, opts.wordsPerSegment || 4))
      : sentenceChunks(words, text);
  return chunks.map((c) => ({
    words: c,
    start: c[0].start,
    end: c[c.length - 1].end,
  }));
}

/* ------------------------------------------------------------------ */
/* ASS event builders (one per style)                                  */
/* ------------------------------------------------------------------ */

function eventLine(start, end, text) {
  return `Dialogue: 0,${toAssTime(start)},${toAssTime(end)},Karaoke,,0,0,0,,${text}`;
}

function leadingTags(y, size, extra) {
  return `{\\pos(540,${y})\\an5\\fs${size}${extra || ''}}`;
}

/** Style 1 — Word by Word: each word alone, fast pop + fade. */
function wordByWordEvents(seg, y) {
  const out = [];
  const words = seg.words;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const start = w.start;
    const end = i + 1 < words.length ? words[i + 1].start : seg.end;
    const size = fontsizeFor(w.text);
    const pop = '\\t(0,110,\\fscx100\\fscy100)';
    const text =
      leadingTags(y, size, `\\fscx75\\fscy75\\fad(50,50)${pop}`) + w.text;
    out.push(eventLine(start, end, text));
  }
  return out;
}

/** Style 2 — Highlighted Sentence: full line, active word tinted+popped. */
function highlightSentenceEvents(seg, language, y) {
  const words = seg.words;
  const n = words.length;
  if (!n) return [];
  const tokens = words.map((w) => w.text);
  const size = sentenceSize(tokens);
  const accent = ASS_ACCENT[language] || ASS_ACCENT.en;
  const out = [];
  for (let k = 0; k < n; k++) {
    const start = words[k].start;
    const end = k + 1 < n ? words[k + 1].start : seg.end;
    const fade = k === 0 ? '\\fad(140,0)' : k === n - 1 ? '\\fad(0,140)' : '';
    const joined = tokens
      .map((t, j) =>
        j === k
          ? `{\\1c${accent}\\fscx115\\fscy115\\t(0,90,\\fscx100\\fscy100)}${t}`
          : `{\\1c${ASS_DIM}\\fscx100\\fscy100}${t}`
      )
      .join(' ');
    out.push(eventLine(start, end, leadingTags(y, size, fade) + joined));
  }
  return out;
}

/** Style 3 — Progressive Word Delivery: words accumulate in the line. */
function progressiveEvents(seg, y) {
  const words = seg.words;
  const n = words.length;
  if (!n) return [];
  const tokens = words.map((w) => w.text);
  const size = sentenceSize(tokens);
  const out = [];
  for (let k = 0; k < n; k++) {
    const start = words[k].start;
    const end = k + 1 < n ? words[k + 1].start : seg.end;
    const shown = tokens.slice(0, k + 1);
    const fadeIn = k === 0 ? '\\fad(140,0)' : '\\fad(70,70)';
    const fadeOut = k === n - 1 ? '\\fad(70,140)' : '';
    out.push(
      eventLine(start, end, leadingTags(y, size, `${fadeIn}${fadeOut}`) + splitLines(shown))
    );
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Public builders                                                     */
/* ------------------------------------------------------------------ */

function buildAss(segments, language, options = {}) {
  const style = options.style || 'word';
  const y = options.y != null ? options.y : 900;
  const font = options.font || 'DejaVu Sans';
  const events = [];
  for (const seg of segments) {
    const built =
      style === 'sentence'
        ? highlightSentenceEvents(seg, language, y)
        : style === 'progressive'
          ? progressiveEvents(seg, y)
          : wordByWordEvents(seg, y);
    events.push(...built);
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

/** Clean, player-friendly .srt — one block per caption segment. */
function buildSrt(segments) {
  return segments
    .map((seg, i) => {
      const text = seg.words.map((w) => w.text).join(' ');
      return (
        `${i + 1}\n${toSrtTime(seg.start)} --> ${toSrtTime(seg.end)}\n${text}\n`
      );
    })
    .join('\n');
}

module.exports = {
  segmentCaptions,
  buildAss,
  buildSrt,
  splitSentences,
  tokenizeWords,
  cleanWord,
  toAssTime,
  fontsizeFor,
};
