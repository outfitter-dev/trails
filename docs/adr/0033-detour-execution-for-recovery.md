---
id: 33
slug: detour-execution-for-recovery
title: Detour Execution for Recovery
status: accepted
created: 2026-04-11
updated: 2026-04-13
owners: ['[galligan](https://github.com/galligan)']
depends_on: [2, 6, 23, 32]
---

# ADR-0033: Detour Execution for Recovery

## Context

### The declarative-only state

Detours are already in the Trails lexicon as a trail-level field: *"recovery paths when the trail is blocked or fails. The trail blazes forward; if blocked, it detours."* See [ADR-0023](../0023-simplifying-the-trails-lexicon.md) for the vocabulary definition and the deliberate `blaze`-pair metaphor. The shape of `TrailSpec.detours` — an array of `{ on: ErrorClass, recover: Function }` — has existed as a declarative-only concept since the earliest iterations of the trail primitive.

What hasn't existed is **runtime execution**. No component of [`executeTrail`](../0006-shared-execution-pipeline.md) reads the `detours:` field today. A trail can declare a detour for `ConflictError`, but if the blaze returns `Result.err(new ConflictError(...))`, the framework propagates the error unchanged. The detour is a comment with type safety attached.

This has two concrete consequences:

1. **The reconcile factory carries an inline try/catch carve-out.** The store's reconcile trail needs real conflict recovery to function. Because detours are declarative-only, the factory implements recovery inline — a `try { ... } catch (ConflictError) { ... }` block inside the blaze. `AGENTS.md` carries a narrow exemption permitting this pattern for factory-provided trails only. The exemption has existed since the reconcile factory landed and was always meant to be temporary.

2. **Declarative recovery is invisible to every governance system the framework provides.** Survey can't report it. Warden can't enforce its coverage. The resolved graph doesn't include it. An agent inspecting an unfamiliar app reads `detours: [...]` on a trail spec with no runtime guarantee that the declaration affects behavior.

### Why this matters for the queryable-contract tenet

