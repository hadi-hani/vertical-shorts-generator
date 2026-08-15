# Vertical Shorts Video Generator (MVP)

AI-powered **vertical (9:16) short-form video generator** with neural text-to-speech
and animated, word-by-word subtitles — built for TikTok / YouTube Shorts / Reels.

Give it a one-line idea (or a full script), and it produces a ready-to-post
`1080x1920` MP4 with a voice-over and kinetic captions that appear in sync with
the speech. The web UI is split into two tools:

- **Subtitles & Captions** — three animated caption styles with downloadable
  `.srt` / `.ass` files (active now).
- **Video & Footage Builder** — footage backgrounds with crossfading scenes
  (coming soon; the API is already available).

## Features

- **Script generation** — auto-writes an engaging 25–35s voice-over script from a
  one-line idea using Google Gemini (or pass your own script directly).
- **Three caption styles**:
  - **Word by Word** — each word appears alone with a quick pop and fade, in sync
    with the voice-over.
  - **Highlighted Sentence** — the full sentence stays visible while the spoken
    word is highlighted and enlarged as it moves through the line.
  - **Progressive Word Delivery** — words accumulate line by line until the
    sentence is complete, then roll over.
- **Two timing modes** — automatic **word-level timestamps** from the TTS engine,
  or a **fixed words-per-caption** fallback (2–12 words) when timestamps are
  missing or when you want even-sized caption lines.
- **Emoji accents (optional)** — color emojis baked into the script (Gemini
  suggests them automatically; emojis are auto-inserted when the script lacks
  them) and rendered beside the words they follow.
- **Subtitle file downloads** — every job also produces a style-independent
  `.srt` and the styled `.ass`, served via `/api/outputs/:file`.
- **Footage API** — captions near the bottom over real b-roll, with three
  background options: **videos**, **photos** (both via the Pexels API), or
  **animated icons** (via Iconify).
- **Multi-scene footage** — long scripts are split into scenes (one per sentence)
  and each scene gets its own footage clip/photo/icon; scenes crossfade into each
  other. Icons are auto-picked per scene from the text (keyword map + Iconify
  search), including Arabic.
- **Neural TTS** — high-quality voice-over via Microsoft Edge neural voices
  (`edge-tts`), with English and Arabic out of the box.
- **Animated captions** — rendered as ASS subtitles burned into the video (RTL
  Arabic supported).
- **Smart word timing** — precise timestamps from the TTS engine; falls back to
  whisper-based alignment if edge-tts is unavailable.
- **Runs anywhere** — plain Node.js or a single-command Docker container.

## How it works

```
idea ──► [Gemini] ──► script ──► [edge-tts] ──► audio.mp3 + word timings
                                                            │
script ──────────────────────────────────────────────────────┘
                                                             ▼
                                      [ASS generator] ──► subs.ass
                                                             ▼
                                              [ffmpeg] ──► 1080x1920 .mp4
```

## Requirements

