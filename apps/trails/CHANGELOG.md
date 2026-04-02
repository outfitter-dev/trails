# trails

## 1.0.0-beta.12

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.12
  - @ontrails/cli@1.0.0-beta.12
  - @ontrails/logging@1.0.0-beta.12
  - @ontrails/schema@1.0.0-beta.12
  - @ontrails/warden@1.0.0-beta.12

## 1.0.0-beta.11

### Patch Changes

- Add services as a first-class primitive.

  Services make infrastructure dependencies declarative, injectable, and governable. Define a service with `service()`, declare it on a trail with `services: [db]`, and access it with `db.from(ctx)` or `ctx.service()`.

  **Core:** `service()` factory, `ServiceSpec<T>`, `ServiceContext`, singleton resolution in `executeTrail`, in-flight creation dedup, `isService` guard, `findDuplicateServiceId`, topo service discovery and validation, `services` field on trail specs.

  **Testing:** Auto-resolution of `mock` factories in `testAll`, `testExamples`, `testContracts`, and `testFollows`. Explicit `services` overrides with correct precedence (`explicit > ctx.extensions > auto-mock`). Service mock propagation through follow graphs.

  **Warden:** `service-declarations` rule validates `db.from(ctx)` and `ctx.service()` usage matches declared `services: [...]`. `service-exists` rule validates declared service IDs resolve in project context. Scope-aware AST walking skips nested function boundaries.

  **Surfaces:** Service overrides thread through `run` and `trailhead` on CLI, MCP, and HTTP.

  **Introspection:** Survey and surface map outputs include service graph. Topo exposes `.services`, `.getService()`, `.hasService()`, `.listServices()`, `.serviceIds()`, `.serviceCount`.

  **Docs:** ADR-009 accepted. Unified services guide, updated vocabulary, getting-started, architecture, and package READMEs.

- Updated dependencies
  - @ontrails/core@1.0.0-beta.11
  - @ontrails/warden@1.0.0-beta.11
  - @ontrails/cli@1.0.0-beta.11
  - @ontrails/schema@1.0.0-beta.11
  - @ontrails/logging@1.0.0-beta.11

## 1.0.0-beta.10

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.10
  - @ontrails/cli@1.0.0-beta.10
  - @ontrails/warden@1.0.0-beta.10
  - @ontrails/logging@1.0.0-beta.10
  - @ontrails/schema@1.0.0-beta.10

## 1.0.0-beta.9

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.9
  - @ontrails/cli@1.0.0-beta.9
  - @ontrails/schema@1.0.0-beta.9
  - @ontrails/warden@1.0.0-beta.9
  - @ontrails/logging@1.0.0-beta.9

## 1.0.0-beta.8

### Patch Changes

- Updated dependencies
  - @ontrails/schema@1.0.0-beta.8
  - @ontrails/cli@1.0.0-beta.8
  - @ontrails/core@1.0.0-beta.8
  - @ontrails/logging@1.0.0-beta.8
  - @ontrails/warden@1.0.0-beta.8

## 1.0.0-beta.7

### Minor Changes

- HTTP surface and OpenAPI generation.

  **http**: New `@ontrails/http` package — Hono-based HTTP adapter. `trailhead()` derives routes from trail IDs, maps intent to HTTP verbs (read→GET, write→POST, destroy→DELETE), and maps error taxonomy to status codes. Returns the Hono instance.

  **schema**: Add `generateOpenApiSpec(topo)` — generates a complete OpenAPI 3.1 spec from the topo. Each trail becomes an operation with path, method, schemas, and error responses derived from the contract.

  **trails**: `trails survey --openapi` outputs the OpenAPI spec for any Trails app.

### Patch Changes

- Updated dependencies
  - @ontrails/schema@1.0.0-beta.7
  - @ontrails/warden@1.0.0-beta.7
  - @ontrails/cli@1.0.0-beta.7
  - @ontrails/core@1.0.0-beta.7
  - @ontrails/logging@1.0.0-beta.7

## 1.0.0-beta.6

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.6
  - @ontrails/warden@1.0.0-beta.6
  - @ontrails/cli@1.0.0-beta.6
  - @ontrails/logging@1.0.0-beta.6
  - @ontrails/schema@1.0.0-beta.6

## 1.0.0-beta.5

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.5
  - @ontrails/warden@1.0.0-beta.5
  - @ontrails/logging@1.0.0-beta.5
  - @ontrails/schema@1.0.0-beta.5
  - @ontrails/cli@1.0.0-beta.5

## 1.0.0-beta.4

### Major Changes

- API simplification: unified trail model, intent enum, run, metadata.

  **BREAKING CHANGES:**

  - `hike()` removed — use `trail()` with optional `follow: [...]` field
  - `follows` renamed to `follow` (singular, matching `ctx.follow()`)
  - `topo.hikes` removed — single `topo.trails` map
  - `kind: 'hike'` removed — everything is `kind: 'trail'`
  - `readOnly`/`destructive` booleans replaced by `intent: 'read' | 'write' | 'destroy'`
  - `implementation` field renamed to `run`
  - `markers` field renamed to `metadata`
  - `testHike` renamed to `testFollows`, `HikeScenario` to `FollowScenario`
  - `trailhead()` now returns the surface handle (`Command` for CLI, `Server` for MCP)

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.4
  - @ontrails/cli@1.0.0-beta.4
  - @ontrails/warden@1.0.0-beta.4
  - @ontrails/schema@1.0.0-beta.4
  - @ontrails/logging@1.0.0-beta.4

## 1.0.0-beta.3

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.3
  - @ontrails/cli@1.0.0-beta.3
  - @ontrails/warden@1.0.0-beta.3
  - @ontrails/logging@1.0.0-beta.3
  - @ontrails/schema@1.0.0-beta.3

## 1.0.0-beta.2

### Patch Changes

- Fix workspace dependency resolution in published packages. Now using bun publish
  which correctly replaces workspace:^ with actual version numbers.
- Updated dependencies
  - @ontrails/core@1.0.0-beta.2
  - @ontrails/cli@1.0.0-beta.2
  - @ontrails/logging@1.0.0-beta.2
  - @ontrails/warden@1.0.0-beta.2
  - @ontrails/schema@1.0.0-beta.2

## 1.0.0-beta.1

### Patch Changes

- Fix two blocking bugs from real-world migration:
  - Published packages now resolve correctly (workspace:^ instead of workspace:\*)
  - Error forwarding works across different success types (Err no longer carries phantom T)
- Updated dependencies
  - @ontrails/core@1.0.0-beta.1
  - @ontrails/cli@1.0.0-beta.1
  - @ontrails/logging@1.0.0-beta.1
  - @ontrails/warden@1.0.0-beta.1
  - @ontrails/schema@1.0.0-beta.1

## 0.1.1-beta.0

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.0
  - @ontrails/cli@1.0.0-beta.0
  - @ontrails/logging@1.0.0-beta.0
  - @ontrails/warden@1.0.0-beta.0
  - @ontrails/schema@1.0.0-beta.0
