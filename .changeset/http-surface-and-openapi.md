---
"@ontrails/http": minor
"@ontrails/trails": minor
---

HTTP surface and OpenAPI generation.

**http**: New `@ontrails/http` package — framework-agnostic HTTP route projection. `surface()` derives routes from trail IDs, maps intent to HTTP verbs (read→GET, write→POST, destroy→DELETE), and maps error taxonomy to status codes.

**trails**: Depend on `@ontrails/http` for `trails survey --openapi`.
