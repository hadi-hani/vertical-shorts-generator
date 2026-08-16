# Arabic Subtitles & Captions Generator

Arabic-only **vertical (9:16) short-form video generator** with neural Arabic
text-to-speech and animated, word-by-word subtitles — built for TikTok /
YouTube Shorts / Reels.

Give it a one-line idea (or a full script), and it produces a ready-to-post
`1080x1920` MP4 with an Arabic voice-over and animated captions that appear in
sync with the speech. The web UI is a single tool:

- **Subtitles & Captions** — two animated caption styles with downloadable
  `.srt` / `.ass` files.

## Features

- **Script generation** — auto-writes an engaging 25–35s Arabic voice-over
  script from a one-line idea using Google Gemini (or pass your own script
  directly).
- **Two caption styles**:
  - **Word by Word** — each word appears alone with a quick pop and fade, in
    sync with the voice-over.
  - **Progressive Word Delivery** — words accumulate line by line until the
    sentence is complete, then roll over.
- **Two timing modes** — automatic **word-level timestamps** from the TTS
  engine, or a **fixed words-per-caption** fallback (2–10 words) when
  timestamps are missing or when you want even-sized caption lines.
- **Subtitle file downloads** — every job also produces a style-independent
  `.srt` and the styled `.ass`, served via `/api/outputs/:file`.
- **Neural TTS** — high-quality Arabic voice-over via Microsoft Edge neural
  voices (`edge-tts`).
- **Animated captions** — rendered as ASS subtitles burned into the video (RTL
  Arabic supported).
- **Smart word timing** — precise timestamps from the TTS engine; falls back to
  whisper-based alignment if edge-tts is unavailable.
- **Runs anywhere** — plain Node.js or a single-command Docker container.
- **User accounts** — register/login with session cookies (SQLite-backed) and a
  simple Arabic RTL auth page. Generation, job listing and file downloads
  require an authenticated session.

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
| `PORT`           | `8283`                  | HTTP port.                                              |
| `HOST`           | `0.0.0.0`               | Bind address.                                           |
| `SESSIONS_SECRET`| *(random per boot)*     | Session cookie signing secret — the app refuses to start in production (`NODE_ENV=production`) without it. |
| `DB_PATH`        | `./data/app.db`         | SQLite database file.                                   |
| `COOKIE_SECURE`  | `0`                     | Set to `1` when serving over HTTPS.                     |
| `TRUST_PROXY`    | `0`                     | Set to the number of reverse-proxy hops (e.g. `1`) behind Nginx/Cloudflare. |

The Arabic voice and font are defined in `app/server.js`:

- Voice — `ar-SA-HamedNeural`
- Font — `Noto Naskh Arabic`

## API

### `POST /api/generate/subtitles`

Create a **Subtitles & Captions** job: captions centered on a dark gradient,
with your choice of caption style and timing. Provide **either** an `idea`
(Gemini writes the script) **or** a `script`. Language is Arabic only.

> **Auth:** this endpoint (and job listing, output downloads, and script
> generation) requires an authenticated session. Register first via
> `POST /api/auth/register`, or use the auth page at `/auth.html`.

Body:

| Field             | Values                                                       | Default |
|-------------------|--------------------------------------------------------------|---------|
| `idea`            | one-line idea (script auto-generated)                        | —       |
| `script`          | full script text                                             | —       |
| `language`        | `ar`                                                         | `ar`    |
| `captionStyle`    | `word` \| `progressive`                                      | `word`  |
| `timingMode`      | `auto` (ms word timestamps) \| `words` (fixed words/line)    | `auto`  |
| `wordsPerSegment` | 2–10 (used when `timingMode` is `words`)                     | `4`     |

```sh
curl -X POST http://localhost:8283/api/generate/subtitles \
  -H "Content-Type: application/json" \
  -d '{"idea":"كيف تحضّر القهوة المثالية","language":"ar","captionStyle":"word","timingMode":"auto"}'
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
| `/api/health`         | GET    | Health + feature flags (gemini/ffmpeg).      |
| `/api/auth/register`  | POST   | Create an account (`{"email","password"}`).  |
| `/api/auth/login`     | POST   | Log in — sets a session cookie.              |
| `/api/auth/logout`    | POST   | End the session.                             |
| `/api/auth/me`        | GET    | Current user (401 when logged out).          |
| `/api/jobs`           | GET    | List the current user's projects (auth required). |
| `/api/generate-script`| POST   | Generate a script only (`{"idea": "..."}`).  |

## Project structure

```
.
├── app/
│   ├── server.js            # Express API + pipeline orchestration
│   ├── config.js            # Env/config loading (.env)
│   ├── captions.js          # Caption engine: segmentation, 2 ASS styles, .srt
│   ├── tts_word_timings.py  # edge-tts audio + word-boundary timing extraction
│   ├── align_words.py       # whisper-based alignment fallback
│   ├── db/                  # SQLite connection, migrations, repositories
│   ├── routes/              # auth.js + API routes
│   ├── services/            # auth.js (scrypt hashing)
│   └── middleware/          # auth.js (requireAuth)
├── public/                  # Web UI
│   ├── index.html           # Single-page Arabic captions UI (tool)
│   ├── auth.html            # Arabic RTL login/register page
│   └── js/
│       ├── app.js           # Shared helpers: fetch, auth bar, job polling
│       ├── auth.js          # Auth page logic
│       └── tools/subtitles.js  # Captions tool
├── data/
│   ├── app.db               # SQLite (users/sessions) — git-ignored
│   ├── output/              # Rendered MP4s + .srt/.ass (git-ignored)
│   └── work/                # Per-job scratch space (git-ignored)
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## Troubleshooting

**`[AVFilterGraph] No such filter: 'ass'` or "No option name near ..."**

Your ffmpeg build lacks `libass`. Install one that includes it, or let the app
use a bundled static build:

```sh
npm install ffmpeg-static
```

`ffmpeg-static` ships a full static ffmpeg (with `libass`, `libx264`, `aac`);
`app/server.js` detects it automatically and uses it instead of the system
binary.

**"Gemini is not configured"**

Script auto-generation needs a key. Either set `GEMINI_API_KEY` or provide a
`script` directly in the API request.

**Audio works but no captions / fonts look wrong**

Make sure `libass`-capable ffmpeg and the Arabic font in `FONTS`
(`fonts-noto-core`) are installed.

## License

[MIT](LICENSE)