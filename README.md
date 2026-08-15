# Vertical Shorts Video Generator (MVP)

AI-powered **vertical (9:16) short-form video generator** with neural text-to-speech
and animated, word-by-word subtitles — built for TikTok / YouTube Shorts / Reels.

Give it a one-line idea (or a full script), and it produces a ready-to-post
`1080x1920` MP4 with a voice-over and kinetic captions that appear word by word.

## Features

- **Script generation** — auto-writes an engaging 25–35s voice-over script from a
  one-line idea using Google Gemini (or pass your own script directly).
- **Two video styles**:
  - **Emoji captions** — captions centered on a dark gradient with color emojis
    baked into the script (Gemini suggests them automatically; emojis are
    auto-inserted when the script lacks them).
  - **Footage background** — captions near the bottom over real b-roll, with three
    background options: **videos**, **photos** (both via the Pexels API), or
    **animated icons** (via Iconify).
- **Multi-scene footage** — long scripts are split into scenes (one per sentence)
  and each scene gets its own footage clip/photo/icon; scenes crossfade into each
  other. Icons are auto-picked per scene from the text (keyword map + Iconify
  search), including Arabic.
- **Neural TTS** — high-quality voice-over via Microsoft Edge neural voices
  (`edge-tts`), with English and Arabic out of the box.
- **Animated word-by-word captions** — every word pops and fades in sync with the
  audio, rendered as ASS subtitles (RTL Arabic supported).
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

### `GET /api/jobs/:id`

Poll for completion.

```sh
curl http://localhost:8283/api/jobs/34d29fa4-...
```

When `status` is `completed`, the job contains `outputUrl` (e.g. `/api/outputs/<id>.mp4`).

### `GET /api/outputs/:file`

Download the rendered video.

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
│   ├── server.js            # Express API, pipeline orchestration, ASS builder
│   ├── tts_word_timings.py  # edge-tts audio + word-boundary timing extraction
│   └── align_words.py       # whisper-based alignment fallback
├── public/                  # Web UI
├── data/
│   ├── output/              # Rendered MP4s (git-ignored)
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
