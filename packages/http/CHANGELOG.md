# @ontrails/http

## 1.0.0-beta.8

### Major Changes

- Restructure HTTP package and fix Codex review findings.

  **http**: BREAKING — `blaze()` moved to `@ontrails/http/hono` subpath. Hono is now a peer dependency. `buildHttpRoutes()` is framework-agnostic. Fixed: malformed JSON → 400, execute() never throws, query parsing preserves raw strings and supports arrays.

  **schema**: OpenAPI 200 response wraps in `{ data }` envelope matching wire format. Always includes 400 ValidationError with error schema. basePath trailing slash normalized.

### Patch Changes

- @ontrails/core@1.0.0-beta.8

## 1.0.0-beta.7

### Minor Changes

- HTTP surface and OpenAPI generation.

  **http**: New `@ontrails/http` package — Hono-based HTTP adapter. `blaze()` derives routes from trail IDs, maps intent to HTTP verbs (read→GET, write→POST, destroy→DELETE), and maps error taxonomy to status codes. Returns the Hono instance.

  **schema**: Add `generateOpenApiSpec(topo)` — generates a complete OpenAPI 3.1 spec from the topo. Each trail becomes an operation with path, method, schemas, and error responses derived from the contract.

  **trails**: `trails survey --openapi` outputs the OpenAPI spec for any Trails app.

### Patch Changes

- @ontrails/core@1.0.0-beta.7