[ADR-0000's premise that the contract is queryable](../0000-core-premise.md#the-contract-is-queryable) depends on declarations being load-bearing at runtime. When a field exists on the trail spec but does nothing, readers can't trust the contract. The framework has said "recovery lives here" and then not honored it.

The framework has already done the authoring work: `TrailSpec.detours` is a typed field, authors can fill it in, the TypeScript compiler enforces the shape. What's missing is the projection step — reading the authored data and executing it. That's what this ADR settles.

### Why now

Three workstreams converge on this need:

- **Reconcile factory refactor.** The inline try/catch has to retire so `AGENTS.md` can delete the carve-out. Requires detour runtime.
- **Reconcile retry exhaustion.** Today the factory uses `ReconcileRetryExhaustedError`, a local error class meaningful only to reconcile. A framework-level runtime needs a general-purpose `RetryExhaustedError` in the taxonomy.
- **Future `deriveTrail` detour synthesis.** [ADR-0032](../0032-derivetrail-and-trail-factories.md) makes `deriveTrail` synthesize default blazes for standard CRUD operations. A natural extension is synthesizing default detours from store declarations (e.g., `ConflictError` recovery for versioned tables). That extension is out of scope for this ADR, but requires a runtime that treats detours uniformly regardless of source.

## Decision

**Detours are authored, never invoked.** When a trail declares a detour, the framework runs the detour recovery loop without the caller needing to know it exists. Callers of a trail — CLI, HTTP, MCP, another trail via `ctx.cross()` — get the declared recovery semantics automatically. There is no `.withDetours()`, no opt-in, no callsite-aware dispatch. Detours are part of what the trail *is*.

### `TrailSpec.detours` is the runtime primitive

One level, one field, on the trail spec. No resource-level detour primitive, no accessor-proxy machinery, no cross-level composition algorithm.

```typescript
interface TrailSpec<Input, Output> {
  // ...existing fields...
  detours?: readonly Detour<Input, Output, TrailsError>[];
}

interface Detour<Input, Output, TErr extends TrailsError> {
  readonly on: abstract new (...args: any[]) => TErr;
  readonly maxAttempts?: number;  // default 1, hard cap 5
  readonly recover: (
    attempt: DetourAttempt<Input, TErr>,
    ctx: TrailContext
  ) => Promise<Result<Output, TrailsError>>;
}

interface DetourAttempt<Input, TErr extends TrailsError> {
  readonly attempt: number;  // 1-indexed
  readonly error: TErr;      // the matched error
  readonly input: Input;     // original trail input
}
```

### Execution loop, inside the layer stack

`executeTrail` runs the detour loop **inside** the layer stack, closest to the blaze, and **before** the non-`TrailsError` error wrap. Layers see one logical execution with the final result; detour attempts are invisible to them.

```text
┌─ executeTrail ─────────────────────────────────────────┐
│ validate input                                          │
│ ┌─ layers (auth, tracing, framework retry, ...) ─────┐ │
│ │ ┌─ detour loop ────────────────────────────────┐  │ │
│ │ │ loop attempt:                                  │  │ │
│ │ │   result = await blaze(input, ctx)             │  │ │
│ │ │   if Ok → return                               │  │ │
│ │ │   if error not in any detour.on → return       │  │ │
│ │ │   recovered = await detour.recover(...)        │  │ │
│ │ │   if Ok → return                               │  │ │
│ │ │   if maxAttempts exhausted → RetryExhausted    │  │ │
│ │ └──────────────────────────────────────────────┘  │ │
│ └───────────────────────────────────────────────────┘ │
│ catch non-TrailsError → InternalError                  │
└────────────────────────────────────────────────────────┘
```

**`ctx` is single-valued across attempts.** The same `TrailContext`, the same `ctx.logger`, the same tracing spans. Layer state (auth tokens, rate-limit counters, log scopes) fires once per logical execution, not per retry attempt. This is deliberate: telemetry of a trail run should show one logical operation with internal retries, not N independent runs.

**Non-`TrailsError` throws never reach detours.** If the blaze throws a plain `Error`, step 5 of the [shared execution pipeline](../0006-shared-execution-pipeline.md) wraps it in `InternalError` at the outermost boundary. That wrapping happens *outside* the detour loop, so detours can only match against explicit `Result.err(TrailsError)` returns. This preserves the existing pipeline contract.

### `maxAttempts` counts recovery attempts, not total

Default `1`, hard cap `5`. `maxAttempts: 1` means *"the blaze runs once, and if it fails with a matching error, we call `recover` once."* The first blaze attempt is always free and is not counted. Attempts beyond the cap are ignored with a warning — the framework will not retry indefinitely even if a user declares `maxAttempts: 100`.

### Matching by declaration order

When multiple detours could match an error, the framework runs the first one declared. **No most-specific-first class-hierarchy walking.** Declaration order is the rule, for three reasons:

1. **Predictability.** Authors know exactly which detour will run by reading the spec top-to-bottom.
2. **No runtime reflection.** Most-specific-first requires walking `instanceof` chains to compare distances. The framework does not otherwise inspect the class hierarchy at runtime and should not start here.
3. **The warden catches the drift case.** When detour A's `on:` type is a supertype of detour B's `on:` type and A is declared before B, B is unreachable. This is a lint-time diagnostic, not a runtime behavior. Authors who get the order wrong get an error at build time, not a silent mismatch at runtime. A warden rule for detecting unreachable detours is planned as a follow-up.

### No cross-detour recovery

If a detour's `recover` function returns `Err` with a *different* error type, a different detour does **not** match and run. Detour recovery only re-enters the same detour's own attempt loop. Otherwise nested recovery chains become impossible to reason about: any error becomes potentially reachable from any starting error class, and reasoning about *"what happens if X fails"* requires walking a dynamic graph.

If `recover` returns an error whose class does not match the same detour's `on:` type (e.g., a `ConflictError` detour whose `recover` returns `NetworkError`), the framework returns that error to the caller directly. The detour loop terminates; no further matching happens.

Non-`TrailsError` throws inside `recover` follow the same rule as the blaze: they get wrapped in `InternalError` at the outermost pipeline boundary and terminate the loop without re-entering matching.

### `RetryExhaustedError<TErr>` in the core taxonomy

When a detour's retry attempts exhaust, the framework returns a `RetryExhaustedError<TErr>` that preserves the original error via `cause`:

```typescript
class RetryExhaustedError<TErr extends TrailsError> extends TrailsError {
  readonly cause: TErr;

  constructor(wrapped: TErr, metadata: { attempts: number; detour: string }) {
    super(
      `Recovery exhausted after ${metadata.attempts} attempts: ${wrapped.message}`
    );
    this.cause = wrapped;
    // Inherit the wrapped error's category for trailhead mapping
    this.category = wrapped.category;
    // But override retryable to false at the instance level (see below)
    this.retryable = false;
  }
}
```

The category inheritance is the important part. A `RetryExhaustedError<ConflictError>` reports `category: 'conflict'`, so trailheads map it to HTTP 409 and exit code 3 — the same way a bare `ConflictError` would. Callers see the semantic underlying problem, not a synthetic wrapper with its own mapping.

The instance-level `retryable: false` override is load-bearing for a different reason, covered next.

### `TrailsError.retryable?: boolean` — an instance-level override

Today the framework's error taxonomy carries `retryable` as a category-level property (e.g., the `timeout` category is retryable, the `conflict` category is not). This ADR introduces an optional instance-level override:

```typescript
abstract class TrailsError extends Error {
  // ...existing fields...
  readonly retryable?: boolean;  // optional instance-level override of category default
}
```

For normal errors, `retryable` is undefined and any retry-aware machinery falls back to `this.category`'s retryable flag — **no behavior change for existing code**. For `RetryExhaustedError` instances, the constructor sets `retryable = false` regardless of the wrapped error's category.

**Why this matters:** a future framework retry layer (see Out of Scope) honors `retryable: true` categories automatically. Without the instance-level override, `RetryExhaustedError<NetworkError>` would carry `category: 'network'`, which is retryable, and the retry layer would re-retry an already-exhausted recovery across `ctx.cross()` boundaries or stacked layers. Runaway amplification.

The instance-level override encodes the semantic principle in the error itself: *if a detour was declared, the author decided intelligent recovery was the right strategy. If the detour exhausts, falling back to a dumb category-level retry is a regression.* Any future retry machinery respects this automatically, without needing to know about `RetryExhaustedError` specifically.

**Precedent.** `RateLimitError` already carries instance-level retry metadata (`retryAfterMs`). Generalizing `retryable` as an instance-level optional override fits the existing pattern.

### `TrailSpec.blaze` remains required

Detours are recovery from blaze failure. They do **not** replace the blaze. `TrailSpec.blaze` remains required at the type level, and any trail that declares `detours:` must also have a blaze — either authored directly on the trail or synthesized by a factory such as `deriveTrail`. A trail without a blaze is not runnable, and the framework does not attempt to run a detour loop against an absent primary path.

This is the status quo; the ADR states it explicitly to preempt the natural reader question *"could a trail be purely detours?"* The answer is no. The blaze is the trail's unique contribution; detours are framework machinery that wraps the contribution.

### The layer–detour boundary

This ADR establishes a normative rule for when to write a detour versus when to write a layer:

> **A detour declares an `on:` error class. A layer does not.**
>
> If your layer is inspecting `result.error` and branching on type, you should have written a detour. The warden flags layers that `instanceof`-check errors as drift toward undeclared detours.

Layers are for things that don't depend on *which* error fired — tracing, auth, observability, rate-limit bookkeeping. Detours are for things that do. Authors never have to decide *"is this a layer or a detour?"* because the rule is mechanical.

### Logging

Each detour attempt emits a `debug`-level log entry with `{ attempt, maxAttempts, errorClass, matchedDetour }`. Without it, a retry loop is invisible unless the tracer is active.

### Tracing

Each detour attempt is a child span of the trail's root span. A trace of one trail run shows N attempts nested inside, with the attempt number and matched error class as span attributes. Debuggers can see exactly which attempt succeeded, which failed, and how long recovery took.

### Sources of detours

`TrailSpec.detours` can be populated from more than one source at build time:

1. **Authored** — the trail author writes `detours: [...]` explicitly on the trail spec. Used when recovery requires domain knowledge the framework can't derive — custom merge semantics, application-specific logic, branch resolution.
2. **Derived** — a factory such as `deriveTrail` may synthesize detours from other authored information (e.g., a store table's `version:` field implying `ConflictError` recovery for update operations). The synthesis rules themselves are out of scope for this ADR; see Out of Scope.

Runtime treats both uniformly. The detour loop doesn't know or care whether a detour was authored or derived. Provenance appears in the resolved graph for warden and survey to reason about, but the execution pipeline sees one field.

## Consequences

### Positive

- **Declarative recovery is load-bearing at runtime.** The `detours:` field is no longer a comment; it's a projection input. The [queryable-contract tenet](../0000-core-premise.md#the-contract-is-queryable) now covers recovery paths alongside schemas, examples, and crosses.
- **The reconcile factory's inline try/catch retires.** The `AGENTS.md` carve-out permitting inline recovery for factory-provided trails deletes. Replaced by a declarative `detours: [{ on: ConflictError, maxAttempts: 1, recover: ... }]` on the reconcile trail's spec.
- **`ReconcileRetryExhaustedError` retires** in favor of the framework-level generic `RetryExhaustedError<TErr>`. Consumers of reconcile see a standard framework error with the wrapped `ConflictError`'s category preserved.
- **Detours compose with `ctx.cross()` transparently.** When trail A crosses trail B, and B fails with an error that matches A's detour, B's full pipeline runs first (including B's detours). Whatever error escapes B is seen by A's blaze as an `Err` and enters A's detour loop. Recursive composition works without any special casing.
- **Future-compatible with scenario-based testing.** Because detours are declarative, a future scenario DSL can inject failures and verify recovery mechanically. Warden can check that every declared detour has at least one example that triggers it. Not in this ADR, but the architecture leaves the door open.
- **Future-compatible with `deriveTrail` synthesis.** The "cross-trail reuse" benefit — declare a recovery pattern once, get it applied to every trail that matches — arrives via derivation rather than via a new runtime primitive. See Out of Scope.

### Tradeoffs

- **The error taxonomy gains an explicit `retryable` override in `RetryExhaustedError`.** `TrailsError.retryable` remains a required `boolean` on all concrete subclasses. `RetryExhaustedError` sets it to `false` at the class level regardless of the wrapped error's category, preventing category-level retry machinery from re-retrying an already-exhausted recovery loop.
- **`RetryExhaustedError` has a dynamic category.** Usually error classes have static categories determined at class definition. `RetryExhaustedError` is unusual in that its category is copied from the wrapped error at construction time. Tests must exercise this behavior explicitly.
- **The layer stack gains a fixed position.** The detour loop sits at a specific location relative to layers (inside the layer stack, just outside the blaze). Authors don't choose where it goes. This removes a degree of flexibility but eliminates a whole class of ordering bugs.
- **Declaration-order matching requires discipline.** Authors who declare a supertype detour before a subtype detour will get a warden warning once the unreachable-detour rule ships as a follow-up. Until then, mis-ordered detours are a silent no-op at runtime.

### What this does NOT decide

- **Framework retry layer for `retryable: true` errors.** The taxonomy already carries a `retryable` flag per category (`timeout`, `network`, `rate_limit` are retryable; `conflict`, `permission`, `validation` are not). A framework-provided layer — default-on in every topo, positioned just outside the detour loop — is expected to honor this flag with configurable backoff. **This ADR does not define that layer.** Detours handle typed recovery keyed by specific error classes; the retry layer handles category-level retry for errors with no domain-specific recovery. The two compose by construction — detours match on class, the retry layer matches on category, and `RetryExhaustedError` always sets `retryable: false` at the instance level to prevent amplification across `ctx.cross()` boundaries or stacked layers.

- **Resource-level recovery declarations.** A mechanism for resources to declare their own recovery policies that would apply uniformly to every trail using them is deliberately out of scope. The current set of concrete failure modes in the Trails ecosystem is adequately served by (a) the framework retry layer for retryable errors, (b) authored trail-level detours for domain-specific recovery, and (c) `deriveTrail` synthesis for store-implied recovery. When resource-specific recovery semantics emerge as a concrete need — particularly for third-party connectors with protocol-specific retry, OAuth token refresh on 401, or other credential-aware recovery actions — a future ADR should address it directly, building on the trail-level runtime defined here. The `detours` vocabulary is pinned to trails by [ADR-0023](../0023-simplifying-the-trails-lexicon.md) ("the trail blazes forward; if blocked, it detours"); if resource-level recovery lands, it needs its own word. A prerequisite is that framework errors remain backend-agnostic — no `SqliteBusyError`, no `DbBusyError`, backend-specific conditions must normalize at the connector boundary.

- **`deriveTrail` synthesis of detours.** A future ADR, extending or companioning [ADR-0032](../0032-derivetrail-and-trail-factories.md), will specify when `deriveTrail` synthesizes detours from store declarations. Likely targets: versioned tables synthesizing `ConflictError` recovery with a default merge strategy (server-generated fields preserved from current, user-authored fields merged from incoming). This ADR ensures the runtime treats derived detours the same as authored detours; the synthesis rules themselves are deferred.

- **Scenario-based testing.** A future ADR may introduce scenario syntax on trail examples (e.g., *"given this resource fails on the first call, verify the detour recovers"*). Because detours are declarative, such scenarios fall out as a pure extension of the existing examples model. This ADR makes no commitment about their shape.

- **Trail-ID references as `recover` targets.** Currently `recover: Function`. A future extension may allow `recover: Function | TrailId`, where the trail ID references another trail whose blaze implements the recovery logic. This is a non-breaking extension and will be scoped by its own ADR when it lands. Nested-recovery semantics (what happens when the referenced trail has its own detours) require specific care.

- **Multi-process retry coordination.** Detour retries are in-memory only. If the process dies mid-retry, the operation is lost. This mirrors the single-process stance of the built-in `@ontrails/store/jsonfile` backend. Durable retry across process restarts is not a goal.

- **Warden rules beyond unreachable-detour detection.** Additional rules (e.g., "layers that `instanceof`-check errors are drift toward undeclared detours," "every declared detour has an example that triggers it") are worth building but are not defined by this ADR. The declaration-order unreachability check is planned as a follow-up (see Tradeoffs); others follow.

## References

- [ADR-0000: The contract is queryable](../0000-core-premise.md#the-contract-is-queryable) — the tenet that obligates declarative recovery to be load-bearing at runtime.
- [ADR-0000: Validate at the boundary, trust internally](../0000-core-premise.md#validate-at-the-boundary-trust-internally) — detours operate inside the validated-input contract; `recover` receives trusted input.
- [ADR-0002: Built-In Result Type](../0002-built-in-result-type.md) — detours match on `Result.err(TrailsError)` values, preserving the throw-free pipeline invariant.
- [ADR-0006: Shared Execution Pipeline](../0006-shared-execution-pipeline.md) — the pipeline this ADR extends. The detour loop inserts between layer composition and the non-`TrailsError` error wrap.
- [ADR-0023: Simplifying the Trails Lexicon](../0023-simplifying-the-trails-lexicon.md) — the vocabulary ruling that pins `detour` to trails via the `blaze`-pair metaphor.
- [ADR-0032: deriveTrail and Trail Factories](../0032-derivetrail-and-trail-factories.md) — the synthesis mechanism that may populate `TrailSpec.detours` from store declarations in a future extension.
- [AGENTS.md — factory-provided trails carve-out](../../../AGENTS.md) — the temporary exemption for inline recovery in factory-provided trails, retiring when the reconcile factory refactors to declarative detours.
