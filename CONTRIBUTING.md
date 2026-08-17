# Contributing

Thanks for helping improve the Arabic Shorts Generator.

## Branch policy

- `main` is a **red line** — never push to it directly. It only receives
  versioned release tags.
- `saas` is the integration branch where all work lands.
- Every change is developed on `feature/<name>` branched from `saas` and merged
  back with `--no-ff` after review.

```
saas ────●──────────────────●───────  (integration)
         \                /
          feature/x       feature/y
```

## Development workflow

1. Branch from the latest `saas`:

   ```sh
   git checkout saas && git pull
   git checkout -b feature/your-change
   ```

2. Make your changes. Never touch `app/captions.js` or
   `public/js/tools/subtitles.js` without explicit agreement — they are the
   caption engine's red line.

3. Add or update a smoke check in `scripts/smoke-auth.js` when your change
   affects an API path or a user flow.

4. Run the full suite locally before pushing:

   ```sh
   npm run smoke
   ```

   The suite boots the app on a temp DB/port and runs 70+ checks (auth, quota,
   billing webhook, file downloads). CI runs the same suite.

5. Commit with a concise message that names the change, then merge to `saas`:

   ```sh
   git checkout saas
   git merge --no-ff feature/your-change -m "Merge feature/your-change into saas"
   git push origin saas
   ```

## Testing

- `npm run smoke` — end-to-end API suite (requires `ffmpeg` + `edge-tts`
  via `pip install edge-tts`).
- GitHub Actions runs it automatically on every PR.

## Code style

- Plain Node.js (no transpilers), CommonJS `require`.
- Structured logging via `app/lib/logger.js` — never log passwords, tokens, or
  full request bodies.
- API responses use Arabic error messages with stable `error` codes.

## Issues

- File issues on GitHub. Reference the affected endpoint or page and the
  expected vs actual behavior.
- Keep the [changelog](CHANGELOG.md) updated for user-visible changes.