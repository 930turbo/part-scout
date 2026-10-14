# Operations

## Configuration

| Variable                 | Purpose                                                     |
| ------------------------ | ----------------------------------------------------------- |
| `HOST`, `PORT`           | Default `127.0.0.1:4310`                                    |
| `DATABASE_PATH`          | SQLite path; default `data/part-scout.db`                   |
| `ADMIN_TOKEN`            | Shared administrative API token; required for network binds |
| `FEED_HOSTS`             | Comma-separated exact allowed HTTPS feed hosts              |
| `CAR_PART_ENABLED`       | `true` enables permission-backed provider access            |
| `DISCORD_WEBHOOK_URL`    | Destination for inventory alerts                            |
| `DISCORD_BOT_TOKEN`      | Gateway bot credential                                      |
| `DISCORD_APPLICATION_ID` | Application ID for command registration                     |
| `DISCORD_GUILD_ID`       | Single guild allowed to use the bot                         |
| `DISCORD_USER_IDS`       | Comma-separated authorized bot users                        |
| `SCOUT_API_URL`          | Dashboard API address used by the bot                       |

Server secrets are read at startup. Restart after editing `.env`. Browser settings and monitor changes apply immediately. Keep `.env` private. Generate a token with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

## Backups

Stop the server, then copy the database file and any `-wal`/`-shm` sidecars still present. Keep the `.env` separately in secure storage. For Docker, stop the services before backing up `scout-data`. Configuration exports contain searches/settings only; CSV exports contain current inventory only. Neither is a full database backup. Test restoration to a separate database before replacing a working instance.

Retention runs hourly. Delivered/failed alerts and scan history expire after the configured number of days. Unsaved stale listings expire by last observation; their price history is removed through foreign keys. Saved listings and currently active listings remain. Removing a monitor removes its associations, while bookmarked records remain available under Saved parts with Active only unchecked.

## Troubleshooting

| Symptom                           | Check                                                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Browser asks for a token          | Use the server's `ADMIN_TOKEN`, not a Discord token. Reloading clears the browser session.                        |
| Feed rejected                     | Check HTTPS, exact FEED_HOSTS entry, public DNS, and redirects.                                                   |
| No matches after an import        | Check year/model/part names and all enabled filters. Inventory retains observations even if filters exclude them. |
| Monitor needs attention           | Open Activity for the last provider error. The next retry uses backoff.                                           |
| Webhook alerts stay pending       | Configure a valid webhook, enable alert mode, and allow the digest window to elapse.                              |
| Delivery failed                   | Correct webhook access or connectivity, then retry from Activity.                                                 |
| Bot says access denied            | Both guild ID and user ID must match configuration.                                                               |
| Bot says a scan is running        | The single scan slot is busy; retry when it completes.                                                            |
| Car-Part returns a selection page | Verify provider identifiers and narrow the interchange variant.                                                   |

## Release validation

CI type-checks, runs unit/integration tests, compiles the server, exercises the UI in Chromium, and builds the Docker image. Browser tests use a disposable sample database under `.preview`; they never use the real workspace database. `npm run benchmark` uses an in-memory 10,000-listing fixture and reports timings for the current machine. It measures local processing, not provider latency or a speedup against the original project.

Use `npm audit` when updating dependencies. The Docker setup runs as a non-root user. Keep the server single-process, protect network access with HTTPS, and apply OS backups/updates appropriate to the host.
