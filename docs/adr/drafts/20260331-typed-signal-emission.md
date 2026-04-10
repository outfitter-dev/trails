---
slug: typed-signal-emission
title: Typed Signal Emission
status: draft
created: 2026-03-31
updated: 2026-04-09
owners: ['[galligan](https://github.com/galligan)']
depends_on: [2, 3, 6, 7, 13]
---

# ADR: Typed Signal Emission

## Context

### Events are declared but inert

The `signal()` primitive exists in Trails. It declares a named event with a typed schema. Events are registered in the topo. Survey reports them. But there's no runtime story. There's no way for a trail to emit an event. There's no delivery mechanism. There's no way to listen. The primitive is structural metadata, not a runtime capability.

The schema is declared. The topo knows about it. But no trail can say "this happened." The event is a contract with no runtime.

### What emission enables

When a trail can announce what happened, the framework gains a communication layer between trails that doesn't require direct coupling:

- A billing pack emits `billing.payment-completed`. A notification pack listens and sends a receipt. Neither pack knows the other exists. They're connected by the event contract.
- A trail emits `entity.updated`. A search indexer, a cache invalidator, and an audit logger all respond. The emitting trail doesn't know about any of them.
- A scheduled health check fails. The failure is observed by the framework as an event. An alerting trail activates. No manual error handler wiring.

Without events as a runtime primitive, these patterns require either direct crosses (tight coupling between packs) or application-level glue code. Events provide the decoupling.

### Schema always exists

A trail that calls `ctx.signal('booking.confirmed', payload)` is passing a typed payload. The schema exists — it's the type of the argument. The framework can derive it from the emitter without requiring the developer to declare it separately.

This means events follow the same progressive disclosure as everything else in Trails:

1. **Derived.** The trail emits with a typed payload. The schema is captured from the emitter. No separate declaration needed.
2. **Declared inline.** The developer adds a schema to the `fires` declaration for documentation or stricter validation. Optional tightening.
3. **Extracted to `signal()`.** Multiple emitters or cross-pack consumption warrant a standalone declaration. The schema lives on the topo as a first-class node. The CLI can automate this: `trails extract signal booking.confirmed`.

At every stage, a schema exists. The question is only where it's authored.

### The framework already observes things worth announcing

Every time `executeTrail` runs, the framework knows what happened: which trail, what input, what result, how long, what errors. This is information the framework observes but currently only records to tracing. If the framework emits lifecycle events for these observations, the reactive graph becomes much richer without any developer authoring:

- Trail completed → `trail.completed` event
- Trail failed → `trail.failed` event (with error class and category)

Authored events (the developer says "this happened") and observed events (the framework says "this happened") flow through the same runtime. One emission mechanism. One routing mechanism. One delivery mechanism.

### Dead events are a real problem

An event emitted to zero listeners is a silent failure. The trail succeeded. The Result is ok. But the announcement went nowhere.

The framework must make dead events visible at every layer: compile time (types catch wrong payloads), test time (examples verify emissions), lint time (warden catches missing listeners), runtime (tracing records delivery counts), and inspection time (survey shows the event graph).

## Decision

### `ctx.signal()` on the execution context

Trails emit events through the execution context:

```typescript
const confirmBooking = trail('booking.confirm', {
  intent: 'write',
  input: BookingInputSchema,
  output: BookingSchema,
  fires: [bookingConfirmed],
  blaze: async (input, ctx) => {
    const booking = await confirmInStore(input);

    ctx.signal(bookingConfirmed, {
      bookingId: booking.id,
      userId: input.userId,
      confirmedAt: new Date().toISOString(),
    });

    return Result.ok(booking);
  },
});
```

`ctx.signal()` takes an event definition (or string ID) and a typed payload. The payload validates against the event's schema at runtime. The emission is fire-and-forget from the trail's perspective: the trail doesn't wait for delivery, doesn't know who's listening, doesn't get a result back. The trail's job is to do work and declare what happened. Delivery is the framework's job.

`ctx.signal()` is available in any trail, including within `cross` chains. A crossed trail's emissions flow through the same routing as the root trail's emissions.

### The `fires` declaration

A trail declares which signals it may fire:

```typescript
fires: [bookingConfirmed, bookingCancelled],
```

This is analogous to `crosses` declaring which trails may be called. The warden verifies alignment:

- A `ctx.signal(someEvent)` call in the blaze without a corresponding entry in `fires`: error. Undeclared emission.
- A signal in `fires` that is never emitted in the blaze: warning. Unused declaration.
- A trail with `intent: 'read'` that declares `fires`: warning. Read trails observe, they shouldn't announce state changes.

