---
id: 41
slug: unified-observability
title: Unified Observability
status: accepted
created: 2026-04-09
updated: 2026-05-02
owners: ['[galligan](https://github.com/galligan)']
depends_on: [6, 13, 39]
---

# ADR-0041: Unified Observability

## Context

### Two packages, one concern

Trails currently ships two packages for understanding what an app does at runtime:

- **`@ontrails/logging`** — structured logging with sinks and formatters. The developer writes `ctx.logger.info('creating gist')`.
- **`@ontrails/tracing`** — execution recording with trace propagation. The framework writes a `TraceRecord` for every trail invocation via the execution pipeline.

These packages are configured separately, installed separately, and documented separately. But they serve the same fundamental need: tell me what happened in my app.

Both produce structured data. Both flow to sinks. Both ultimately end up in the same observability pipeline. OpenTelemetry already unifies logs, traces, and metrics as three signals in one system. The observability industry treats these as aspects of the same concern, not fundamentally different systems.

In practice, a developer setting up observability configures two packages, two sets of sinks, two init paths. The framework records traces automatically through `executeTrail`[^1], but the developer has to know that exists, install it, and configure it separately from their logging.

### The infrastructure is already in core

`executeTrail` is in core. `TrailContext` with its `logger` is in core. The `Logger` interface is in core. Trace context propagation flows through `TrailContext`, which is in core. The infrastructure for observability already lives where it belongs. The implementations just live in the wrong packages.

A new developer installing Trails today needs `@ontrails/core` and a trailhead package to get started. If they want to send runtime evidence somewhere durable, they have to understand separate logging and tracing packages, configure separate sinks, and wire them in. That is too much package and setup vocabulary before "hello world" has production-grade observability.

### The vocabulary question

"Tracker" is a branded term that requires explanation. Every new developer asks "what's a tracker?" Nobody asks "what's a trace." The observability industry has settled on standard vocabulary: logging, tracing, metrics. Trails does not need its own word for something the industry already named.

The progression from `crumbs` (cute, unclear) to `tracker` (honest, but branded) led to the right place structurally. The primitive works. The name does not need to be framework-specific when plain language does the job better.

### Authoring model differences are real but not packaging differences

Logging is explicit: the developer decides what to log. Tracing is implicit: the framework records execution without the developer doing anything. These are genuinely different interactions. One is authored, one is derived[^2].

But "different authoring model" does not require "different package." The developer's logger and the framework's automatic recording coexist in the same system with different entry points feeding the same pipeline.

## Decision

### Logging and tracing move into core

The `Logger` interface is already in core. The following join it:

- **Default console logger.** Structured logging to stdout with no configuration. Available on `ctx.logger` automatically.
- **Built-in tracing.** Automatic execution recording for every trail invocation, intrinsic to the `executeTrail` pipeline. Records which trail ran, how long, what result, what errors, which crossings happened, trace ID propagation. Not an optional layer the developer attaches — it just happens.
- **Trace record data model.** The `TraceRecord` interface describing one recorded execution footprint. The developer-facing word is "trace" (as verb and noun). The internal type is `TraceRecord` to avoid overloading "trace" (which can mean one record or an entire execution tree in industry usage). Records can describe trail execution, manual spans, signal lifecycle points, or activation boundaries.
- **Trace sink contract and registry.** Core owns the `TraceSink` contract, the process-level trace sink registry, and the `NOOP_SINK` disabled baseline. Core does not own durable or developer-configurable trace storage.
- **`ctx.trace()` method.** Manual sub-step recording within a blaze, replacing `tracker.from(ctx).track()`.

This also resolves the `tracingLayer` concern named in [ADR: Layer Evolution](drafts/20260409-layer-evolution.md): tracing is a core pipeline capability, not a user-authored layer.

A developer who installs `@ontrails/core` and `@ontrails/cli` gets:

