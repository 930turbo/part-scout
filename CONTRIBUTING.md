# Contributing

Use Node 24. Install with `npm ci`, then run `npm run dev`. The server uses SQLite and serves `public/` directly.

Before proposing a change, run `npm run check`, `npm test`, and `npm run build`. For UI changes, run `npm run test:browser` after installing Chromium with `npx playwright install chromium`. Add fixtures for provider layout changes; do not make CI depend on live inventory or Discord credentials.

Keep provider requests bounded and spaced. Changes to inventory ingestion must preserve transaction rollback, per-monitor price tracking, and the rule that incomplete snapshots never age unseen listings. Keep secrets out of logs, browser payloads, fixtures, and screenshots.