The `fires` declaration is optional. A trail without `fires` cannot call `ctx.signal()` (the warden catches this). Progressive adoption: add `fires` when the trail needs to announce something.

### Progressive event schema ownership

Events follow the same progressive disclosure pattern as every other Trails concept:

**Stage 1: Derived from emitter.** When only one trail fires a signal, the signal's schema is derived from the typed payload in that trail's `ctx.signal()` call. The lockfile captures the derived schema. No separate `signal()` declaration needed.

**Stage 2: Declared inline.** The developer adds an explicit schema to the `fires` entry for documentation, stricter validation, or to decouple from implementation details. The declared schema takes precedence over the derived one.

**Stage 3: Extracted to `signal()`.** When multiple trails emit the same event or when cross-pack consumption warrants a shared contract, the event graduates to a standalone `signal()` declaration on the topo. The warden flags the opportunity: "Two trails emit `booking.confirmed` — consider extracting to a shared signal declaration." The CLI automates it: `trails extract signal booking.confirmed`.

At stage 3, the `signal()` declaration owns the schema. Emitting trails reference it. Consuming triggers validate against it. The event is a first-class node in the topo graph and the lockfile.

The warden's role at each stage:

- Stage 1: "This trail fires `booking.confirmed` with no explicit schema. Schema derived from emission payload."
- Stage 2: "Schema declared. Validated against emission usage."
- Stage 3 (opportunity): "Two trails fire `booking.confirmed`. Schemas match. Consider extracting to a shared `signal()` declaration."
- Stage 3 (conflict): "Two trails fire `booking.confirmed`. Schemas differ. Resolution required before extraction."

### Emission examples

Examples can assert which events were emitted during execution:

```typescript
examples: [
  {
    name: 'successful confirmation',
    input: { slotId: 'slot_1', userId: 'user_1' },
    expected: { bookingId: 'bk_1', status: 'confirmed' },
    signals: [
      { event: 'booking.confirmed', payload: { bookingId: 'bk_1', userId: 'user_1' } },
    ],
  },
  {
    name: 'already confirmed (idempotent)',
    input: { slotId: 'slot_1', userId: 'user_1' },
    expected: { bookingId: 'bk_1', status: 'already_confirmed' },
    signals: [],  // explicitly asserts no events emitted
  },
],
```

`testExamples` captures all emissions during execution and validates them against the example's `signals` assertions. The second example is significant: `signals: []` asserts that the idempotent case does NOT emit a duplicate event.

### Consumption-side examples

Emission examples validate the trail that announces. Consumption examples validate the trail that reacts. Trails activated by triggers should include examples shaped by their activation context:

- **Webhook-triggered and event-triggered trails** may receive duplicate deliveries. Include idempotency examples where the same payload arrives twice.
- **Schedule-triggered trails** may fire when there's nothing to process. Include empty-result examples.
- **Trails triggered by `trail.failed.*` lifecycle events** are error handlers. Include examples for each error category they handle, and assert `signals: []` (avoiding reactive error cascades).

### Framework lifecycle events

The framework automatically emits lifecycle events for every trail execution. These are not authored by the developer. They're derived from the execution pipeline:

```text
trail.completed    → { trailId, input, output, duration, permit }
trail.failed       → { trailId, input, error, duration, permit }
```

Lifecycle events are emitted after the trail's blaze returns, as part of the `executeTrail` pipeline. They flow through the same event routing as authored events.

#### Categorized error events

The error taxonomy maps to categorized failure events:

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

The 13 error classes become event vocabulary. The error taxonomy, designed for trailhead mapping (error to HTTP status, error to exit code), now also maps to the reactive graph. One more derivation from the same authored information.

### Event routing pipeline

When `ctx.signal()` fires or the framework emits a lifecycle event:

1. **Validate.** The payload validates against the event's schema. Invalid payloads produce an `InternalError` logged to tracing (the emission is dropped, not the trail).
2. **Record.** Tracing records the emission: event ID, payload, source trail, execution ID, timestamp.
3. **Route internally.** The signal bus notifies listeners. Trails with matching `on: [{ signal: '...' }]` activate via `run()`.
4. **Route externally.** Subscription listeners (WebSocket clients, SSE streams, future outbound webhooks) receive the event through their trailhead's delivery mechanism.
5. **Record delivery.** Tracing records delivery outcomes: how many triggers fired, how many subscriptions received the event, how many failed.

