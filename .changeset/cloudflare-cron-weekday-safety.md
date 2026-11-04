---
"@ontrails/cloudflare": patch
---

Reject Workers schedules whose day-of-week field is not a plain `*` with a `ValidationError` carrying `cloudflare_cron_weekday_unsupported`. Cloudflare uses 1=Sunday through 7=Saturday while core uses 0/7=Sunday and 1=Monday, so numeric weekdays, lists, ranges, and steps cannot safely share the same expression. Existing weekday-specific Workers schedules must be redesigned before materialization; named weekdays are not accepted by core.