```bash
trails run gist.create '{"description": "hello"}' --trace

● gist.create
  ├── db.insert ✓ 12ms
  ├── ↑ signal gist.created
  │   └─ → search.index (fired) ✓ 45ms
  └─ ✓ 62ms

{"ok": true, "value": {"id": "g_abc123", ...}}
```

No extra packages. No configuration. The framework traces automatically because tracing is in the execution pipeline.

### `ctx.trace()` as first-class API

The manual tracing API lives on `TrailContext`. Trail implementations use it for important internal work that warrants its own span within the automatic root trace:

```typescript
const result = await ctx.trace('db-query', async () => {
  return db.from(ctx).search(input.query);
});
```

The API is callback-based to guarantee closure. No raw `start` / `end` pair. Structural safety beats flexibility. Each `ctx.trace()` call creates a child `TraceRecord` parented to the current execution scope, inheriting the same `traceId`.

### How the execution pipeline records traces

`executeTrail`[^1] is the shared chokepoint every trailhead uses for every trail invocation. Tracing wraps it intrinsically:

1. **Before the blaze runs** — create a root `TraceRecord` with trail ID, intent, trailhead, and `traceId`. Write `traceId` and root record ID into execution scope.
2. **During execution** — `ctx.trace()` calls create child records parented to the current scope. When a trail crosses another trail, the child inherits the same trace and parent linkage through the shared execution scope.
3. **After the blaze completes** — close the root record with duration, status (`ok` | `err` | `cancelled`), and error category if applicable.

This is not an attached layer or gate. It is intrinsic to `executeTrail`. The developer does not install it, configure it, or opt into it. Every trail execution is recorded.

Storage stays flat. Each `TraceRecord` is an independent row with explicit lineage (`traceId`, `rootId`, `parentId`). Tree rendering happens at query time. Storage, retention, and export stay simple.

### Activation trace record contract

Activation uses a documented mix:

- Activated trail and signal records carry `trails.activation.*` provenance attributes.
- Runtime activation boundaries also emit `kind: "activation"` trace records when a real sink is installed.
- Boundary records parent the trail they activate when the materializer owns the trigger, such as schedule ticks and webhook delivery.
- Safety records capture activation that was intentionally suppressed before another trail could run.

The initial activation record names are:

| Record name | Meaning |
| --- | --- |
| `activation.scheduled` | A schedule materializer received a tick for a declared schedule source. |
| `activation.webhook` | The HTTP surface accepted a webhook source and invoked the receiving trail. |
| `activation.webhook.invalid` | A webhook source failed payload parsing before any receiving trail ran. |
| `activation.cycle_detected` | Signal fan-out safety suppressed a cyclic or over-depth activation chain. |

This keeps activation visible in traces even when no normal trail record exists, while avoiding a second event model beside `TraceRecord`. Activation records use the same flat lineage fields, status vocabulary, and sink path as trail, span, and signal records.

### Production observability in `@ontrails/observe`

`@ontrails/observe` is the public package for production and durable observability adapters. The first shipped surface is intentionally small and dependency-free: root exports for log/trace sink contracts, `combine(...)`, console/file log sinks, and bounded memory trace sinks. Connector packages can build on those contracts without importing framework internals directly.

| Initial primitive | Purpose |
| --- | --- |
| `combine(...sinks)` | Compose log and trace sinks into one `observe:` declaration. |
| `createConsoleSink(options?)` | Write log records to the process console. |
| `createFileSink(options)` | Append log records to a file; retention and rotation stay external. |
| `createMemorySink(options?)` | Retain bounded trace records for local tooling and tests. |

Future connector exports, such as OpenTelemetry export or a SQLite dev store, remain packaging decisions. They belong in or beside `@ontrails/observe`, but this ADR does not canonize exact subpath names or the complete connector set.

### Dev-time tracing vs production observability

The split is deliberate. Core handles the inner development loop. `@ontrails/observe` handles production.

