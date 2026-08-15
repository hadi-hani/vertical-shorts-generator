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
/* Timing: word-level timestamps are aligned to the script text by matching
 *   normalized word keys (never by array index), then smoothed into short,
 *   regular-looking windows. When too few words match, each sentence is
 *   split evenly across its own span instead. */
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
/* Segmentation + word timing alignment                                */
/* ------------------------------------------------------------------ */

// A word stays visible for at most this long in Word-by-Word mode so the
// caption never lingers through a pause, and at least this long so quick
// words do not flash by.
const MAX_WORD_WINDOW = 0.8;
const MIN_WORD_WINDOW = 0.12;

/** Canonical key for matching script tokens against TTS word timings. */
function timingKey(raw) {
  return String(raw || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/[\p{P}\p{S}]+/gu, '')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * Align TTS word timings to the script tokens by matching normalized word
 * keys in order (like associateEmojis does for emoji groups). Tolerates
 * punctuation/contraction differences and extra/missing timing words.
 * Returns `{ words, matched }` where `words` is an array aligned 1:1 with
 * `tokens` (missing entries interpolated) and `matched` is the count of
 * tokens that had a real timing. Returns null when nothing matched.
 */
function alignTimings(timings, tokens) {
  if (!Array.isArray(timings) || !timings.length) return null;
  const words = tokens.map((text) => ({ text, start: 0, end: 0, _matched: false }));
  let j = 0;
  let matched = 0;
  for (let i = 0; i < tokens.length; i++) {
    const key = timingKey(tokens[i]);
    if (!key) continue;
    let found = -1;
    for (let s = j; s < timings.length; s++) {
      if (timingKey(timings[s].word) === key) {
        found = s;
        break;
      }
    }
    if (found === -1) continue;
    const t = timings[found];
    const start = Math.max(0, typeof t.start === 'number' ? t.start : 0);
    const end =
      typeof t.end === 'number' ? Math.max(t.end, start) : start + 0.3;
    words[i] = { text: tokens[i], start, end, _matched: true };
    j = found + 1;
    matched++;
  }
  if (!matched) return null;

  // Interpolate tokens that had no timing between their nearest matched
  // neighbours so every word still gets a window.
  const matchedIdx = words.map((w, i) => (w._matched ? i : -1)).filter((i) => i >= 0);
  for (let i = 0; i < words.length; i++) {
    if (words[i]._matched) continue;
    const prevIdx = matchedIdx.filter((x) => x < i).pop();
    const nextIdx = matchedIdx.find((x) => x > i);
    if (prevIdx !== undefined && nextIdx !== undefined) {
      const a = words[prevIdx].start;
      const b = words[nextIdx].start;
      const gap = (b - a) / (nextIdx - prevIdx);
      words[i].start = a + gap * (i - prevIdx);
      words[i].end = words[i].start + gap;
    } else if (prevIdx !== undefined) {
      words[i].start = words[prevIdx].end;
      words[i].end = words[i].start + 0.3;
    } else if (nextIdx !== undefined) {
      words[i].end = words[nextIdx].start - 0.3 * (nextIdx - i - 1);
      words[i].start = Math.max(0, words[i].end - 0.3);
    } else {
      words[i].start = 0;
      words[i].end = 0.3;
    }
  }

  // Enforce monotonic, non-overlapping starts.
  let prev = -Infinity;
  for (const w of words) {
    if (w.start < prev) w.start = prev;
    if (w.end < w.start) w.end = w.start;
    prev = w.start;
  }
  return { words, matched };
}

/** Even-split each sentence across its own proportional span. */
function evenSplitBySentence(tokens, duration) {
  const sents = splitSentences(tokens.join(' '));
  const counts = sents.map((s) => tokenizeWords(s).length).filter((c) => c > 0);
  const total = counts.reduce((a, b) => a + b, 0);

  const words = [];
  let t0 = 0;
  let k = 0;
  for (const wc of counts) {
    const t1 = k + wc >= tokens.length ? duration : t0 + (duration * wc) / total;
    const step = wc ? (t1 - t0) / wc : 0;
    for (let j = 0; j < wc && k < tokens.length; j++, k++) {
      words.push({ text: tokens[k], start: t0 + j * step, end: t0 + (j + 1) * step });
    }
    t0 = t1;
  }
  while (k < tokens.length) {
    words.push({ text: tokens[k], start: t0, end: t0 + 0.3 });
    t0 += 0.3;
    k++;
  }
  return words;
}

/**
 * Build per-word entries `{ text, start, end }`. Uses the TTS word timings
 * aligned to the script text when at least 70% of words matched; otherwise
 * falls back to an even split per sentence across the audio duration (or a
 * words-per-second estimate).
 */
function buildWordList(timings, tokens, opts) {
  const n = tokens.length;
  if (!n) return [];
  const aligned = alignTimings(timings, tokens);
  if (aligned && aligned.matched / n >= 0.7) return aligned.words;
  const duration =
    opts.duration > 0 ? opts.duration : n / (opts.wordsPerSecond || 2.6);
  return evenSplitBySentence(tokens, duration);
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
    const nextStart = i + 1 < words.length ? words[i + 1].start : seg.end;
    // Start exactly when the word is spoken; hold it for a smoothed window
    // (capped so it never lingers through a pause, floored so it never
    // flashes) instead of staying up for the full raw gap.
    const clamped = Math.min(nextStart, start + MAX_WORD_WINDOW);
    const end = Math.max(clamped, Math.min(nextStart, start + MIN_WORD_WINDOW));
    const size = fontsizeFor(w.text);
    const pop = '\\t(0,110,\\fscx100\\fscy100)';
    const text =
      leadingTags(y, size, `\\fscx75\\fscy75\\fad(40,40)${pop}`) + w.text;
    out.push(eventLine(start, end, text));
  }
  return out;
}

/** Style 2 — Highlighted Sentence: full line, active word tinted only. */
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
    const fade = k === 0 ? '\\fad(60,0)' : k === n - 1 ? '\\fad(0,60)' : '';
    // Color-only highlight: changing \1c never reflows the line, so the
    // active word is tinted without the whole sentence shifting (the RTL
    // Arabic layout-shift bug). No \fscx / \t scale is allowed here.
    const joined = tokens
      .map((t, j) =>
        j === k ? `{\\1c${accent}}${t}` : `{\\1c${ASS_DIM}}${t}`
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
    const fadeIn = k === 0 ? '\\fad(60,0)' : '\\fad(40,40)';
    const fadeOut = k === n - 1 ? '\\fad(40,120)' : '';
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
