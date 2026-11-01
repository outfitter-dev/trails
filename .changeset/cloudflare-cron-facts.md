---
'@ontrails/cloudflare': minor
---

Record cron triggers in the Cloudflare lock overlay. `cloudflareOverlay` now derives a `schedules` fact family next to `bindings`: one entry per core `schedule()` source with its normalized cron, source id, trail id, declared timezone when present, and the `utc-only` realization Cron Triggers impose. Apps that compile the overlay pick up the new facts on their next `trails compile`.
