# Security Policy

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Report privately
so we can fix it before it is disclosed:

- Open a **private vulnerability report** on GitHub
  (Repository → Security → Report a vulnerability), or
- Email the maintainers using the contact address listed in the repo profile.

Include:

- The affected endpoint/feature and the impact.
- A minimal reproduction (request/response, or steps).
- Your environment (Node version, deployment method).

We aim to acknowledge reports within 48 hours and ship a fix as soon as
possible, then credit the reporter (unless anonymity is requested).

## Supported versions

Security fixes are applied to the current `saas` branch and any tagged
release. Older tags are patched on request.

## Security posture

- Session cookies: `HttpOnly`, `SameSite=Lax`, optional `Secure`
  (`COOKIE_SECURE=1` over HTTPS), signed with `SESSIONS_SECRET` (required in
  production).
- Passwords hashed with scrypt; secrets never logged (logger redacts them).
- Auth endpoints rate-limited; `/api/generate/*` rate-limited per IP.
- PayPal webhooks signature-verified before any plan change.
- Output downloads validated (basename check, owner check, path traversal
  blocked).
- Responses never leak filesystem paths.

## Deployment checklist

- `NODE_ENV=production` with a strong `SESSIONS_SECRET`.
- `COOKIE_SECURE=1` and `TRUST_PROXY=1` when behind a TLS reverse proxy.
- Keep `CORS_ORIGIN` empty unless a separate frontend domain needs it.
- Use a real secret manager for `PAYPAL_*` in live mode; never commit `.env`.