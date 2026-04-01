# @ontrails/http

## 1.0.0-beta.12

### Patch Changes

- Complete trifecta for config, permits, and crumbs (formerly tracks)

  - **config**: Add `configService`, `config.layer`, `config.trail`, and `config.workspace` trails with full `defineConfig`, `resolve`, `describe`, `explain`, `doctor`, and code generation support
  - **permits**: Add `authService` and `auth.verify` trail for runtime authorization checks
  - **crumbs**: Rename tracks to crumbs; add `crumbsService` and `crumbs.status` trail for structured event tracking
  - **cli**: Fix build flag handling and improve bootstrap scaffolding
  - **testing**: Expand test context helpers and example-based testing utilities
  - **core/mcp/http**: Internal alignment for service and composition updates

- Updated dependencies
  - @ontrails/core@1.0.0-beta.12

## 1.0.0-beta.11

### Patch Changes

- Add services as a first-class primitive.

  Services make infrastructure dependencies declarative, injectable, and governable. Define a service with `service()`, declare it on a trail with `services: [db]`, and access it with `db.from(ctx)` or `ctx.service()`.

  **Core:** `service()` factory, `ServiceSpec<T>`, `ServiceContext`, singleton resolution in `executeTrail`, in-flight creation dedup, `isService` guard, `findDuplicateServiceId`, topo service discovery and validation, `services` field on trail specs.

  **Testing:** Auto-resolution of `mock` factories in `testAll`, `testExamples`, `testContracts`, and `testFollows`. Explicit `services` overrides with correct precedence (`explicit > ctx.extensions > auto-mock`). Service mock propagation through follow graphs.

  **Warden:** `service-declarations` rule validates `db.from(ctx)` and `ctx.service()` usage matches declared `services: [...]`. `service-exists` rule validates declared service IDs resolve in project context. Scope-aware AST walking skips nested function boundaries.

  **Surfaces:** Service overrides thread through `dispatch` and `blaze` on CLI, MCP, and HTTP.

  **Introspection:** Survey and surface map outputs include service graph. Topo exposes `.services`, `.getService()`, `.hasService()`, `.listServices()`, `.serviceIds()`, `.serviceCount`.

  **Docs:** ADR-009 accepted. Unified services guide, updated vocabulary, getting-started, architecture, and package READMEs.

- Updated dependencies
  - @ontrails/core@1.0.0-beta.11

## 1.0.0-beta.10

### Patch Changes

- Cleanup and hardening pass across all packages.

  **core**: Deduplicate `DispatchOptions` as type alias of `ExecuteTrailOptions`. Replace `TrailContext` index signature with typed `extensions` field for type safety. Deep-merge `extensions` in `executeTrail` context resolution. Remove unused `Surface` type, `adapters.ts`, `health.ts`, and `job.ts` proof-of-concept from published package.

  **cli**: Remove vestigial `kind` checks from build. Run `validateTopo()` automatically in `blaze()` with opt-out via `validate: false`.

  **http**: Remove vestigial `kind` checks from build. Run `validateTopo()` automatically in `blaze()` with opt-out.

  **mcp**: Remove vestigial `kind` checks from build. Run `validateTopo()` automatically in `blaze()` with opt-out.

  **warden**: Project-aware rule context preserved in trail wrappers.

- Updated dependencies
  - @ontrails/core@1.0.0-beta.10

## 1.0.0-beta.9

### Minor Changes

- Consolidated improvements across all surface packages.

  **core**: Add `TrailResult<T>` utility type, `topo.ids()` and `topo.count` accessors, `dispatch()` for headless trail execution, and extract shared `executeTrail` pipeline used by CLI/MCP/HTTP.

  **http**: Detect route path collisions and return `Result` from `buildHttpRoutes()`, wire request `AbortSignal` through to trail context, and make write → POST mapping explicit in intent-to-method lookup.

  **mcp**: Return `Result` from `buildMcpTools()` on collision instead of throwing.

  **cli**: Verify exception catching via centralized `executeTrail`.

  **testing**: Follow context awareness improvements.

  **warden**: Refactor rules as composable trails with examples.

  **schema**: Error code and empty body fixes.

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.9

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
