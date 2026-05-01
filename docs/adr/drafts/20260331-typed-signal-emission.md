---
slug: typed-signal-emission
title: Typed Signal Emission
status: draft
created: 2026-03-31
updated: 2026-05-01
owners: ['[galligan](https://github.com/galligan)']
depends_on: [2, 3, 6, 7, 13]
---

# ADR: Typed Signal Emission

## Context

### Signals are declared but inert

The `signal()` primitive exists in Trails. It declares a named signal with a typed schema. Signals are registered in the topo. Survey reports them. But there's no runtime story. There's no way for a trail to fire a signal. There's no delivery mechanism. There's no local consumer path. The primitive is structural metadata, not a runtime capability.

The schema is declared. The topo knows about it. But no trail can say "this happened." The signal is a contract with no runtime.

### What runtime firing enables

When a trail can announce what happened, the framework gains a communication layer between trails that doesn't require direct coupling:

- A billing pack fires `billing.payment-completed`. A notification pack activates and sends a receipt. Neither pack knows the other exists. They're connected by the signal contract.
- A trail fires `entity.updated`. A search indexer, a cache invalidator, and an audit logger all respond. The producing trail doesn't know about any of them.
- A future scheduled health check source fails. If a later ADR accepts
  framework-authored lifecycle signals, an alerting trail could activate without
  manual error handler wiring.

Without signals as a runtime primitive, these patterns require either direct crosses (tight coupling between packs) or application-level glue code. Signals provide the decoupling.

### Schema always exists

A trail that calls `ctx.fire(bookingConfirmed, payload)` is passing a typed
payload through a signal contract object. The schema exists because the signal
contract owns it. The framework can validate the payload at the fire boundary
without requiring a second declaration in the blaze.

This means signals follow the same progressive disclosure as everything else in Trails:

1. **Authored as a signal contract.** The developer writes `signal()` once. The
   schema gives `ctx.fire()` its payload type and gives the runtime its
   validation boundary.
2. **Declared on producers and consumers.** `fires` and `on` connect trails to
   the signal contract without duplicating its schema.
3. **Projected into the graph.** The topo, lockfile, survey output, examples,
   diagnostics, and trace records all read the same signal ID and payload
   schema.

At every stage, a schema exists. Typed-signal v1 chooses the signal contract as
the schema owner.

### The framework already observes future signal candidates

Every time `executeTrail` runs, the framework knows what happened: which trail, what input, what result, how long, what errors. This is information the framework observes but currently only records to tracing. A later ADR could decide to expose lifecycle signals for these observations:

- Trail completed → `trail.completed` signal
- Trail failed → `trail.failed` signal (with error class and category)

Typed-signal v1 does not make those lifecycle signals real. It keeps the
runtime shape focused on authored `signal()` contracts and records handler
failures as diagnostics and trace observations. A later ADR can decide whether
observed trail lifecycle data should become public signal vocabulary.

### Dead signals are a real problem

A signal fired to zero local consumers is easy to miss. The trail succeeded. The
Result is ok. But the announcement went nowhere.

The framework should make dead signals visible through the evidence v1 actually
has: types catch wrong payloads, examples verify authored fires, Warden can
compare `fires`/`on` declarations where hooks exist, tracing records fired
signals and handler records, and survey shows the activation graph.

### Typed-signal v1 is intentionally narrow

The first runtime shape turns authored `signal()` contracts into typed,
observable notifications. It does not turn Trails into a general event bus.

Typed-signal v1 is the smallest contract that makes the primitive live:

- A trail declares authored signal edges with `fires: [signal]` and
  `on: [signal]`.
- A blaze calls `ctx.fire(signal, payload)` with a signal contract object and a
  schema-typed payload.
- Invalid payloads produce diagnostics and trace records. They do not become a
  producer-facing `Result`.
- The topo, lockfile, survey output, and tracing layer expose signal
  relationships from real authored and observed data.

Anything beyond that boundary needs its own decision. That includes framework
lifecycle signal families, external delivery surfaces, retry policies,
dead-letter handling, schedule or webhook source materialization, and any new
public API beyond `ctx.fire(signal, payload)`.

## Decision

### `ctx.fire(signal, payload)` on the execution context