| Tool      | Version / Notes                                                  |
|-----------|------------------------------------------------------------------|
| Node.js   | `>= 22`                                                          |
| Python 3  | `>= 3.9`                                                         |
| ffmpeg    | With `libass` for the `ass` filter (see [Troubleshooting](#troubleshooting)) |
| Network   | Needed for Gemini, edge-tts, and font loading                    |

Python dependencies are installed automatically by the Docker image:

```sh
pip install edge-tts
```

## Quickstart

### Option A — Docker (recommended)

```sh
export GEMINI_API_KEY=your_key_here
docker compose up --build
```

Open <http://localhost:8283>.

### Option B — Local

```sh
# 1. Install dependencies
npm install
pip install edge-tts

# 2. Configure (optional)
cp .env.example .env
#   edit .env and add your GEMINI_API_KEY

# 3. Run
npm start
```

Open <http://localhost:8283>.

## Configuration

All settings are read from the environment (or a `.env` file next to the project
root, which is loaded automatically and git-ignored).

| Variable         | Default                 | Description                                             |
|------------------|-------------------------|---------------------------------------------------------|
| `GEMINI_API_KEY` | *(empty)*               | Gemini key — required only for script auto-generation. If empty, you must supply a `script` to the API. |
| `GEMINI_MODEL`   | `gemini-2.5-flash`      | Gemini model for script writing.                       |
| `PEXELS_API_KEY` | *(empty)*               | Pexels key — required for the **video** and **image** footage backgrounds. Icon backgrounds work without it. |
| `PORT`           | `8283`                  | HTTP port.                                              |
| `HOST`           | `0.0.0.0`               | Bind address.                                           |

### Languages, voices & fonts

Languages are defined in `app/server.js`:

- English — voice `en-US-AriaNeural`, font `DejaVu Sans`
- Arabic — voice `ar-SA-HamedNeural`, font `Noto Naskh Arabic`

Add a new language by extending the `VOICES` and `FONTS` maps.

## API

### `POST /api/generate` *(deprecated)*

Legacy endpoint — same behavior as `/api/generate/emoji`.

### `POST /api/generate/emoji`

Create a **emoji captions** job: captions centered on a dark gradient, with color
emojis rendered beside the words they follow. Provide **either** an `idea` (Gemini
writes the script) **or** a `script`. If the resulting script has no emojis, they
are added automatically (Gemini first, keyword-based fallback).

```sh
curl -X POST http://localhost:8283/api/generate/emoji \
  -H "Content-Type: application/json" \
  -d '{"script":"Hello world! This is my first generated short. 🚀","language":"en"}'
```

### `POST /api/generate/footage`

Create a **footage background** job: captions near the bottom over b-roll. Choose
the background via `background`:

- `"video"` — looping Pexels video clip
- `"image"` — Pexels photo (Ken Burns zoom)
- `"icon"` — animated Iconify icon (no Pexels key needed)

`query` is optional — when omitted it is auto-derived from the idea/script.

```sh
curl -X POST http://localhost:8283/api/generate/footage \
  -H "Content-Type: application/json" \
  -d '{"script":"Cooking eggs for breakfast is quick and fun.","language":"en","background":"icon","query":"cooking"}'
```

Video/image backgrounds require `PEXELS_API_KEY`; without it the job fails with
`pexels_not_configured`.

When a script has multiple sentences, the footage is split into **scenes** (one per
sentence, up to 6) and each scene gets its own clip/photo/icon, joined by
crossfades. `meta.sceneCount` and `meta.scenes[]` (`text`, `query`, `source`,
`icon`, `url`) describe the split.

### `POST /api/generate/subtitles`

Create a **Subtitles & Captions** job: captions centered on a dark gradient, with
your choice of caption style and timing. Provide **either** an `idea` (Gemini
writes the script) **or** a `script`.

Body:

| Field             | Values                                                       | Default |
|-------------------|--------------------------------------------------------------|---------|
| `idea`            | one-line idea (script auto-generated)                        | —       |
| `script`          | full script text                                             | —       |
| `language`        | `en` or `ar`                                                 | `en`    |
| `captionStyle`    | `word` \| `sentence` \| `progressive`                        | `word`  |
| `timingMode`      | `auto` (ms word timestamps) \| `words` (fixed words/line)    | `auto`  |
| `wordsPerSegment` | 2–12 (used when `timingMode` is `words`)                     | `4`     |
| `emojis`          | `true`/`false` — add emoji accents                           | `true`  |

```sh
curl -X POST http://localhost:8283/api/generate/subtitles \
  -H "Content-Type: application/json" \
  -d '{"idea":"How to brew great coffee","language":"en","captionStyle":"sentence","timingMode":"auto","emojis":true}'
```

### `GET /api/jobs/:id`

Poll for completion.

```sh
curl http://localhost:8283/api/jobs/34d29fa4-...
```

When `status` is `completed`, the job contains `outputUrl`
(`/api/outputs/<id>.mp4`) plus `subtitleSrtUrl` and `subtitleAssUrl`
(`/api/outputs/<id>.srt` / `.ass`) for the downloadable subtitle files.
`meta.captionStyle`, `meta.timingMode` and `meta.wordsPerSegment` describe what
was rendered.

### `GET /api/outputs/:file`

Download the rendered video or a subtitle file (`<id>.mp4`, `<id>.srt`,
`<id>.ass`).

```sh
curl -O http://localhost:8283/api/outputs/34d29fa4-....mp4
```

### Other endpoints

| Endpoint              | Method | Description                                  |
|-----------------------|--------|----------------------------------------------|
| `/api/health`         | GET    | Health + feature flags (gemini/pexels/ffmpeg). |
| `/api/jobs`           | GET    | List all jobs.                               |
| `/api/generate-script`| POST   | Generate a script only (`{"idea": "..."}`).  |

## Project structure

```
.
├── app/
│   ├── server.js            # Express API + pipeline orchestration
│   ├── captions.js          # Caption engine: segmentation, 3 ASS styles, .srt
│   ├── tts_word_timings.py  # edge-tts audio + word-boundary timing extraction
│   └── align_words.py       # whisper-based alignment fallback
├── public/                  # Web UI
│   ├── index.html           # Tab shell (Subtitles & Captions / Footage Builder)
│   └── js/
│       ├── app.js           # Shared helpers: tabs, fetch, job polling
│       └── tools/           # One module per tool (subtitles.js, footage.js)
├── data/
│   ├── output/              # Rendered MP4s + .srt/.ass (git-ignored)
│   ├── work/                # Per-job scratch space (git-ignored)
│   └── emoji_cache/         # Cached emoji PNGs (git-ignored)
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## Troubleshooting

**`[AVFilterGraph] No such filter: 'ass'` or "No option name near ..."**

Your ffmpeg build lacks `libass`. Install one that includes it, or let the app use
a bundled static build:

```sh
npm install ffmpeg-static
```

`ffmpeg-static` ships a full static ffmpeg (with `libass`, `libx264`, `aac`);
`app/server.js` detects it automatically and uses it instead of the system binary.

**"Gemini is not configured"**

Script auto-generation needs a key. Either set `GEMINI_API_KEY` or provide a
`script` directly in the API request.

**Audio works but no captions / fonts look wrong**

Make sure `libass`-capable ffmpeg and the fonts in `FONTS` (`fonts-noto-core`,
`fonts-dejavu-core`) are installed.

## License

[MIT](LICENSE)
