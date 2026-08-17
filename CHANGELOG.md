# Changelog

All notable changes are tracked here. The project follows phased development
merged into the `saas` branch; `main` is reserved for release tags.

## [Unreleased]

### Changed
- **Production hardening** — centralized error handling with JSON API errors
  and Arabic `404.html`/`500.html` pages; `helmet` security headers; optional
  gated `CORS_ORIGIN`; gzip compression; per-IP rate limit on
  `/api/generate/*` (`RATE_LIMIT_GENERATE_PER_MIN`); input validation for
  script generation and the PayPal webhook payload; startup env validation
  (required `PAYPAL_*`/`GEMINI_API_KEY` enforced in production).
- **CI/CD** — GitHub Actions runs syntax checks and the full smoke suite on
  every PR and push to `saas`/`main`; Dependabot keeps npm and
  GitHub Actions dependencies updated weekly.
- **PayPal sandbox onboarding** — subscription creation no longer binds to a
  `subscriber.email_address` (the cause of failed buyer approvals in sandbox);
  `scripts/setup-paypal.js` automates product/plan/webhook setup.
- **Post-approval UX** — the billing success page auto-redirects to
  `/projects` after a few seconds, so the activation webhook arrives before
  the dashboard loads; `GET /projects` serves the dashboard directly.

## [0.8.0] — Phase 7: PayPal subscription billing

- Premium tier with a monthly quota (`PREMIUM_MONTHLY_VIDEO_LIMIT`).
- `POST /api/billing/checkout` starts a PayPal subscription; `/cancel` stops
  it; the signature-verified webhook (`/api/billing/webhook`) is the source of
  truth for activate/renew/cancel/refund events (idempotent).
- Plan-aware quota checks and dashboard quota card with upgrade/cancel.
- `PAYPAL_MODE=sandbox|live|mock` (mock runs without an account, used by tests).
- Migration `004_billing.sql`: `users.plan`, `subscriptions`, `webhook_events`.

## [0.7.0] — Phase 6: Admin observability

- Structured JSON logging (`app/lib/logger.js`, secret-redacting).
- Admin-only endpoints (`/api/admin/overview`, `/api/admin/jobs`) gated by
  `ADMIN_EMAILS`.
- Richer `/api/health` (SQLite round-trip, disk, FFmpeg availability).
- Automatic SQLite online backups (boot + daily, keep N).

## [0.6.0] — Phase 5: Free-plan usage quota

- Monthly video allowance (`FREE_MONTHLY_VIDEO_LIMIT`, default 10) enforced
  before queueing; Arabic `429 quota_exceeded`.
- `GET /api/usage` reports consumed/remaining/reset; migration
  `003_usage_monthly.sql`.

## [0.5.0] — Phase 4: Storage lifecycle

- Per-user output folders (`data/output/<user_id>/`), hourly sweeper deletes
  outputs and orphan files older than `OUTPUT_RETENTION_DAYS`.
- API errors scrubbed of filesystem paths.

## [0.4.0] — Phase 3: Project dashboard

- `/projects` page: list, status badge, MP4/SRT/ASS downloads, delete.
- `DELETE /api/jobs/:id`; ownership isolation enforced.

## [0.3.0] — Phase 2: Persistent job queue

- Jobs persisted in SQLite; interrupted jobs recovered as `interrupted` on
  restart; per-job time limit (`JOB_TIMEOUT_MS`).

## [0.2.0] — Phase 1: Accounts & projects

- Register/login/logout with SQLite-backed session cookies
  (`app/db/session-store`), session rotation, rate-limited auth endpoints.
- Projects linked to users with ownership isolation.

## [0.1.0] — Initial release

- Arabic-only vertical (9:16) shorts generator: Gemini script writing, edge-tts
  neural Arabic voice-over, word-synced animated ASS captions (word-by-word and
  progressive), `.srt`/`.ass` downloads, 1080x1920 MP4 render via ffmpeg,
  Docker support.