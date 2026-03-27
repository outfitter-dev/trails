# Trails — Roadmap

## What Ships in v1

Everything needed to define trails and blaze them on CLI and MCP. The core developer experience.

| Stage | Package | What you get |
| --- | --- | --- |
| 00 | (scaffolding) | Repo, workspace, CI |
| 01 | `@ontrails/core` | Result, errors, `trail()`, `route()`, `event()`, `trailhead()`, patterns, types, validation |
| 02 | `@ontrails/cli` | CLI surface + Commander adapter, `blaze()` |
| 03 | `@ontrails/mcp` | MCP surface, `blaze()` |
| 04 | `@ontrails/logging` | Structured logging + logtape adapter |
| 05 | `@ontrails/testing` | `testAllExamples()`, contract testing |
| 06 | `@ontrails/schema` | Surface maps, diffing, lock files |
| 07 | `apps/trails` | CLI app — init, survey, scout |
| 08 | `apps/trails-demo` | Example app |

After v1 ships, the framework is usable. You can define trails, blaze on CLI and MCP, test with one line, and introspect via survey/scout.

---

## Post-v1: What the PRDs Design

The 13 PRDs written during the design phase cover the full vision. With a clean start, much of what was "refactor existing code" becomes "build it right from the start." Here's what's already baked into v1 vs what ships later:

### Baked into v1 (no separate phase needed)

| PRD Concept | How it's baked in |
| --- | --- |
| `handler` → `implementation` rename | Never existed as `handler` — `implementation` from day one |
| Safety metadata on Trail level | `readOnly`, `destructive`, `idempotent` on `trail()` spec from day one |
| Error type widening | `Result<T, Error>` from day one, no `OutfitterError` constraint |
| Surface values `"http"` / `"ws"` | Correct values from day one |
| `ActionTrpcSpec` removal | Never exists |
| Legacy cleanup (KitError, etc.) | Nothing to clean up |
| Terminology alignment | Correct vocabulary from day one |
| Dual zodToJsonSchema | One copy in core from day one |
| Types folded into core | Branded types, guards, collections in core from day one |
| Result built-in | No `better-result` dependency, ever |
| Clean logging | No logtape bridge, no factory indirection, ever |
| `signal: AbortSignal` required | Required on `TrailContext` from day one |
| Commander as adapter | `@ontrails/cli/commander` subpath from day one |
| Contract patterns | `@ontrails/core/patterns` subpath from day one |
| Redaction consolidated | `@ontrails/core/redaction` subpath from day one |
| Path security in core | `securePath()`, `isPathSafe()` in core from day one |
| Workspace detection in core | `findWorkspaceRoot()` in core from day one |
| BlobRef type | Surface-agnostic file/binary reference in core from day one |
| Job pattern | `statusFields()` + `progressFields()` proven across surfaces from day one |
| Warden (oxlint plugin) | `@ontrails/warden` ships in v1 — keeps agents on trails from day one |

This is the payoff of starting fresh: most of the PRD work is "already done" by building correctly.

### v1.1 — Config and Services

| Feature | Package | PRD |
| --- | --- | --- |
| `defineConfig()`, resolution stacks, XDG, preferences | `@ontrails/config` | config-prd.md |
| `defineService()`, lifecycle, health checks | `@ontrails/services` | services-prd.md |
| Config profiles for testing (`testWithProfiles`) | `@ontrails/testing` update | testing-prd.md |
| `@ontrails/logging/logtape` improvements | `@ontrails/logging` | observability-prd.md |

### v1.2 — HTTP, Webhooks, Tracks, Governance

| Feature | Package | PRD |
| --- | --- | --- |
| HTTP surface (`blaze` on HTTP, SSE, OpenAPI) | `@ontrails/http` | http-surface-prd.md |
| Webhook event delivery | `@ontrails/webhooks` | — (needs PRD) |
| Auth/permit model (`Permit` type, scope system, RBAC port) | `@ontrails/core` update | — (needs PRD) |
| Tracks (telemetry, OTel spans, tracksLayer) | `@ontrails/tracks` | observability-prd.md |
| Contract governance (`survey --diff --impact`, warden expansion) | `@ontrails/schema` update, CLI | governance-prd.md |
| Layer system formalized | Core + surface packages | layers-prd.md |

### v1.3 — Composition and Events

| Feature | Package | PRD |
| --- | --- | --- |
| `ctx.follow()` runtime dispatch | Core + surface updates | composites-prd.md |
| Event emission (`ctx.emit()`) | Core | events-prd.md |
| Event delivery (WebSocket, SSE) | `@ontrails/http`, future `@ontrails/ws` | events-prd.md |
| Action relations (`relations` field) | Core | relations-prd.md |
| Detours (`detours` field) | Core | — |

### v2+ — Ecosystem

| Feature | Package | PRD |
| --- | --- | --- |
| Cross-app (`mount`) | Core + new packages | cross-app-prd.md |
| Action graph (`traverse`, `itinerary`) | `@ontrails/graph` | relations-prd.md |
| Junction (bidirectional peer) | — | — |
| Packs (capability bundles) | — | — |
| Depot (pack registry) | — | — |
| Daemon (registry lifecycle hosting) | `@ontrails/daemon` | — |
| Guide (runtime/build-time guidance) | `@ontrails/guide` | — |
| Warden (full governance suite) | `@ontrails/warden` | governance-prd.md |

---

## The Principle

Ship the core loop first: **define → collect → blaze → test**. Everything else builds on that loop without changing it.
