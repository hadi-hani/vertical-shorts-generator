# API Reference

Base URL: `http://localhost:8283` (configurable via `PORT`/`HOST`).

All protected endpoints require a session cookie set by
`POST /api/auth/login` or `POST /api/auth/register`. Errors use a stable
machine-readable `error` code plus an Arabic `message`.

---

## Auth

### `POST /api/auth/register`

Create an account. Returns a session cookie.

```json
{ "email": "user@example.com", "password": "min-8-chars" }
```

`201 Created`

```json
{
  "user": { "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479", "email": "user@example.com", "plan": "free" }
}
```

Errors: `400 invalid_email`, `400 weak_password`, `409 email_taken`,
`429 too_many_requests`.

### `POST /api/auth/login`

```json
{ "email": "user@example.com", "password": "..." }
```

`200 OK` → `{ "user": { "id", "email", "plan" } }`
`401 invalid_credentials`, `429 too_many_requests`.

### `POST /api/auth/logout`

Destroys the session. → `200 { "ok": true }`

### `GET /api/auth/me`

Returns the signed-in user. `401 unauthorized` when logged out.

```json
{ "user": { "id": "...", "email": "user@example.com", "plan": "free" } }
```

---

## Generation

### `POST /api/generate/subtitles`

Creates a **Subtitles & Captions** job. Provide `idea` (auto-script via Gemini)
or `script`. Queue position returned; poll `GET /api/jobs/:id`.

```json
{
  "idea": "كيف تحضّر القهوة المثالية",
  "language": "ar",
  "captionStyle": "word",
  "timingMode": "auto",
  "wordsPerSegment": 4
}
```

| Field             | Values                                        | Default |
|-------------------|-----------------------------------------------|---------|
| `idea`            | string (one line)                             | —       |
| `script`          | string (≤ `MAX_SCRIPT_CHARS`, default 5000)   | —       |
| `language`        | `ar`                                          | `ar`    |
| `captionStyle`    | `word` \| `progressive`                       | `word`  |
| `timingMode`      | `auto` \| `words`                             | `auto`  |
| `wordsPerSegment` | 2–10 (used with `timingMode=words`)           | `4`     |

`202 Accepted` → `{ "job": { "id", "status": "queued", ... } }`

Errors: `400 invalid_request`, `400 gemini_not_configured`, `429 quota_exceeded`
(payload includes `usage`), `429 too_many_requests`.

### `POST /api/generate-script`

Generate only a script from an idea (no video job).

```json
{ "idea": "كيف تحضّر القهوة المثالية" }
```

`200` → `{ "idea": "...", "script": "...", "language": "ar" }`
`400 invalid_request`, `500 gemini_error`.

---

## Projects / jobs

### `GET /api/jobs`

List the signed-in user's projects (newest first).

```json
{ "jobs": [ { "id": "...", "status": "completed", "outputUrl": "/api/outputs/<id>.mp4", "subtitleSrtUrl": "/api/outputs/<id>.srt", "subtitleAssUrl": "/api/outputs/<id>.ass", "createdAt": "..." } ] }
```

### `GET /api/jobs/:id`

Poll a job. Statuses: `queued`, `processing`, `completed`, `failed`,
`interrupted`. Failed jobs include `error` and `errorCode`
(e.g. `job_timeout`, `tts_word_timings_missing`).

### `DELETE /api/jobs/:id`

Delete a project the current user owns (and its output files). `404 job_not_found`
if it does not exist or belongs to another user.

### `GET /api/outputs/:file`

Download `<id>.mp4`, `<id>.srt` or `<id>.ass`. `400 invalid_file`,
`404 file_not_found`.

### `GET /api/usage`

Current plan + monthly quota usage.

```json
{ "usage": { "plan": "free", "consumed": 3, "remaining": 7, "limit": 10, "resetsAt": "2026-09-01T00:00:00.000Z" } }
```

---

## Billing (PayPal)

### `POST /api/billing/checkout`

Starts a PayPal subscription for the signed-in user. Redirect the browser to
`approvalUrl`.

`200` → `{ "subscriptionId": "I-...", "approvalUrl": "https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=..." }`

Errors: `409 already_premium`, `503 paypal_not_configured`,
`502 checkout_failed`.

### `POST /api/billing/cancel`

Cancels the user's active subscription and returns them to the free plan.

`200` → `{ "plan": "free" }`
Errors: `400 no_active_subscription`, `502 cancel_failed`.

### `POST /api/billing/webhook`

PayPal webhook receiver. Signature-verified (`PAYPAL_WEBHOOK_ID`); idempotent
(duplicates return `{ "ok": true, "duplicate": true }`). Handles
`BILLING.SUBSCRIPTION.ACTIVATED/APPROVED`, `CANCELLED/EXPIRED/SUSPENDED`,
`PAYMENT.SALE.COMPLETED/REFUNDED/REVERSED`.

`200` → `{ "ok": true }`
`400 invalid_signature` / `missing_event_id` / `missing_event_type`.

### `GET /api/billing/success` · `GET /api/billing/cancel`

Arabic confirmation pages PayPal redirects buyers to after approval.

---

## Operations

### `GET /api/health`

```json
{
  "ok": true,
  "app": "shorts-video-mvp",
  "db": { "ok": true },
  "disk": { "freeBytes": 2710308864, "totalBytes": 0, "freePercent": 0 },
  "ffmpegAvailable": true,
  "gemini": true,
  "model": "gemini-2.5-flash"
}
```

### `GET /api/admin/overview` — admin only

Job counters (total / by status / completed, avg processing ms) and storage
bytes. Requires a session whose email is in `ADMIN_EMAILS`.

### `GET /api/admin/jobs` — admin only

Review jobs across all users. Query: `status`, `limit`, `offset`.

### `GET /projects` · `/`

Web UI: the project dashboard and the generator tool. Unknown paths return the
Arabic `404.html` page; unhandled server errors return `500.html` (JSON errors
under `/api/*`).

---

## Rate limits

- Auth (`register`/`login`): 20 / 15 min per IP.
- `/api/generate/*`: `RATE_LIMIT_GENERATE_PER_MIN` (default 10) per IP.

Both return `429 too_many_requests`.