# Arabic Subtitles & Captions Generator

[![CI](https://github.com/hadi-hani/vertical-shorts-generator/actions/workflows/ci.yml/badge.svg)](https://github.com/hadi-hani/vertical-shorts-generator/actions/workflows/ci.yml)

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
- **Persistent jobs** — projects live in SQLite, so completed videos and their
  outputs survive server restarts; any job interrupted by a restart is marked
  `interrupted`, and each job has an overall time limit that kills a hung
  TTS/ffmpeg step (`JOB_TIMEOUT_MS`).
- **Project dashboard** — a `/projects` page lists your projects (idea/script
  snippet, status badge, MP4/SRT/ASS downloads, delete) with an Arabic empty
  state; only your own projects are visible.
- **Storage lifecycle** — outputs are stored in a per-user folder under
  `data/output/<user_id>/`, temp work dirs are always wiped, and completed
  projects (plus orphaned files) older than `OUTPUT_RETENTION_DAYS` (default 7)
  are cleaned automatically. API errors are scrubbed of filesystem paths.
- **Free-plan quota** — the monthly allowance (`FREE_MONTHLY_VIDEO_LIMIT`,
  default 10 videos) is checked before a job is queued; over-quota submissions
  get a clear Arabic `429 quota_exceeded` message. The dashboard shows how much
  is consumed, what remains, and when it resets (`GET /api/usage`).
- **Paid plan (PayPal subscriptions)** — a premium tier with a higher monthly
  quota (`PREMIUM_MONTHLY_VIDEO_LIMIT`). Users upgrade from the dashboard;
  PayPal **webhooks** are the source of truth for activation, renewal,
  cancellation and refunds (signature-verified, idempotent), and the plan is
  reflected in `/api/usage` and the quota check. Works in `sandbox`/`live`
  against PayPal, or `mock` mode for tests without an account.
- **Admin observability** — structured JSON logs per job/user (no passwords or
  secrets), protected internal admin endpoints (`ADMIN_EMAILS`) to review
  failed jobs and the queue plus job/success/duration/storage counters, a
  richer `/api/health` (SQLite + disk + FFmpeg), and automatic SQLite online
  backups (daily, keep N).
- **Production hardening** — `helmet` security headers, gzip compression,
  optional gated CORS, per-IP rate limits on generation, centralized error
  handling (JSON API errors + Arabic 404/500 pages), and startup environment
  validation that refuses to boot in production with missing required keys.

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
| `JOB_TIMEOUT_MS` | `600000`                | Overall per-job time limit (ms); a job that exceeds it is killed and marked `failed` with `errorCode=job_timeout`. |
| `OUTPUT_RETENTION_DAYS` | `7`           | Outputs (and orphan files) older than this many days are deleted by the hourly sweeper. |
| `MAX_SCRIPT_CHARS` | `5000`                | Reject scripts longer than this. |
| `FREE_MONTHLY_VIDEO_LIMIT` | `10`           | Free-plan monthly video quota. Submissions beyond it return `429 quota_exceeded` with an Arabic message until the period resets. |
| `PREMIUM_MONTHLY_VIDEO_LIMIT` | `200`      | Premium-plan monthly video quota. |
| `PAYPAL_MODE` | `sandbox`           | `sandbox` \| `live` \| `mock` (mock skips PayPal for tests). |
| `PAYPAL_CLIENT_ID` | *(empty)*   | PayPal REST app client id (sandbox/live). |
| `PAYPAL_CLIENT_SECRET` | *(empty)* | PayPal REST app secret (sandbox/live). |
| `PAYPAL_PLAN_ID` | *(empty)*    | PayPal billing plan id used for subscriptions. |
| `PAYPAL_WEBHOOK_ID` | *(empty)*  | PayPal webhook signature id (for webhook verification). |
| `PAYPAL_BASE_URL` | *(empty)*    | Public base URL PayPal redirects buyers to after approval (e.g. `https://app.example.com`); falls back to `http://localhost:PORT`. |
| `PAYPAL_PRICE` | `9.99` | Price shown on the checkout page (informational only; the authoritative amount lives in the PayPal plan). |
| `ADMIN_EMAILS` | *(empty)* | Comma-separated emails allowed to call the internal `/api/admin/*` endpoints (job review, queue, overview counters). Empty = no admin access. |
| `RATE_LIMIT_GENERATE_PER_MIN` | `10` | Per-IP rate limit for `/api/generate/*`. |
| `CORS_ORIGIN` | *(empty)* | Allowed browser origin for cross-domain clients. Empty = same-origin only (locked down). |
| `BACKUP_DIR`   | `./data/backups` | Where SQLite online backups are written. |
| `BACKUP_KEEP`  | `5`           | Number of backups to keep (older ones are pruned). |
| `BACKUP_INTERVAL_MS` | `86400000` | Backup interval (ms). A backup also runs at boot. |

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

Poll for completion. Job statuses: `queued`, `processing`, `completed`,
`failed`, or `interrupted` (left over from a server restart). A failed job
includes `error` and `errorCode` (e.g. `job_timeout`, `tts_word_timings_missing`).

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
| `/api/jobs/:id`       | DELETE | Delete a project the current user owns (auth required). |
| `/api/usage`          | GET    | Current free-plan quota: consumed, remaining, reset date (auth required). |
| `/api/generate-script`| POST   | Generate a script only (`{"idea": "..."}`).  |
| `/api/admin/overview` | GET    | Internal: job counters (total/by-status/completed, total & avg processing ms) + storage bytes. Requires a session whose email is in `ADMIN_EMAILS`. |
| `/api/admin/jobs`     | GET    | Internal: review jobs across all users, filterable by `status`, `limit`, `offset`. Same admin requirement. |
| `/api/billing/checkout` | POST | Start a PayPal subscription for the signed-in user; returns `{ subscriptionId, approvalUrl }` to redirect to. `409` when already premium, `503` when not configured. |
| `/api/billing/cancel` | POST   | Cancel the user's active subscription and return to the free plan. |
| `/api/billing/webhook` | POST  | PayPal webhook receiver (signature-verified, idempotent) — activation/renewal/cancel/refund events update the user's plan. |
| `/api/billing/success` \| `/api/billing/cancel` | GET | Arabic confirmation pages PayPal redirects buyers to. |

`/api/health` also reports `db.ok` (SQLite round-trip), `disk` (free/total bytes
and free percent), and `ffmpegAvailable`.

## Testing

```sh
npm run smoke
```

Boots the app on a temp DB/port and runs 70+ end-to-end checks: auth, quota,
billing webhooks, generation and file downloads. Requires `ffmpeg` and
`edge-tts` (`pip install edge-tts`). The same suite runs in CI on every PR
and push to `saas`/`main`.

## Project structure

```
.
├── .github/workflows/ci.yml   # CI: syntax checks + smoke suite on every PR
├── app/
│   ├── server.js            # Express API + pipeline orchestration
│   ├── config.js            # Env/config loading (.env) + startup validation
│   ├── captions.js          # Caption engine: segmentation, 2 ASS styles, .srt
│   ├── tts_word_timings.py  # edge-tts audio + word-boundary timing extraction
│   ├── align_words.py       # whisper-based alignment fallback
│   ├── db/                  # SQLite connection, migrations, repositories
│   ├── routes/              # auth.js + billing.js API routes
│   ├── services/            # auth.js (scrypt), paypal.js, backup.js
│   ├── middleware/          # auth.js (requireAuth), admin.js, rate-limit.js
│   └── lib/                 # logger.js, http-error.js, validate.js
├── public/                  # Web UI
│   ├── index.html           # Single-page Arabic captions UI (tool)
│   ├── auth.html            # Arabic RTL login/register page
│   ├── projects.html        # Project dashboard
│   ├── 404.html / 500.html  # Arabic error pages
│   └── js/
│       ├── app.js           # Shared helpers: fetch, auth bar, job polling
│       ├── auth.js          # Auth page logic
│       ├── projects.js      # Dashboard logic
│       └── tools/subtitles.js  # Captions tool
├── data/
│   ├── app.db               # SQLite (users/sessions) — git-ignored
│   ├── output/              # Rendered MP4s + .srt/.ass (git-ignored)
│   └── work/                # Per-job scratch space (git-ignored)
├── docs/                    # Phase-by-phase design notes
├── scripts/                 # smoke-auth.js (tests), setup-paypal.js
├── Dockerfile
├── docker-compose.yml
└── package.json
```

See also [API.md](API.md) (full endpoint reference), [CONTRIBUTING.md](CONTRIBUTING.md),
and [CHANGELOG.md](CHANGELOG.md).

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