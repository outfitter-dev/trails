---
"@ontrails/http": minor
"@ontrails/schema": major
---

Move OpenAPI generation ownership to the HTTP surface.

**http**: Export `deriveOpenApiSpec()` and its OpenAPI types from `@ontrails/http`.

**schema**: Remove the OpenAPI helper export so schema stays focused on surface maps, locks, and semantic diffing.