Steps 3 and 4 are independent. Internal routing (triggers) and external routing (subscriptions) happen concurrently. Neither blocks the emitting trail (emission is fire-and-forget).

### Delivery semantics derived from error taxonomy

When an event-triggered trail fails, the error class determines whether redelivery could succeed. The error taxonomy already encodes this — the same mapping that drives HTTP status codes and CLI exit codes also governs delivery behavior:

| Error category | Delivery behavior | Rationale |
| --- | --- | --- |
| Retryable (`TimeoutError`, `NetworkError`, `RateLimitError`) | Redeliver after backoff | Transient failure; the same input may succeed on retry |
| Permanent (`ValidationError`, `NotFoundError`, `ConflictError`, `AuthError`, `PermissionError`, `AmbiguousError`) | Dead-letter / drop | Redelivery produces the same failure |
| Internal (`InternalError`, `AssertionError`) | Dead-letter with alert | Bug or invariant violation; retry won't help, operator attention needed |
| Cancelled (`CancelledError`) | Do not redeliver | Explicit cancellation; redelivery contradicts intent |

The initial in-process routing pipeline does not retry (at-most-once within a process). But the mapping is defined so that trailheads and infrastructure with stronger delivery guarantees can derive retry and dead-letter behavior from the error class without per-trail configuration.

Tracing records the error category on every failed trigger activation. Over time, query patterns emerge: "80% of `notify.booking-confirmed` failures are `NetworkError` — the email service is flaky" vs "`billing.refund` failures are all `ConflictError` — a logic bug, not a delivery problem."

### Dead event detection

Every emission is recorded with delivery metadata:

```json
{
  "type": "event.emitted",
  "event": "booking.confirmed",
  "source": { "trail": "booking.confirm", "executionId": "exec_456" },
  "delivery": {
    "triggers": 1,
    "subscriptions": 2
  }
}
```

When delivery counts are zero, the event went nowhere. Tracing records this. In development, the framework trailheads it:

```text
⚠ Event 'user.created' emitted by user.create → 0 listeners
```

This is a runtime observation, not a static analysis. The warden checks statically ("this event has no listeners in the topo"). Tracing checks dynamically ("this event was emitted and nothing consumed it"). Both are necessary because the static check can't see dynamic subscribers (WebSocket clients) and the runtime check can't see configuration mistakes before they happen.

### Warden rules for events

- **Undeclared emission.** A trail calls `ctx.signal(event)` without declaring the signal in `fires`. Error.
- **Unused fires declaration.** A trail declares `fires: [someEvent]` but never emits it. Warning.
- **Dead signal.** A signal is fired by at least one trail but no trail activates on it and no trailhead subscribes to it. Warning.
- **Schema mismatch.** A trail activates on a signal whose schema is incompatible with the trail's input schema. Error at topo construction.
- **Read trail firing.** A trail with `intent: 'read'` declares `fires`. Warning.
- **Missing emission examples.** A trail declares `fires` but no example includes a `signals` assertion. Coaching suggestion.
- **Multi-emitter schema drift.** Two trails fire the same signal with incompatible derived schemas. Error: extract to a shared `signal()` declaration.
- **Error handler firing signals.** A trail activated by `trail.failed.*` that declares `fires`. Warning: risk of reactive signal cascades.
- **Missing idempotency examples.** An event-triggered trail with no duplicate-delivery example. Coaching suggestion.

### Reactive test mode

`testExamples` in standard mode tests the trail in isolation. Emissions are captured and validated against example assertions, but they don't activate trigger listeners.

An opt-in reactive mode follows the event chain:

```bash
trails test --reactive
```

In reactive mode, emitted events actually trigger listener trails (with mock resources). The test verifies the full reactive chain. This catches integration bugs: "the event emits correctly but the listener trail's input schema doesn't match the event payload."

Reactive mode runs after standard mode passes. Standard mode validates each trail independently. Reactive mode validates the communication graph.

### How events compound with existing features

**With packs.** Events are the decoupling mechanism between packs. A billing pack emits `billing.payment-completed`. A notification pack triggers on it. Neither imports the other. They're connected by the event contract in the topo.

**With the error taxonomy.** The 13 error classes map to categorized failure events. One error class, multiple derivations: HTTP status, exit code, JSON-RPC error, and now reactive event vocabulary.

**With tracing.** Tracing records every emission with delivery metadata. Tracing queries can answer: "show me all events emitted in the last hour with zero deliveries." Events enrich the observability model.

**With visibility.** Event-triggered trails can be `visibility: 'internal'`. They don't appear on trailheads. They activate reactively. Background workers, compensators, and audit trails are internal trails triggered by events.

