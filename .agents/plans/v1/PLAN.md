# Trails v1 — Build Plan

> **Status:** Planning **Scope:** Everything needed to ship `@ontrails/core` through first usable app

---

## Stage Overview

| Stage | Package | What you get |
| --- | --- | --- |
| 00 | (scaffolding) | Repo, workspace, CI |
| 01 | `@ontrails/core` | Result, errors, `trail()`, `route()`, `event()`, `trailhead()`, patterns, types, validation, BlobRef, job pattern |
| 02 | `@ontrails/cli` | CLI surface + Commander adapter, `blaze()` |
| 03 | `@ontrails/mcp` | MCP surface, `blaze()` |
| 04 | `@ontrails/logging` | Structured logging + logtape adapter |
| 05 | `@ontrails/testing` | `testAllExamples()`, contract testing |
| 06 | `@ontrails/warden` | oxlint plugin + governance CLI — keeps agents on trails |
| 07 | `@ontrails/schema` | Surface maps, diffing, lock files |
| 08 | `apps/trails` | CLI app — init, survey, scout, warden, guide |
| 09 | `apps/trails-demo` | Example app |
| 10 | (documentation) | Per-package READMEs, TSDoc coverage, `docs/` site content, getting-started guide |

---

## Stages

### 00 — Project Scaffolding

Set up the Trails monorepo. Workspace config, TypeScript, linting, testing, CI. Simpler than the Outfitter stack — no bunup complexity. Bun workspace with direct `tsc` or lightweight bundling.

**Deliverables:**

- [ ] Bun workspace root with `packages/` and `apps/` directories
- [ ] TypeScript config (strict, same flags as Outfitter)
- [ ] Linting (oxlint via ultracite, simpler config than Outfitter)
- [ ] Formatting (oxfmt via ultracite)
- [ ] Test runner (bun:test)
- [ ] CI pipeline (GitHub Actions — build, test, lint, typecheck)
- [ ] `.bun-version`, `package.json` workspace config
- [ ] Lefthook (pre-commit: format + lint, pre-push: test + typecheck)
- [ ] Changesets for versioning
- [ ] AGENTS.md — full project context for agents
- [ ] CLAUDE.md — points to AGENTS.md
- [ ] `.claude/rules/graphite.md` — Graphite workflow (carry from Outfitter)
- [ ] `.claude/rules/linear.md` — Linear workflow (team: TRL)
- [ ] `.claude/rules/tsdoc.md` — TSDoc conventions (carry from Outfitter)
- [ ] `.claude/rules/trails-conventions.md` — Trails-specific conventions for agents
- [ ] Linear project setup — TRL team, milestones for each stage, issue templates
- [ ] Linear issues for stage 01 deliverables

**Key decision:** Bundling strategy. Outfitter uses bunup across 14 packages with a complex registry system. Trails can start simpler — evaluate whether `tsc` with `declaration: true` is sufficient for the initial package set, or if bunup is still the right choice for fewer packages with cleaner boundaries.

---

### 01 — Core (`@ontrails/core`)

The foundation. Result, error taxonomy, trail/route/event definitions, validation, patterns, types. Everything a surface adapter needs to integrate.

**Deliverables:**

