# Changelog

All notable changes are tracked here. The project follows phased development
merged into the `saas` branch; `main` is reserved for release tags.

## [Unreleased]

### Added
- **Production-readiness** — concurrency/backlog limits (`MAX_JOBS_PER_USER`,
  `MAX_QUEUED_JOBS`, `MAX_PROJECTS_PER_USER`, Arabic 429 responses) guard
  against queue abuse and unbounded DB growth; `PAYMENT.SALE.DENIED` and
  `BILLING.SUBSCRIPTION.PAYMENT.FAILED` now downgrade the plan; stale/out-of-
  order PayPal webhooks (old subscription id) are ignored so late events can't
  resurrect a cancelled plan or clobber an active one.
- **Webhook decision layer** — `app/services/subscription-events.js` (pure,
  unit-tested) with tests for activate/approve/cancel/refund/payment-failed/
  stale/duplicate/mismatch cases.
- **Restore tooling** — `scripts/restore.js` (integrity-checked restore) and
  `docs/operations/backup-restore.md`.
- **Test suite** — `npm test` runs fast unit + HTTP integration tests
  (`test/webhook.test.js`, `test/backup.test.js`, `test/limits.test.js`,
  `test/webhook-http.test.js`) in addition to the E2E smoke suite; CI runs
  both.
- **`docs/launch-checklist.md`** — PASS/FAIL/BLOCKED launch checklist.
- **`docs/fast-beta-launch.md`** — سريع: نشر Beta على VPS عام (متغيرات
  production، أوامر Docker، Cloudflare A record + Caddy/Nginx، PayPal Sandbox
  webhook، اختبار الاشتراك/الإلغاء، اختبار backup restore، و جدول Go/No-Go).

### Changed
- Docker Compose mounts the whole `./data` volume (DB + outputs + backups),
  reads `env_file: .env`, adds `restart` policy and a healthcheck.
- `.env.example` documents the new limits; removed the unused `PEXELS_API_KEY`
  from the local `.env`.

### Fixed
- Subscription re-activation after cancel now works (a new PayPal sub id is
  allowed to replace an inactive one) while still ignoring stale retries.

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