**With parallel composition.** Multiple trigger-listening trails activate concurrently from the same event (they're independent). The framework handles concurrent activation the same way the array form of `ctx.cross()` handles concurrent composition.

**Dead-letter handling through composition.** When an event-triggered trail permanently fails, the framework emits a `trail.failed.<category>` lifecycle event with trigger provenance. Another trail can trigger on that lifecycle event to handle the dead letter — no dedicated dead-letter infrastructure needed. The `fires: []` declaration on the dead-letter handler is load-bearing: the warden enforces that error handlers don't fire signals (avoiding infinite cascades).

## Consequences

### Positive

- **Signals become a runtime primitive.** The `signal()` declaration gains `ctx.signal()` for emission, delivery routing, and tracing recording. The primitive evolves from structural metadata to a live communication channel.
- **Schema is always present.** Derived from the emitter at stage 1, declared inline at stage 2, extracted to `signal()` at stage 3. No untyped events. Progressive disclosure without a schema gap.
- **Trails decouple through events.** Packs communicate via events instead of direct crosses. The event schema is the contract. The topo validates compatibility.
- **Framework lifecycle events unify observation.** The error taxonomy maps to categorized failure events. The reactive graph handles both authored and observed events uniformly.
- **Dead events are visible at every layer.** Five layers of safety from one primitive: types (compile time), examples (test time), warden (lint time), tracing (runtime), survey (inspection time).

### Tradeoffs

- **New field on the trail spec.** `fires` joins `crosses`, `visibility`, `on`, `resources`, and the rest. The justification: emission is genuinely new information that the framework can't derive from the implementation without static analysis.
- **Fire-and-forget semantics.** The emitting trail doesn't know if the event was delivered. This is correct (the trail shouldn't couple to its listeners) but means delivery failures are only visible through tracing.
- **Lifecycle events add volume.** Every trail execution produces at least one lifecycle event. Sampling is a future optimization.
- **Event ordering is not guaranteed across listeners.** Multiple triggers on the same event activate concurrently. If ordering matters, use sequential `cross` composition.

### What this does NOT decide

- **Event persistence, replay, or retry infrastructure.** The error taxonomy defines which failures are retryable vs permanent. The retry mechanism itself is future work. The in-process routing pipeline is at-most-once.
- **Event versioning.** Schema evolution is a broader Trails concern (trail input schemas face the same question).
- **External delivery trailheads.** WebSocket subscriptions, SSE streams, outbound webhooks. Each has its own delivery concerns. This ADR provides the emission and routing. Delivery is trailhead-specific.
- **Event batching or windowing.** Future extension to the routing pipeline.
- **Event sourcing.** An application architecture pattern, not a framework decision. The event runtime supports it but doesn't mandate it.

## References

- [ADR-0000: Core Premise](../0000-core-premise.md) — "derive by default"; framework lifecycle events are derived from execution observation
- [ADR-0002: Built-In Result Type](../0002-built-in-result-type.md) — the error taxonomy maps to categorized failure events
- [ADR-0003: Unified Trail Primitive](../0003-unified-trail-primitive.md) — `fires` is a new property on the trail spec
- [ADR-0006: Shared Execution Pipeline](../0006-shared-execution-pipeline.md) — lifecycle events are emitted by `executeTrail`
- [ADR-0007: Governance as Trails](../0007-governance-as-trails.md) — warden rules for event declarations
- [ADR-0013: Tracing](../0013-tracing.md) — tracing records emission and delivery metadata
- [ADR: Unified Observability](20260409-unified-observability.md) (draft) — tracing moves into core; signal delivery outcomes are recorded intrinsically by the execution pipeline
- [ADR: Error Taxonomy as Transport-Independent Behavior Contract](20260409-error-taxonomy-as-transport-independent-behavior-contract.md) (draft) — signal delivery semantics (retry, dead-letter, discard) derive from the error taxonomy's `retryable` flag
- [ADR-0024: Typed Trail Composition](../0024-typed-trail-composition.md) — typed `ctx.cross()` complements signal-based decoupling; signals are for loose coupling, crosses are for typed direct composition
- ADR: The Serialized Topo Graph (draft) — signals as nodes in the topo graph
- ADR: Trail Visibility and Trailhead Filtering (draft) — signal-activated trails can be internal
- ADR: Packs as Namespace Boundaries (draft) — signals are the decoupling mechanism between packs
- [ADR: Reactive Trail Activation](20260331-reactive-trail-activation.md) (draft) — depends on this ADR; `on:` declarations consume signals for reactive activation