- [ ] `Result` type (built-in, no `better-result`)
- [ ] Error taxonomy (13 classes, 10 categories, exit/HTTP/JSON-RPC mapping)
- [ ] `trail()`, `route()`, `event()` — the three definition primitives
- [ ] `trailhead()` — collect trails into an app
- [ ] `TrailContext`, `createTrailContext()` — invocation environment
- [ ] `Implementation<I, O>`, `SyncImplementation<I, O>` — function types
- [ ] `Trail<I, O>`, `Route<I, O>`, `Event<T>`, `Topo` — spec types
- [ ] `Layer` interface and composition utilities
- [ ] `HealthStatus`, `HealthResult` — shared health types
- [ ] Adapter port interfaces (`IndexAdapter`, `StorageAdapter`, etc.)
- [ ] Validation: `validateInput()`, `formatZodIssues()`, `zodToJsonSchema()`
- [ ] Resilience: `retry()`, `withTimeout()`, `shouldRetry()`
- [ ] Serialization: `serializeError()`, `deserializeError()`, `safeParse()`
- [ ] `fromFetch()` — fetch-to-Result helper
- [ ] Branded types: `Branded<T, Tag>`, `brand()`, `UUID`, `Email`, etc.
- [ ] Type guards: `isDefined()`, `isNonEmptyString()`, etc.
- [ ] Collection utilities: `chunk()`, `dedupe()`, `groupBy()`, `sortBy()`
- [ ] `@ontrails/core/patterns` subpath — pagination, bulk, timestamps, date range, sorting, status, change, progress
- [ ] `@ontrails/core/redaction` subpath — `createRedactor()`, `DEFAULT_PATTERNS`
- [ ] Path security: `securePath()`, `isPathSafe()`, `resolveSafePath()` — in core so the safe path is the easy path
- [ ] Workspace detection: `findWorkspaceRoot()`, `isInsideWorkspace()`, `getRelativePath()` — supports `TrailContext.workspaceRoot`
- [ ] `BlobRef` type — surface-agnostic file/binary reference that adapters handle per-transport
- [ ] Job pattern proof — verify `statusFields()` + `progressFields()` output works across surfaces. If it needs `kind: "job"` on the spec, add it now
- [ ] Tests for everything

---

### 02 — CLI Surface (`@ontrails/cli` + `@ontrails/cli/commander`)

The CLI surface adapter. Command model, flag derivation, output. Plus the Commander adapter subpath.

**Deliverables:**

- [ ] `CliCommand` model — framework-agnostic command representation
- [ ] `buildCliCommands(app)` → `CliCommand[]`
- [ ] Flag derivation from Zod schemas (including `z.array()`)
- [ ] `output(value, mode)` — JSON/text/JSONL to stdout
- [ ] `resolveOutputMode()` from flags
- [ ] Layer composition for CLI
- [ ] Flag presets: `outputModePreset()`, `cwdPreset()`, `dryRunPreset()`
- [ ] `@ontrails/cli/commander` subpath:
  - [ ] `toCommander(commands, options)` — adapter
  - [ ] `blaze(app, options?)` — one-liner convenience
- [ ] Tests

---

### 03 — MCP Surface (`@ontrails/mcp`)

The MCP surface adapter. Tool generation, annotation auto-generation, transport.

**Deliverables:**

- [ ] `buildMcpTools(app)` — generate MCP tools from topo
- [ ] Annotation auto-generation from trail metadata (readOnly, destructive, idempotent)
- [ ] `blaze(app, options)` — one-liner with stdio/transport options
- [ ] `zodToJsonSchema()` integration (from core)
- [ ] Progress callback → MCP notifications bridge
- [ ] Tests

---

### 04 — Logging (`@ontrails/logging`)

Clean structured logging. No logtape dependency. Hierarchical categories.

**Deliverables:**

- [ ] `createLogger(config)` — single API
- [ ] `LoggerInstance` with trace/debug/info/warn/error/fatal/child
- [ ] Hierarchical category filtering
- [ ] Built-in sinks: `createConsoleSink()`, `createFileSink()`
- [ ] Built-in formatters: `createJsonFormatter()`, `createPrettyFormatter()`
- [ ] Redaction integration (from `@ontrails/core/redaction`)
- [ ] `resolveLogLevel()` from env
- [ ] `@ontrails/logging/logtape` subpath — sink adapter
- [ ] Tests

---

### 05 — Testing (`@ontrails/testing`)

Contract-driven testing utilities.

**Deliverables:**

- [ ] `testAllExamples(app, ctx)` — the headline one-liner
- [ ] `testTrail(trail, scenarios, ctx)` — single trail with custom scenarios
- [ ] `testContracts(app, ctx)` — output schema verification
- [ ] `testRecoveryPaths(app)` — detour validation (references exist)
- [ ] Progressive assertion: full match / schema-only / error match
- [ ] `createTestTrailContext()` — mock context factory
- [ ] `createTestLogger()` — logger with entry capture
- [ ] CLI harness: `createCliHarness()`
- [ ] MCP harness: `createMcpHarness()`
- [ ] Tests