Trails fire signals through the execution context:

```typescript
const confirmBooking = trail('booking.confirm', {
  intent: 'write',
  input: BookingInputSchema,
  output: BookingSchema,
  fires: [bookingConfirmed],
  blaze: async (input, ctx) => {
    const booking = await confirmInStore(input);

    await ctx.fire(bookingConfirmed, {
      bookingId: booking.id,
      userId: input.userId,
      confirmedAt: new Date().toISOString(),
    });

    return Result.ok(booking);
  },
});
```

`ctx.fire()` takes a signal contract object and a typed payload. It does not
accept a public string-ID overload. The payload validates against the signal's
schema at runtime. The fire path is best-effort from the trail's perspective:
the trail waits only for the framework to validate, record, and dispatch the
local notification attempt. It does not receive a producer-facing delivery
`Result`, and it does not know which consumers ran.

`ctx.fire()` is available in any trail, including within `cross` chains. A
crossed trail's signals flow through the same runtime path as the root trail's
signals.

### The `fires` declaration

A trail declares which signals it may fire:

```typescript
fires: [bookingConfirmed, bookingCancelled],
```

This is analogous to `crosses` declaring which trails may be called. The warden verifies alignment:

- A `ctx.fire(someSignal)` call in the blaze without a corresponding entry in `fires`: error. Undeclared fire.
- A signal in `fires` that is never fired in the blaze: warning. Unused declaration.
- A trail with `intent: 'read'` that declares `fires`: warning. Read trails observe, they shouldn't announce state changes.

The `fires` declaration is optional. A trail without `fires` cannot call
`ctx.fire()` (the warden catches this). Progressive adoption: add `fires` when
the trail needs to announce something.

### Progressive signal contract ownership

Signals follow the same progressive disclosure pattern as every other Trails concept:

**Stage 1: Authored contract.** The developer declares `signal()` once. The
signal contract owns the payload schema, gives `ctx.fire(signal, payload)` its
payload type, and gives the runtime a single validation boundary.

**Stage 2: Producer and consumer edges.** Trails reference the signal contract
through `fires` and `on`. These edges connect trails to the contract without
duplicating its schema on either side.

**Stage 3: Graph and runtime projections.** The topo, lockfile, survey output,
examples, diagnostics, and trace records expose the same signal contract and
the relationships around it. Runtime observations can prove whether the
authored edges are being exercised, but they do not become a second schema
source.

At every stage, `signal()` owns the schema. Producing trails reference it.
Consuming trails validate against it. The signal is a first-class node in the
topo graph and the lockfile.

The warden's role at each stage:

- Stage 1: "This signal contract is declared but no trail references it."
- Stage 2: "This trail fires `booking.confirmed` without declaring it in `fires`."
- Stage 2: "This trail declares `fires: [bookingConfirmed]` but never fires it."
- Stage 3: "This signal is fired but has no local consumers; confirm that the
  dead edge is intentional or add an `on` consumer."

### Signal fire examples

Examples can assert which signals were fired during execution:

```typescript
examples: [
  {
    name: 'successful confirmation',
    input: { slotId: 'slot_1', userId: 'user_1' },
    expected: { bookingId: 'bk_1', status: 'confirmed' },
    signals: [
      {
        signal: bookingConfirmed,
        payload: { bookingId: 'bk_1', userId: 'user_1' },
      },
    ],
  },
  {
    name: 'already confirmed (idempotent)',
    input: { slotId: 'slot_1', userId: 'user_1' },
    expected: { bookingId: 'bk_1', status: 'already_confirmed' },
    signals: [],
  },
],
```

`testExamples` captures all signal fires during execution and validates them
against the example's positive `signals` assertions. An empty `signals` array
means the example has no positive signal expectations; a future no-fire
assertion form can make duplicate-suppression examples explicit without
overloading an empty list.

### Consumption-side examples

Signal fire examples validate the trail that announces. Consumption examples
validate the trail that reacts. For typed-signal v1, examples can assert the
signals a trail fires without implying a full durable reactive test runner.

Deferred activation sources need their own example doctrine:

- **Webhook and durable signal deliveries** may receive duplicates. If accepted
  later, include idempotency examples where the same payload arrives twice.
