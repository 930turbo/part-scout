# Architecture

The server, scheduler, and notification worker run in one Node process. The browser is a small native JavaScript application with no client build pipeline. The optional Discord gateway process talks to the server over HTTP. A single-tenant workspace is deliberate: a bot user authorized in the configured guild can control the same workspace as its administrator.

```mermaid
flowchart LR
    UI[Browser dashboard] --> API[Authenticated HTTP API]
    Bot[Discord commands] --> API
    API --> Service[Scan and import service]
    Clock[Scheduler] --> Service
    Service --> Provider[Authorized feed / Car-Part adapter]
    Service --> DB[(SQLite WAL)]
    Files[JSON / saved HTML] --> API
    DB --> Outbox[Durable alert worker]
    Outbox --> Discord[Discord webhook]
```

## Storage and identity

`monitors` stores validated search configuration and persisted schedule state. `listings` stores the current listing, first/last observation, bookmark, and note. `matches` links each listing to each monitor with eligibility, its last observed price, and a missed-snapshot count. `prices` stores price changes; `runs` and `jobs` record operational history. Foreign keys and cascading deletes keep associations consistent. Settings live in `meta`.

A SHA-256 identity covers normalized recycler name, city, state, stock number, vehicle year/model, and part type. This avoids the original stock-plus-dealer collision when one vehicle has several parts. Prices and descriptions do not affect identity. A recycler changing its name or location produces a new identity; there is no reliable provider-wide listing ID in the HTML adapter.

Each import/scan runs in one transaction: upsert listings, record price changes, update monitor associations, enqueue unique alerts, and persist scan state. A failure rolls everything back. Prepared statements are cached; indexed matches, jobs, dates, and price history support bounded reads. The UI paginates at 30 records. Inventory export collects all matching records and is intended for personal-scale workspaces.

## Scheduling and lifecycle

Only one scan runs at once. Provider requests share a global spacing budget rather than a delay per vehicle. Every network request has a deadline; response bodies are bounded. A failure records its reason and schedules a retry with exponential backoff capped at one day. Disabled and file-import monitors do not run on the clock. Editing a monitor makes its next scheduled check due; it does not replace an in-flight scan.

Three complete successful snapshots missing a listing mark that monitor's association stale. Partial snapshots and failures never age unseen listings. A part remains active when at least one association still sees it. The UI's Active only filter hides stale associations. Stale does not prove a part was sold; it records absence from your successful snapshots.

Filters are applied to observed listings, so a previously over-budget part can become eligible after a price drop. Editing filters recalculates eligibility but does not emit alerts retroactively. Price changes are recorded globally and compared separately per monitor when deciding alerts.

## Alert delivery

The first observation establishes a baseline unless `notifyInitial` is enabled. New matches and price drops become outbox jobs only when their alert preference is enabled. Off mode does not create new jobs and pauses delivery of existing jobs. Digest mode delays new jobs by the configured window and delivers due jobs in batches of up to ten embeds; it is a rolling window, not a daily wall-clock digest.

Jobs move from pending to sending to sent. Network failures and rate limits return them to pending with a future due time. Other HTTP 4xx responses fail permanently. Eight failed attempts also mark a job failed. The UI can requeue failed jobs. Restart recovers interrupted sending jobs. Delivery is **at least once**: if Discord accepts a message and the process exits before the success is recorded, it may be sent again. Discord webhooks provide no idempotency key to eliminate that window.

## Security boundaries

Loopback is the default. A network bind requires a sufficiently long admin token; all API endpoints except health require it. Browser sessions hold the token in memory. Origin checks reject cross-site API calls, CSP restricts script execution, listing text is escaped, embeds disable mentions, and CSV exports neutralize formula prefixes. Environment secrets never appear in API responses or normal exports. Feed URLs are administrator data: avoid putting secrets in their query strings because configuration exports include those URLs.

Feeds require exact configured hosts and public DNS addresses; redirects and credential-bearing URLs are rejected. Hostnames must be trusted and under stable administration. DNS validation is not a substitute for an outbound firewall in hostile environments. The Car-Part target and Discord webhook host are fixed. Bot access is restricted to the configured guild and explicit user IDs; replies are ephemeral.

## Deliberate limits

- One server process and one SQLite file. No distributed workers or cluster deployment.
- No accounts, billing, team roles, or multi-guild tenant separation.
- Provider results are not independently verified; fitment and availability still require recycler confirmation.
- The Car-Part adapter follows recognized numbered pages up to the monitor limit. Capped or unrecognized pagination stays partial. Tests use synthetic fixtures, not a live permission-backed end-to-end run.
- Discord commands are implemented and exercised through the shared API, but live bot registration and webhook delivery need your credentials.
- Health reports process readiness. Provider failures and alert delivery failures are visible in Activity, not hidden by a green health endpoint.
