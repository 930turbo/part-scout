# Review of the original project

Reviewed source: [dzt/car-part-monitor at 8b52e84](https://github.com/dzt/car-part-monitor/tree/8b52e848dc5ab812a37c71175f3f356e1c52abce). The original program compiles TypeScript at startup, loads local configuration, creates per-vehicle cron jobs, posts search forms to Car-Part, inserts unseen stock into SQLite, and sends Discord embeds through an in-memory queue.

The request form supports direct searches, explicit year ranges, and interchange choices resolved from radio labels. Results are read from seven- or eight-column HTML tables. Each monitor searches a vehicle/part/variant combination; each vehicle supplies one cron schedule and webhook destination. A setup script populates vehicles and monitors from JSON. Dealers and parts are shared in the database.

## Findings and resulting changes

| Original behavior                                              | Part Scout behavior                                                                             |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Vehicles and monitors are captured once when cron jobs start   | The scheduler reads current configuration on each tick. UI changes apply without restarting.    |
| Separate vehicle cron jobs can overlap                         | One global scan slot prevents overlapping provider work.                                        |
| Ten-second delay follows every monitor task, even the last one | One request-spacing budget applies only when another network request is due.                    |
| Network requests have no explicit deadline                     | Provider requests have a 30-second deadline and a bounded body.                                 |
| Failed scans wait for the same cron schedule                   | Failures are recorded and retries back off.                                                     |
| Stock number plus dealer is the inventory identity             | Identity also includes vehicle and part, so different parts from the same donor do not collide. |
| Existing listings are never updated                            | Descriptions, quoted prices, and other current data refresh on each observation.                |
| No price history or price drop detection                       | Price changes are recorded, with per-monitor comparison and alerts.                             |
| A missing dealer city/state aborts a search                    | Location fields may be unknown; the rest of the listing can still be tracked.                   |
| Dealer extraction assumes a fixed location shape               | Location extraction is optional and does not index missing string fragments.                    |
| One malformed row can throw during positional parsing          | Validated adapters reject incomplete parsing without overwriting inventory.                     |
| First discovery floods alerts for existing inventory           | Baseline scans are quiet by default, with an explicit opt-in for initial alerts.                |
| Queue entries are removed before Discord accepts them          | Jobs remain durable until success, with attempts, backoff, and visible failures.                |
| Pending alerts disappear on restart                            | Interrupted jobs recover from SQLite.                                                           |
| Alert queue ignores Discord rate limits                        | HTTP 429 and retry-after inform the next due time.                                              |
| Every query prepares another statement                         | Repeated SQL statements are cached; common reads use indexes.                                   |
| Database constraints lack enabled foreign-key enforcement      | Foreign keys are enabled, and ingestion is transactional.                                       |
| No notion of stale inventory                                   | Three complete successful misses mark an association stale; partial scans do not.               |
| Configuration is edited by hand                                | The dashboard validates forms and offers portable configuration exports.                        |
| Mixed CommonJS/TypeScript paths in setup scripts               | One ESM TypeScript codebase compiles consistently; startup runs the compiled server.            |
| README and package metadata disagree about the license         | MIT metadata and the original copyright notice are retained consistently.                       |

The project is a rewrite rather than a claim of a measured end-to-end speedup. Provider latency dominates network scans, and reducing delays below a provider-approved limit is not an appropriate performance target. Local benchmarks measure ingestion and inventory reads separately.

The Car-Part adapter now follows recognized numbered pages up to a configurable limit. Provider page caps and unrecognized pagination remain coverage limits. It is tested against synthetic layouts derived from the original parser, and no permission-backed live scan was performed during development. The bot and webhook also need real credentials for live verification.
