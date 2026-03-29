---
"@ontrails/http": minor
"@ontrails/schema": minor
"@ontrails/trails": minor
---

HTTP surface and OpenAPI generation.

**http**: New `@ontrails/http` package — Hono-based HTTP adapter. `blaze()` derives routes from trail IDs, maps intent to HTTP verbs (read→GET, write→POST, destroy→DELETE), and maps error taxonomy to status codes. Returns the Hono instance.

**schema**: Add `generateOpenApiSpec(topo)` — generates a complete OpenAPI 3.1 spec from the topo. Each trail becomes an operation with path, method, schemas, and error responses derived from the contract.

**trails**: `trails survey --openapi` outputs the OpenAPI spec for any Trails app.
