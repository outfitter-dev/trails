---
'@ontrails/cloudflare': minor
---

Add `cloudflareOverlay`, the first lock overlay overlay: it derives the app's env-bound resources into `overlays.cloudflare` (wrangler binding name per resource) when the app exports it via `trailsOverlays` and runs `trails compile`.
