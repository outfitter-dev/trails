---
"@ontrails/http": minor
"@ontrails/trails": minor
---

HTTP trailhead and OpenAPI generation.

**http**: New `@ontrails/http` package — Hono-based HTTP connector. `trailhead()` derives routes from trail IDs, maps intent to HTTP verbs (read→GET, write→POST, destroy→DELETE), and maps error taxonomy to status codes. Returns the Hono instance.

**trails**: Depend on `@ontrails/http` for `trails survey --openapi`.