---

### 06 — Warden (`@ontrails/warden`)

The governance package. Lint rules that enforce contract-first discipline for apps built with Trails. Ships early because it keeps agents (and humans) on trails from the start.

**Deliverables:**

- [ ] oxlint plugin with Trails-specific rules:
  - [x] `trails/no-throw-in-implementation` — use `Result.err()`, not `throw`
  - [x] `trails/context-no-surface-types` — don't import `Request`, `Response` into `TrailContext`
  - [x] `trails/require-output-schema` — trails on MCP/HTTP need output schemas
  - [x] `trails/prefer-schema-inference` — don't redundantly restate `fields` metadata `derive()` already infers
  - [x] `trails/examples-match-schema` — examples must structurally match the current `input` / `expected` schema shape
  - [x] `trails/follows-matches-calls` — `follows` must match `ctx.follow()` usage
  - [x] `trails/no-recursive-follows` — no cycles in the follows graph
  - [x] `trails/follows-trails-exist` — followed trail IDs must exist
  - [x] `trails/valid-describe-refs` — `@see` tags must resolve against topo
  - [x] `trails/valid-detour-refs` — detour targets must exist
  - [x] `trails/no-direct-implementation-call` — app code should use `ctx.follow()`, not direct `.implementation()` calls
  - [x] `trails/no-sync-result-assumption` — `.implementation()` results must be awaited before `Result` access
  - [x] `trails/implementation-returns-result` — implementations return `Result.ok()` / `Result.err()`, not raw values
  - [x] `trails/no-throw-in-detour-target` — detour targets must return `Result.err()`, not `throw`
  - [x] `trails/event-origins-exist` — event `from` refs must resolve against topo
- [x] `trails warden` CLI command — runs lint + survey drift + surface.lock checks
- [x] `trails warden --exit-code` for CI gating
- [x] Tests

**Why this ships early:** Agents building with Trails need guardrails from day one. Without warden, the first agent-generated trail will `throw` instead of returning `Result.err()`, put auth checks in the implementation, and let `follows` declarations drift. Warden is the enforcement layer that makes "consistency through constraint" real. It keeps agents on trails.

---

### 07 — Schema (`@ontrails/schema`)

Surface maps, diffing, lock files. Warden consumes this for drift detection.

**Deliverables:**

- [ ] `generateSurfaceMap(app.topo)` — machine-readable manifest
- [ ] `hashSurfaceMap()` — SHA-256 for `surface.lock`
- [ ] `diffSurfaceMaps()` — semantic diffing
- [ ] `writeSurfaceMap()` / `readSurfaceMap()` — file I/O
- [ ] `writeSurfaceLock()` / `readSurfaceLock()` — lock file
- [ ] Tests

---

### 08 — Trails CLI App (`apps/trails`)

The `trails` CLI — scaffolding, survey, scout, guide.

**Deliverables:**

- [ ] `trails init` — scaffold a new Trails project
- [ ] `trails survey` — full topo introspection
- [ ] `trails scout` — quick capabilities check
- [ ] `trails survey --diff <ref>` — contract diffing
- [ ] Uses `@outfitter/tui` for rendering
- [ ] Uses `@clack/prompts` for interactive flows
- [ ] Tests

---

### 09 — Demo App (`apps/trails-demo`)

A complete example app demonstrating the framework.

**Deliverables:**

- [ ] 3-5 trails across a domain (entity CRUD + search)
- [ ] 1 route (composite)
- [ ] 1 event
- [ ] Blazed on CLI + MCP
- [ ] Examples on every trail
- [ ] Tests via `testAllExamples()`
- [ ] README as a tutorial

---

### 10 — Documentation Pass

Comprehensive documentation across every package and the repo as a whole. This is not an afterthought — it's a dedicated stage that ensures Trails is documented well enough for adoption.

**Per-package deliverables:**

