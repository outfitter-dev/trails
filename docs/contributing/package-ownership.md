# Package Ownership Map

This map is a bounded first pass for [TRL-1110](https://linear.app/outfitter/issue/TRL-1110/). It records where cross-cutting capabilities naturally belong, where current code already follows that ownership, and where code still carries duplicate or mis-parked kernels.

Use this as a contributor guide, not as a complete archaeology ledger. When a capability is not audited yet, this document says so directly instead of letting broad language imply certainty.

## Ownership Test

Every reusable kernel should have one owner.

The owner is the lowest package where the concept is still coherent and reusable. Call that the capability's natural altitude.

This means:

- Put the kernel where its domain lives.
- Export the smallest stable contract other packages need.
- Let higher packages compose or render the owner contract.
- Do not copy logic into a consumer because importing the owner feels inconvenient.
- If a consumer needs a different behavior, decide whether the owner contract is missing a real extension point or whether this is a distinct capability.

The review question:

> Can this package consume an owner-owned contract, or is it quietly re-authoring the same concept?

## Status Vocabulary

| Status | Meaning |
| --- | --- |
| `owned` | The owner is clear and consumers already import from it. |
| `migration` | The owner is clear, but consumers still carry duplicate logic. |
| `proposal` | The owner is likely, but the extraction still needs a focused issue or implementation plan. |
| `distinct` | Similar shape is intentional and should not be merged. |
| `unknown` | Not audited in this first pass. |

## Current Map

| Capability | Natural owner | Consumers | Status | Evidence and next move |
| --- | --- | --- | --- | --- |
| Glob-to-regexp escaping and matching | `@ontrails/core` | Warden, Regrade, adapter-kit, release tooling | `owned` | `escapeRegExp` and glob helpers already live in `packages/core/src/glob.ts`; prior cleanup moved consumers to core. |
| Path-scope grammar | `@ontrails/core` | Warden, Regrade, Trails CLI | `owned` | `PathScope` and `pathScopeSchema` live in `packages/core/src/path-scope.ts`. Consumers should use `include`, `exclude`, and `extensions`; do not reintroduce Regrade `ignore` or Warden `jurisdiction`. |
| Workspace package discovery | `@ontrails/core` | adapter-kit, Warden, app loading | `owned` | `listWorkspacePackages` belongs beside workspace-root discovery in `packages/core/src/workspace.ts`; this is the owner for workspace manifest expansion. |
| Diagnostic base shape | `@ontrails/core` | Warden, permits, adapter-kit, future diagnostics | `owned` | `DiagnosticBase` and `DiagnosticSeverity` live in `packages/core/src/diagnostics.ts`. Location-specific diagnostic shapes stay with their domains. |
| Surface error projection | `@ontrails/core` | CLI, MCP, HTTP, Warden coverage | `owned` | `packages/core/src/transport-error-map.ts` owns surface error mapping. Surfaces consume it. |
| Schema-derived fields | `@ontrails/core` | CLI, MCP, docs, examples | `owned` | Field derivation belongs with schema and trail contract logic, not individual surfaces. |
| Config merge and resolution primitive | `@ontrails/config` today | Trails app config, future adopter config | `owned` | `@ontrails/config` is the current package owner for schema-validated config loading. Future work may revisit package placement, but consumers should not reimplement merge and file loading. |
| Signal trace record construction and writing | `@ontrails/core` | `@ontrails/tracing`, signal runtime | `owned` | Core exports `createSignalTraceRecord` and `writeSignalTraceRecord`; tracing re-exports them for compatibility instead of forking record construction and sink writing. |
| Bounded memory trace sink | `@ontrails/observe` | `@ontrails/tracing`, CLI trace rendering, tests | `owned` | Observe owns `createMemorySink` and `DEFAULT_MEMORY_SINK_MAX_RECORDS`. Tracing keeps a compatibility wrapper over the observe sink without a second retained-record implementation. |
| Tracing dev-state store | `@ontrails/tracing` | tracing query/status trails, local dev tooling | `owned` | SQLite dev store, trace store registry, cleanup helpers, and query/status trails remain tracing-owned because they are developer-state tooling, not production sink contracts. |
| OpenTelemetry trace adapter | `@ontrails/tracing/otel` for v1 | users exporting traces | `owned` | ADR-0041 keeps the v1 OTel adapter at the current `@ontrails/tracing/otel` subpath. It is an adapter boundary, not an observe memory-sink contract. |
| Activation graph derived facts | `@ontrails/topography` | Trails app topo reports | `owned` | Prior cleanup moved activation-derived facts to Topography so app reports do not re-project the activation graph. |
| Stable topo hashing | `@ontrails/topography` | watch mode, topo artifacts | `proposal` | `apps/trails/src/run-watch.ts` has carried stable JSON hashing parallel to `packages/topography/src/hash.ts`. Proposed extraction: expose the Topography-owned stable hash needed by watch mode. |
| Adapter source scanning | `@ontrails/adapter-kit` | adapter generator, adapter checks/catalog | `owned` | `packages/adapter-kit/src/source.ts` owns reusable source export scanning; `create.adapter` and adapter catalog conformance checks consume that shared contract. |
| Public/internal export-map boundary checks | `@ontrails/warden` plus source facts from packages | repo governance | `proposal` | Warden should encode the durable rule, but packages own their export maps. Do not move package export truth into Warden. |
| Topo summary facts for read/report trails | likely Trails app or Topography, depending on fact | Trails CLI reports, Wayfinder | `unknown` | `buildCurrentTopo*` naming drift was identified, but the ownership split still needs a focused pass: pure graph facts belong lower; presentation-specific summaries may remain app-owned. |
| Serialization and lock IO | Topography and Trails app split | compile, validate, Wayfinder | `unknown` | Not audited in this first pass. Future map update should separate lock schema ownership from CLI file IO. |
| Markdown rendering | package that owns the content domain | docs, Warden guide, release notes | `unknown` | Not audited in this first pass. Do not extract until a real duplicate has evidence and a clear owner. |
| CLI argument parsing | Trails app CLI surface | CLI routes and commands | `unknown` | Not audited in this first pass. Parsing can stay surface-owned unless it reimplements contract derivation. |

## Captured-Kernel Review

The advisory `captured-kernel` Warden rule identifies one ownership-review signal: a non-root public package subpath re-exports its own internal source and at least two distinct production packages consume that subpath. The warning is evidence to review the owner, not proof that the current package is wrong.

`@ontrails/topography/backend-support` is the current named watch case. Its internal-backed subpath remains legitimate because the Trails operator is its only production external consumer; Warden exercises it only in tests, which do not satisfy the rule's consumer threshold. Revisit the boundary if a second independently owned production capability begins to consume it.

Moving a captured kernel into `@ontrails/source` is conditional. The machinery must be reusable source analysis shared by at least two independent toolchain capabilities, expose one genuinely shared contract, and own no verdict policy, migration plan, graph query, or surface rendering. Otherwise, preserve the current owner or choose another doctrinal owner.

## Proposed Extractions

These are open findings from the map. They are not newly created Linear issues in this branch.

| Finding | Proposed extraction | Why it belongs there |
| --- | --- | --- |
| Stable topo hash duplicate | Expose or consume the Topography-owned stable hash from watch mode. | Topography owns topo artifact identity. |

## Tracked Unknowns

These were named in [TRL-1110](https://linear.app/outfitter/issue/TRL-1110/) or the audit notes but are not fully decomposed in this first pass:

- serialization and lock IO;
- markdown rendering;
- CLI argument parsing beyond route derivation;
- detailed topo summary/report fact ownership;
- future config-package placement if `@ontrails/config` is folded into a core-facing API;
- broader public/internal export ownership beyond Warden rule shape.

Do not treat these as settled. Treat them as explicit follow-up slots for the next ownership-map revision.

## Distinct On Purpose

Do not merge these just because the code shape looks similar:

- `get`, `read`, `find`, and `list` have distinct meanings documented in the language styleguide.
- Path globs and trail-id globs are different grammars.
- Warden rule scaffolding can repeat when the repeated shape makes each rule easier to inspect.
- HTTP and MCP surface rendering can look symmetrical without being duplicate ownership.

## References

- [ADR-0001: Naming Conventions](../adr/0001-naming-conventions.md)
- [ADR-0009: First-Class Resources](../adr/0009-first-class-resources.md)
- [ADR-0041: Unified Observability](../adr/0041-unified-observability.md)
- [Code Standards](./code-standards.md)