| Concern | Core (intrinsic) | `@ontrails/observe` and connectors |
| --- | --- | --- |
| Logging | Console logger, `ctx.logger` | OTel export, file sinks, pretty formatter |
| Tracing | `TraceRecord`, `ctx.trace()`, propagation, sink registry, `NOOP_SINK` | Bounded memory sink, OTel export, SQLite dev store |
| Configuration | Zero — works out of the box | Connector-level options (sampling, batching, levels) |
| Dependencies | None beyond core | OpenTelemetry SDK, `bun:sqlite` |

A developer never needs `@ontrails/observe` to build, test, or debug locally. They need it when traces and logs must leave the process.

### Topo configuration

Observability follows the Trails posture: zero config by default, one declaration to customize.

The process-level sink registry still keeps `NOOP_SINK` as the disabled
baseline. Core owns that registry and the trace record contract, but not a
storage sink. Bounded memory tracing is a package-level sink exposed by
`@ontrails/observe` for app code and local tooling, and by `@ontrails/tracing`
as compatibility while the earlier tracing package migrates. Core does not
allocate trace records until a real sink is installed.

Without `@ontrails/observe`, the default execution path stays inert:

```typescript
const app = topo('myapp', trails)
// No process-level trace allocation until tooling or app code installs a sink
// Still zero configuration
```

For local tooling or production, plug in a connector or sink:

```typescript
import { createMemorySink } from '@ontrails/observe'

const app = topo('myapp', trails, {
  observe: createMemorySink({ maxRecords: 500 }),
})
```

The sink or connector owns the details: sampling rates, log levels, formatting, batching. These are connector configuration, not topo configuration. The topo says "observe with this." One declaration.

```typescript
futureOtelConnector({
  endpoint: 'https://otel.example.com',
  sampling: { read: 0.1, write: 1.0, destroy: 1.0 },
  logging: { level: 'warn' },
})
```

If a developer needs two outputs:

```typescript
import {
  combine,
  createConsoleSink,
  createFileSink,
  createMemorySink,
} from '@ontrails/observe'

const app = topo('myapp', trails, {
  observe: combine(
    createConsoleSink(),
    createFileSink('./logs/app.log'),
    createMemorySink({ maxRecords: 500 }),
  ),
})
```

Still one `observe:` declaration. The complexity lives in the connector, not the topo.

### Vocabulary changes

| Before | After |
| --- | --- |
| `tracker` | tracing (plain industry term) |
| `Track` | `TraceRecord` (internal type; developer-facing word is "trace") |
| `trackerGate` | built-in tracing (intrinsic to `executeTrail`, not a separately attached layer) |
| `tracker.from(ctx).track('name', fn)` | `ctx.trace('name', fn)` |
| `@ontrails/tracing` sinks | `@ontrails/observe` contracts and adapters |
| `@ontrails/logging` sinks | `@ontrails/observe` contracts and adapters |
| `crumbs` (original) | no longer relevant |

The developer-facing logger vocabulary does not change. `ctx.logger.info()`, `ctx.logger.error()` — these are already plain language.

### What core gains

Core ships the essential observability path. Nothing more.

```typescript
// Already in core:
Logger, TrailContext, executeTrail

// New in core:
TraceRecord                          // one recorded execution footprint
createConsoleLogger(options?)        // default logger, no deps
ctx.trace(name, fn)                  // manual sub-step recording
TraceSink, NOOP_SINK                 // sink contract and disabled baseline
registerTraceSink, getTraceSink      // process-level sink registry
// Built-in tracing intrinsic to executeTrail
```

Everything else — developer-configurable memory sinks, OTel, file sinks, SQLite dev stores, pretty formatters, sampling configuration — belongs in `@ontrails/observe` or compatibility/connector packages that build on the same contracts.

## Non-goals

- **Metrics.** Core does not ship a metrics primitive. If metrics are needed, `@ontrails/observe` can add a metrics connector. Trace data (duration, error rates) can be derived into metrics at the OTel layer.
- **Distributed tracing.** Trace context propagation across trail crossings within a single process is in scope. Propagation across network boundaries (cross-app) is a future concern for the mount/pack system.
- **Replacing OpenTelemetry.** The framework maintains a Trails-native model internally. OTel is the export format, not the internal representation. An OTel connector translates outward from `TraceRecord` to OTel spans.