- **Schedule-triggered trails** may fire when there's nothing to process. If
  accepted later, include empty-result examples.
- **Trails triggered by `trail.failed.*` lifecycle signals** would be error
  handlers. If accepted later, include examples for each error category and
  assert `signals: []` to avoid reactive error cascades.

### Framework lifecycle signals

Framework lifecycle signal families are not part of typed-signal v1. A later
ADR may decide that trail execution observations should become authored or
derived signals. This draft records the idea because the execution pipeline
already observes the relevant data, but v1 does not expose the following as
public signal contracts:

```text
trail.completed    → { trailId, input, output, duration, permit }
trail.failed       → { trailId, input, error, duration, permit }
```

#### Categorized failure signals

The error taxonomy could map to categorized failure signals in a future
decision:

```text
trail.failed                → all failures
trail.failed.validation     → ValidationError, AmbiguousError
trail.failed.not_found      → NotFoundError
trail.failed.conflict       → ConflictError, AlreadyExistsError
trail.failed.auth           → AuthError
trail.failed.permission     → PermissionError
trail.failed.timeout        → TimeoutError
trail.failed.rate_limit     → RateLimitError
trail.failed.network        → NetworkError
trail.failed.internal       → InternalError, AssertionError
trail.failed.cancelled      → CancelledError
```

Typed-signal v1 does not create this vocabulary. It preserves the error taxonomy
as a useful input for a later lifecycle-signal decision.

### Signal fire pipeline

When `ctx.fire()` fires an authored signal:

1. **Validate.** The payload validates against the signal's schema. Invalid payloads produce diagnostics and trace records; the fire attempt is dropped, not the producing trail.
2. **Record.** Tracing records the fire attempt: signal ID, payload summary, producer trail, run ID, trace ID, timestamp.
3. **Notify local consumers.** Trails with matching `on: [signal]` can run through the same in-process runtime path.
4. **Record handler outcomes.** Tracing records handler invocation, completion, and failure records when local consumers run.

External subscriptions, outbound webhooks, and stronger delivery semantics are
deferred. They should build on the same signal records if accepted later, but
they are not part of this decision.

### Delivery semantics derived from error taxonomy

Typed-signal v1 does not define redelivery. A future external delivery or
durable-reactivity ADR may use the error taxonomy to decide whether redelivery
could succeed:

| Error category | Delivery behavior | Rationale |
| --- | --- | --- |
| Retryable (`TimeoutError`, `NetworkError`, `RateLimitError`) | Redeliver after backoff | Transient failure; the same input may succeed on retry |
| Permanent (`ValidationError`, `NotFoundError`, `ConflictError`, `AuthError`, `PermissionError`, `AmbiguousError`) | Dead-letter / drop | Redelivery produces the same failure |
| Internal (`InternalError`, `AssertionError`) | Dead-letter with alert | Bug or invariant violation; retry won't help, operator attention needed |
| Cancelled (`CancelledError`) | Do not redeliver | Explicit cancellation; redelivery contradicts intent |

The current runtime makes no persistence, retry, replay, ordering, or
dead-letter guarantee beyond the local best-effort notification attempt. Handler
failures are diagnostics and trace observations, not an implicit retry queue.

### Dead signal detection

Every fire attempt is recorded with signal provenance:

```json
{
  "name": "signal.fired",
  "signalId": "booking.confirmed",
  "producerTrailId": "booking.confirm",
  "runId": "run_456",
  "traceId": "trace_123"
}
```

When the static graph has no consumers, survey and lockfile projections can show
the missing edge. When runtime fires a signal and no local handlers run, tracing
has the fired record without matching handler records. V1 does not claim dynamic
subscriber awareness or external delivery counts.

```text
Signal 'user.created' fired by user.create has no local consumers
```

This is a combination of static graph evidence and runtime observation. Static
checks cannot see future external subscribers. Runtime traces cannot prevent a
missing local consumer before execution. The two views should converge through
the same signal IDs.

### Warden rules for signals

The v1 Warden surface is limited to checks backed by implemented syntax hooks and graph data:

