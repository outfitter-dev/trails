---
"@ontrails/http": major
"@ontrails/topography": patch
---

Restructure HTTP package and fix Codex review findings.

**http**: BREAKING — the Hono adapter moved to `@ontrails/hono` while `@ontrails/http` owns framework-agnostic route definitions. Hono is now a peer dependency of the adapter. `buildHttpRoutes()` is framework-agnostic. Fixed: malformed JSON → 400, execute() never throws, query parsing preserves raw strings and supports arrays.

**schema**: OpenAPI 200 response wraps in `{ data }` envelope matching wire format. Always includes 400 ValidationError with error schema. basePath trailing slash normalized.