## Consequences

### Positive

- **Two-package getting started.** `@ontrails/core` + `@ontrails/cli` gives a working app with logging and tracing. No extra installs for the inner development loop.
- **`trails run --trace` works out of the box.** Every getting-started guide and demo can show the execution tree. Every debugging session starts with "add `--trace`."
- **One observability config.** The developer plugs in one connector. Logs and traces flow through the same pipeline. No nested config objects, no growing DSL at the topo level.
- **Plain vocabulary.** "Logging" and "tracing" need no explanation. No branded terms for concepts the industry already named.
- **Fewer packages.** Two packages merge into one, and core absorbs the essentials. The total package count drops by one.

### Tradeoffs

- **Core grows.** Adding built-in tracing, the trace record model, and console logger to core increases its surface area. This is justified because `executeTrail` is already in core and tracing wraps it — the natural home for automatic recording is next to the thing being recorded.
- **Migration from earlier trace packaging.** Package imports and sink configuration restructure around `@ontrails/observe`. This is a pre-1.0 change, so the migration cost is limited to internal and early adopters.
- **Connector owns config details.** Sampling, log level, and formatting are connector concerns, not topo concerns. This keeps the topo config surface minimal but means developers configure observability behavior through their connector, not through a central config object.

### Risks

- **Core surface area creep.** If the boundary between "essential dev-time observability" and "production connector" is not held firmly, core accumulates features that belong in `@ontrails/observe`. The test: if it requires a dependency beyond core's existing set, it belongs in the observe package.
- **The `Track` to `TraceRecord` rename.** "Track" was a good Trails-native word that paired with "tracker." With tracker gone, `TraceRecord` is the plain-language internal type. The developer-facing word is just "trace" — as a verb (`ctx.trace()`) and as a CLI flag (`--trace`). The internal type name avoids overloading "trace" (which can mean one record or an entire execution tree in industry usage). Careful API naming is required.

## Non-decisions

- **The exact production connector set.** Which connectors `@ontrails/observe` ships at launch is a packaging decision, not an architectural one.
- **Replay or catch-up semantics.** Whether trace data supports execution replay is a separate concern.
- **Long-lived manual spans beyond the callback API.** A raw `start` / `end` pair may be needed eventually. The callback API is sufficient for v1.
- **Compliance-grade immutable audit retention.** Audit trails with tamper-evidence and retention policies are a future concern beyond observability.
- **Sampling strategy details.** Intent-based defaults (sample reads, keep writes and destroys) are directionally correct. The exact percentages and promotion-on-error semantics are implementation decisions.

## References

- [ADR-0006: Shared Execution Pipeline](0006-shared-execution-pipeline.md) — `executeTrail` is the chokepoint where tracing wraps. Moving tracing into core puts it next to the pipeline it instruments.
- [ADR-0013: Tracing](0013-tracing.md) — the runtime recording primitive this decision updates. The architectural choices (flat records, callback-only manual API, root-level sampling, crossing propagation through execution scope) remain valid. The change is packaging and vocabulary, not mechanism.
- [ADR-0039: Reactive Trail Activation](0039-reactive-trail-activation.md) — activation source boundaries define the runtime events this ADR makes observable through `activation.*` trace records.
- [ADR: Layer Evolution](drafts/20260409-layer-evolution.md) — identifies `tracingLayer` as framework behavior dressed as user configuration; this ADR resolves it by making tracing core.
- [Tenets: One write, many reads](../tenets.md) — the governing principle. Trace data authored once feeds `--trace` rendering, OTel export, SQLite dev store, and future replay.
- OpenTelemetry specification — the industry standard this aligns with for vocabulary and export format.

[^1]: [ADR-0006: Shared Execution Pipeline](0006-shared-execution-pipeline.md) — `executeTrail` as the shared chokepoint for every trail invocation
[^2]: [Tenets: The information architecture](../tenets.md) — authored vs derived information categories