- **Undeclared fire.** A trail calls `ctx.fire(signal)` without declaring the signal in `fires`. Error.
- **Unused fires declaration.** A trail declares `fires: [someSignal]` but never fires it. Warning when the static hook can prove the absence.
- **Signal graph drift.** A signal is fired by at least one trail but no local trail activates on it. Warning when the topo data is available.
- **Missing signal-fire examples.** A trail declares `fires` but no example includes a `signals` assertion. Coaching suggestion.

Deferred Warden rules need the capabilities they govern to exist first:

- Schema compatibility for future durable activation sources.
- Read-trail firing policy if read trails later gain first-class signal doctrine.
- Multi-producer schema drift if signal schemas are ever derived from producers.
- Error-handler cascade rules for future `trail.failed.*` lifecycle signals.
- Duplicate-delivery examples for future durable delivery.

Typed-signal v1 only relies on Warden checks backed by hooks and graph data that
exist in the stack. New lifecycle, source-materializer, delivery, retry, and
dead-letter checks are deferred until those capabilities are real.

### Reactive test mode

`testExamples` in standard mode tests the trail in isolation. Signal fires are captured and validated against example assertions, but they don't activate consumers.

An opt-in reactive mode follows the signal chain:

```bash
trails test --reactive
```

In reactive mode, fired signals actually activate consumer trails (with mock resources). The test verifies the full reactive chain. This catches integration bugs: "the signal fires correctly but the consumer trail's input schema doesn't match the signal payload."

Reactive mode runs after standard mode passes. Standard mode validates each trail independently. Reactive mode validates the communication graph.

### How signals compound with existing features

**With packs.** Signals are the decoupling mechanism between packs. A billing pack fires `billing.payment-completed`. A notification pack activates on it. Neither imports the other. They're connected by the signal contract in the topo.

**With the error taxonomy.** The 13 error classes remain useful inputs for a
future lifecycle or delivery decision. Typed-signal v1 records handler failures
as diagnostics and trace records without defining retry or dead-letter behavior.

**With tracing.** Tracing records signal fire attempts, invalid payloads, handler invocation, handler completion, and handler failure. Queries can answer which signals fired and which local handlers ran without claiming external delivery counts.

**With visibility.** Signal-activated trails can be `visibility: 'internal'`. They don't need to appear on public surfaces. Background workers, compensators, and audit trails can remain internal trails activated by signals.

**With parallel composition.** Multiple signal-consuming trails may activate concurrently from the same signal when the runtime supports it. If ordering matters, use sequential `cross` composition.

**Dead-letter handling through composition.** Deferred. A future lifecycle-signal
or durable-delivery ADR can decide whether permanent handler failures should
fire categorized signals, enqueue dead letters, or remain observations only.

## Non-goals

Typed-signal v1 does not introduce:

- **No `ctx.signal()`.** The public execution-context API is
  `ctx.fire(signal, payload)`. The term `signal()` remains the contract factory,
  not the runtime method.
- **No public string-fire API.** Runtime calls use signal contract objects. Stable
  string IDs appear in serialized artifacts and example fixtures, not as the
  primary authoring API.
- **No generic event bus.** Signals are Trails graph contracts, not a freeform
  process-wide pub/sub channel.
- **No framework lifecycle signal family.** `trail.completed`, `trail.failed`,
  categorized failure signals, and similar framework-authored signals need a
  later ADR.
- **No delivery guarantees beyond current runtime behavior.** The framework
  records and dispatches local notification attempts. It does not promise
  persistence, replay, retry, exactly-once delivery, total ordering, or
  dead-letter queues.
- **No source materializer claims.** Schedule, webhook, external subscription,
  and other source-provenance fields may appear only when the runtime really
  produces that data.
- **No speculative Warden enforcement.** Warden checks must be backed by
  implemented syntax hooks, topo data, trace data, or lockfile fields. Rules for
  future source materializers, lifecycle signals, delivery guarantees, or
  dead-letter behavior stay deferred.

## Consequences

### Positive

- **Signals become a runtime primitive.** The `signal()` declaration gains
  `ctx.fire(signal, payload)` for typed runtime notification, diagnostics, and
  trace recording. The primitive evolves from structural metadata to a live
  communication channel.
- **Schema is always present.** The signal contract owns the payload schema. No
  untyped signal state and no second declaration in the blaze.