- [ ] README.md for every package — what it does, installation, quick start, API overview
- [ ] TSDoc coverage on all exported declarations (functions, types, interfaces)
- [ ] `@example` blocks on public API entry points
- [ ] Package-level `docs/` where needed (e.g., `packages/core/docs/error-taxonomy.md`, `packages/core/docs/patterns.md`)

**Repo-level `docs/` deliverables:**

- [ ] `docs/getting-started.md` — zero to blazing in 5 minutes
- [ ] `docs/architecture.md` — expanded from the planning doc, with diagrams
- [ ] `docs/vocabulary.md` — the language guide, polished for public consumption
- [ ] `docs/trails-comparison.md` — landscape comparison (how Trails differs from tRPC, FastMCP, Go kit, etc.)
- [ ] `docs/migration.md` — coming from Express/Commander/raw MCP? Here's how.
- [ ] `docs/examples/` — cookbook-style recipes (pagination, file uploads, auth patterns, job trails)
- [ ] `docs/surfaces/cli.md` — CLI surface deep dive
- [ ] `docs/surfaces/mcp.md` — MCP surface deep dive
- [ ] `docs/testing.md` — testing guide: `testAllExamples()`, progressive assertion, writing examples, config profiles, service mocking with `app.forTesting()`

**Guide integration:**

- [ ] `trails guide` produces useful output for every trail in the demo app
- [ ] `trails guide --for-agent` generates agent-consumable context

**Root README.md rewrite:**

- [ ] Full rewrite of the root README.md — the stub from initial commit becomes the real thing
- [ ] Tagline, code example, surface demo (CLI + MCP in one snippet)
- [ ] Package overview table
- [ ] Links to getting-started, architecture, vocabulary docs
- [ ] "The rest is on Trails" closing

**Quality bar:**

- Every exported function has TSDoc with `@param`, `@returns`, and at least one `@example`
- Every package README has a working code sample that can be copy-pasted
- The getting-started guide works end-to-end without skipping steps
- `docs/` content is accurate against the shipped code (not aspirational)

---

## What's Deferred (Post v1)

These are designed in PRDs but ship after the core is proven:

| Feature | PRD | Stage |
| --- | --- | --- |
| Config system (`defineConfig`, resolution stacks) | config-prd.md | v1.1 |
| Services (`defineService`, lifecycle, health) | services-prd.md | v1.1 |
| HTTP surface (`@ontrails/http`) | http-surface-prd.md | v1.2 |
| Tracks (`@ontrails/tracks`) | observability-prd.md | v1.2 |
| Contract governance (`survey --diff --impact`, warden) | governance-prd.md | v1.2 |
| Composites (`ctx.follow`, routes with `follows`) | composites-prd.md | v1.3 |
| Events (emission, delivery) | events-prd.md | v1.3 |
| Cross-app (`mount`) | cross-app-prd.md | v2+ |
| Action graph (`traverse`) | relations-prd.md | v2+ |

**Note:** `route()` and `event()` ship in core as definition primitives (stage 01). The runtime machinery (ctx.follow dispatch, event delivery) ships later. You can define routes and events from day one; the execution infrastructure follows.

---

## Key Differences from Outfitter Stack

| Concern | Outfitter | Trails |
| --- | --- | --- |
| Packages | 14 runtime + 3 tooling | 6 initial (core, cli, mcp, logging, testing, schema) |
| Bundling | bunup with complex registry | Evaluate tsc-only or lighter bundler |
| Result type | `better-result` (external) | Built-in (~80 LOC) |
| Error system | `TaggedError` factory + base classes | Direct class inheritance from `TrailsError` |
| CLI framework | Commander baked into `@outfitter/cli` | Commander as adapter subpath |
| Logging | logtape as internal dependency | logtape as optional adapter |
| Terminology | handler, HandlerContext, ActionSpec | implementation, TrailContext, Trail |
| Registry | Explicit `createActionRegistry().add()` | `trailhead()` auto-scans modules |
| Surface wiring | `buildCliCommands()` + Commander boilerplate | `blaze(app)` one-liner |
| Types package | Separate `@outfitter/types` | Folded into `@ontrails/core` |
