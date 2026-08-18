# Launch Checklist

Status meanings:
- **PASS** — implemented and covered by automated tests (CI runs these).
- **FAIL** — known gap found in the production-readiness review.
- **BLOCKED** — requires a manual action by the owner (domain, PayPal Live,
  credentials) and cannot be validated by tests alone.
- **MANUAL** — implemented, but needs owner verification/configuration.

Last updated: production-readiness sprint (`feature/production-readiness`).
Tests: `npm test` (unit + integration) and `npm run smoke` (full E2E).

## 1. Core application

| Item | Status | How verified |
|------|--------|--------------|
| Auth: register / login / logout / me / session rotation | PASS | smoke + `test/` |
| Email verification + password reset tokens | PASS | `app/routes/auth.js`, `users.js` |
| Projects CRUD with per-user isolation | PASS | smoke |
| Jobs: queue, processing, render, download, retention sweep | PASS | smoke |
| Free / premium monthly quota | PASS | smoke (0/2 → 429 after limit) |
| Script generation (Gemini) | MANUAL | requires `GEMINI_API_KEY`; smoke uses canned script |
| File output download auth | PASS | smoke (anon → 401, other user → 404) |
| S3 offload (optional) | MANUAL | only active when `S3_*` set |

## 2. Limits & abuse protection

| Item | Status | How verified |
|------|--------|--------------|
| Body size cap (512 kb → 413) | PASS | express.json limit |
| `MAX_SCRIPT_CHARS` (400) | PASS | smoke |
| Script duration cap (~60 s) | PASS | server.js estimate + audio check |
| `JOB_TIMEOUT_MS` kill | PASS | server.js timer + SIGKILL |
| Per-user job cap (`MAX_JOBS_PER_USER`, 429) | PASS | `test/limits.test.js` |
| Global queue cap (`MAX_QUEUED_JOBS`, 429) | PASS | `test/limits.test.js` |
| Project count cap (`MAX_PROJECTS_PER_USER`, 429) | PASS | `test/limits.test.js` |
| Rate limits (auth 20/15m, generate 10/min/IP) | PASS | middleware |

## 3. Payments (PayPal)

| Item | Status | How verified |
|------|--------|--------------|
| Checkout (create subscription, approval URL) | PASS (mock) / MANUAL (sandbox) | smoke; live needs credentials |
| Webhook signature verification | PASS | `test/webhook-http.test.js` (invalid → 400) |
| Duplicate event idempotency | PASS | smoke |
| ACTIVATE / RE-ACTIVATED / RENEWED / SALE.COMPLETED | PASS | smoke + `test/webhook.test.js` |
| CANCEL / EXPIRED / SUSPENDED | PASS | smoke |
| REFUND / REVERSED → downgrade | PASS | smoke + unit |
| PAYMENT.FAILED / SALE.DENIED → downgrade | PASS | unit |
| Delayed / stale webhook (old sub) ignored | PASS | smoke + unit |
| Sub-id mismatch protection | PASS | unit |
| Billing plan transitions reflected in usage | PASS | smoke |
| **PayPal Live** credentials + plan | **BLOCKED** | owner must create Live REST app, plan, webhook |

## 4. Backup & recovery

| Item | Status | How verified |
|------|--------|--------------|
| Automatic backups on boot + interval | PASS | `services/backup.js` |
| Prune to `BACKUP_KEEP` | PASS | `test/backup.test.js` |
| Integrity of backups | PASS | `PRAGMA integrity_check` in test |
| Restore procedure | PASS | `scripts/restore.js` + `docs/operations/backup-restore.md` |
| Off-site backup copy | **BLOCKED** | owner must sync `data/backups` off-server |

## 5. Production configuration

| Item | Status | How verified |
|------|--------|--------------|
| `SESSIONS_SECRET` required in production | PASS | config throws if missing |
| Secrets in `.env` (gitignored), none committed | PASS | `.gitignore` + review |
| Cookie `Secure`/`SameSite=Lax` | MANUAL | `COOKIE_SECURE=1` behind HTTPS |
| Trust proxy for IP/rate-limit | MANUAL | `TRUST_PROXY=1` behind proxy |
| `NODE_ENV=production` validation (Gemini, PayPal) | PASS | config |
| Docker volume persistence (`./data:/app/data`) | PASS | compose fix |
| Docker healthcheck + `restart: unless-stopped` | PASS | compose |
| Reverse proxy (HTTPS termination) | **BLOCKED** | owner setup (Caddy/Nginx/Cloudflare) |
| Domain + DNS for `PUBLIC_BASE_URL`/`PAYPAL_BASE_URL` | **BLOCKED** | owner |
| Logging (JSON stdout + optional `LOG_DIR` rotation) | PASS | `lib/logger.js` |
| Metrics endpoint (`/api/metrics`, Prometheus) | PASS | smoke + code |
| Sentry DSN (optional) | MANUAL | `SENTRY_DSN` |
| Email provider (Resend/SendGrid) | **BLOCKED** | owner keys + verified `EMAIL_FROM` |
| Redis (optional cache) | MANUAL | `REDIS_URL` |

## 6. Engineering

| Item | Status | How verified |
|------|--------|--------------|
| CI: syntax check + unit/integration + smoke | PASS | `.github/workflows/ci.yml` |
| Dependabot (npm + Actions) | PASS | `.github/dependabot.yml` |
| API.md / CHANGELOG / SECURITY / CONTRIBUTING | PASS | docs/ |
| Sub-issues for remaining work (PG, Redis sessions, CDN…) | PASS | created from Issue #1 |

## What blocks Beta

1. Domain + HTTPS reverse proxy + `PUBLIC_BASE_URL`/`COOKIE_SECURE=1`/`TRUST_PROXY=1`.
2. `GEMINI_API_KEY` set in production.
3. Email provider keys (Resend/SendGrid) if you want verification/reset to
   actually deliver mail (otherwise those flows silently no-op).
4. Off-site backup of `data/backups`.

## What blocks Live payments

1. PayPal **Live** REST app (Client ID/Secret), billing plan (id), and webhook
   (id) — all created by the owner in the PayPal developer dashboard.
2. Changing `PAYPAL_MODE` from `sandbox` to `live` and pointing
   `PAYPAL_BASE_URL` at the real HTTPS domain.
3. Sanity-testing a real Live purchase before opening to users.
