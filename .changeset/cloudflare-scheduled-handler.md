---
'@ontrails/cloudflare': minor
---

Materialize core `schedule()` sources on Cloudflare Workers. `createWorkersHandler` now exports `scheduled(controller, env, ctx)` next to `fetch` and `queue`, matching `controller.cron` against the topo's normalized schedule crons and running each matching trail through the shared pipeline with activation provenance and the env bridge. `@ontrails/cloudflare/schedules` exports `createScheduledHandler` for custom Worker exports. Cron Triggers run in UTC only, so a schedule with any other timezone fails at materialization with a `ValidationError` carrying the `cloudflare_cron_utc_only` code instead of running on the wrong clock.