- **Trails decouple through signals.** Packs communicate via signal contracts
  instead of direct crosses. The signal schema is the contract. The topo exposes
  the relationship.
- **Runtime observations become queryable without becoming lifecycle signals.**
  Diagnostics and `signal.*` trace records capture what happened while the
  lifecycle-signal family remains a separate decision.
- **Dead signals are visible from real evidence.** Types, examples, Warden hooks,
  tracing records, and survey output expose the signal graph without inventing
  delivery machinery.

### Tradeoffs

- **New field on the trail spec.** `fires` joins `crosses`, `visibility`, `on`, `resources`, and the rest. The justification: signal-fire metadata is genuinely new information that the framework can't derive from the implementation without static analysis.
- **Best-effort fire semantics.** The producing trail doesn't receive a delivery
  result. This keeps producers decoupled from consumers, but it means delivery
  and handler problems are visible through diagnostics and tracing rather than
  return values.
- **Lifecycle signal families remain undecided.** The framework already observes
  trail completion and failure, but v1 does not automatically convert those
  observations into public signal contracts.
- **Signal ordering is not guaranteed across consumers.** Multiple consumers of
  the same signal are independent. If ordering matters, use sequential `cross`
  composition.
- **Runtime cycle suppression is still signal-id-based.** The current fire stack prevents infinite re-entrant loops, but it can over-suppress legitimate diamond dispatch patterns that reuse the same signal ID on a different branch. Per-path provenance is a deferred upgrade once real graph pressure appears.

### Deferred work

- **Signal persistence, replay, retry, and dead-letter infrastructure.** These
  require a durable delivery decision, not just a typed runtime notification API.
- **Signal versioning.** Schema evolution is a broader Trails concern. Signal
  payload schemas face the same problem as trail input and output schemas.
- **External delivery surfaces.** WebSocket subscriptions, SSE streams, outbound
  webhooks, and similar surfaces each carry their own delivery contract.
- **Lifecycle signal families.** Framework-authored `trail.*` signal contracts
  need a later decision that weighs trace volume, sampling, recursion risks, and
  how these signals appear in topo/survey output.
- **Source materializers.** Schedule, webhook, and predicate provenance should
  appear only after those sources have first-class runtime data.
- **Signal batching or windowing.** A future extension to local or durable signal
  routing.
- **Event sourcing.** An application architecture pattern, not a framework
  decision. Typed signals can support such systems, but this ADR does not
  mandate them.

## References

- [ADR-0000: Core Premise](../0000-core-premise.md) — "derive by default"; framework lifecycle signals are derived from execution observation
- [ADR-0002: Built-In Result Type](../0002-built-in-result-type.md) — the error taxonomy maps to categorized failure signals
- [ADR-0003: Unified Trail Primitive](../0003-unified-trail-primitive.md) — `fires` is a new property on the trail spec
- [ADR-0006: Shared Execution Pipeline](../0006-shared-execution-pipeline.md) — `executeTrail` is where future lifecycle-signal proposals would observe trail completion and failure
- [ADR-0007: Governance as Trails](../0007-governance-as-trails.md) — warden rules for signal declarations
- [ADR-0013: Tracing](../0013-tracing.md) — tracing records signal fire attempts and handler records
- [ADR: Unified Observability](20260409-unified-observability.md) (draft) — tracing moves into core; signal delivery outcomes are recorded intrinsically by the execution pipeline
- [ADR-0026: Error Taxonomy as Transport-Independent Behavior Contract](../0026-error-taxonomy-as-transport-independent-behavior-contract.md) — the error taxonomy is the input for any future signal retry or dead-letter decision
- [ADR-0024: Typed Trail Composition](../0024-typed-trail-composition.md) — typed `ctx.cross()` complements signal-based decoupling; signals are for loose coupling, crosses are for typed direct composition
- ADR: The Serialized Topo Graph (draft) — signals as nodes in the topo graph
- ADR: Trail Visibility and Trailhead Filtering (draft) — signal-activated trails can be internal
- ADR: Packs as Namespace Boundaries (draft) — signals are the decoupling mechanism between packs
- [ADR: Reactive Trail Activation](20260331-reactive-trail-activation.md) (draft) — depends on this ADR; `on:` declarations consume signals for reactive activation
