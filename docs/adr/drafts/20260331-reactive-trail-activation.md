---
slug: reactive-trail-activation
title: Reactive Trail Activation
status: draft
created: 2026-03-31
updated: 2026-04-09
owners: ['[galligan](https://github.com/galligan)']
depends_on: [3, 4, 13, 38]
---

# ADR: Reactive Trail Activation

## Context

### Trails are callable but not activatable

Every trail in a topo is callable: a trailhead or `run()` can invoke it with input and receive a Result. But the framework has no concept of *when* a trail should be invoked. Activation logic lives outside the contract: in trailhead configuration (trailhead options), in external schedulers (crontab), in application code (a webhook handler that calls `run()`), or in infrastructure (a queue consumer).

This means the framework can't see the reactive graph. Survey reports what trails exist and what they cross. It can't report what activates them. The warden governs trail contracts and composition. It can't govern activation. Tracing records what happened. It can't attribute the execution to an activation source.

### Real applications are activation-driven

The patterns are everywhere:

- A Stripe webhook activates booking confirmation
- A nightly schedule activates data archival
- A trail failure activates an alert or compensation
- A fired signal activates a downstream trail
- A config change activates a cache invalidation

Developers build these patterns today with application code: webhook handlers call `run()`, schedulers call `run()`, error handlers call `run()`. The activation logic works, but it's invisible to the framework. The source, the condition, and the trail are disconnected.

### The key constraint

Activation sources activate trails. That's the boundary. An activation source does not compose trails. It does not orchestrate. It does not branch. It fires, the trail runs, and the trail handles composition with normal `ctx.cross()` calls inside its implementation.

If someone wants "when X happens, do A then B then C with branching," the answer is: put an activation source on a trail that crosses into A, B, and C with normal imperative composition. The source is the activation layer. The trail is the execution layer. These stay separate.

### Depends on: Typed Signal Emission

ADR-0038 establishes `ctx.fire(signal, payload)`, the `fires` declaration, and
typed signal contracts that can be consumed through `on:`. It explicitly leaves
framework lifecycle signal families, durable delivery, and source materializers
to later decisions. This draft builds on the accepted authored-signal runtime
and explores the additional activation sources that would make those deferred
pieces real.

## Decision

### `on` field on the trail spec

A trail can declare what activates it with the `on` field:

```typescript
const confirmBooking = trail('booking.confirm', {
  on: [{
    webhook: 'stripe',
    event: 'payment_intent.succeeded',
    verify: stripeSignatureVerifier,
  }],
  intent: 'write',
  input: PaymentConfirmationSchema,
  blaze: async (input, ctx) => {
    const booking = bookingStore.from(ctx);
    return booking.confirmPayment(input.paymentIntentId);
  },
});
```

`on` is optional. Most trails don't have it. They're invoked explicitly via trailheads or `run()`. `on` adds reactive activation without changing anything about how the trail works.

A trail with `on` is still a normal trail. It still has an input schema, output schema, examples, intent, and blaze. It's still callable via `run()`, `ctx.cross()`, or trailheads. The activation source is an *additional* invocation path, not the only one.

### Authored defaults, overridable in context

The `on` field is part of the trail's contract — the author's stated design for what activates this trail. It follows the same pattern as `visibility` and `intent`: authored default on the trail, overridable at the pack or app level.

This matters for packs. A pack declares `on` for its trails. The consuming app may need different activation:

```typescript
// The pack trail declares its default activation source
const notifyBooking = trail('notify.booking-confirmed', {
  on: [{ signal: 'booking.confirmed' }],
  // ...
});

// The consuming app overrides activation
app.override('notify.booking-confirmed', {
  on: [{ signal: 'reservation.finalized' }],
});

// Or suppresses it entirely
app.override('notify.booking-confirmed', {
  on: [], // disable default activation sources
});

// Or adds additional activation sources
app.override('notify.booking-confirmed', {
  on: [
    { signal: 'booking.confirmed' },     // keep default
    { signal: 'reservation.finalized' }, // add another
  ],
});
```

The authored `on` documents intent: "I was designed to respond to this." The override enables reuse: "in my app, I need you to respond to that instead." The lockfile resolves the final state. The warden can flag overrides that contradict the original intent.

### Activation source types

Three activation source types. Schedule is the only non-signal source (time isn't a signal, it's a clock). Signal sources handle both authored signals and framework lifecycle signals through one mechanism. Webhook sources handle external inbound activation.

#### Schedule activation sources

Time-based activation. Cron expressions for recurring schedules.

```typescript
const archiveOld = trail('data.archive-old', {
  on: [{
    schedule: '0 2 * * *',
    input: { olderThanDays: 90 },
  }],
  intent: 'write',
  input: z.object({ olderThanDays: z.number() }),
  blaze: async (input, ctx) => { /* ... */ },
});
```

The `input` field on a scheduled activation source provides static input for each invocation. If omitted, the trail receives an empty object. The trail's input schema validates the activation source input at topo construction time.

#### Signal activation sources

Activation when a signal is fired. In the accepted signal runtime this covers
authored signals via `ctx.fire(signal, payload)`. Framework lifecycle signals
(`trail.completed`, `trail.failed`, `trail.failed.<category>`) remain a future
decision.

**Authored signal activation source:**

```typescript
const notifyBooking = trail('notify.booking-confirmed', {
  on: [{ signal: 'booking.confirmed' }],
  intent: 'write',
  input: BookingConfirmedSchema,
  blaze: async (input, ctx) => { /* ... */ },
});
```

**Proposed trail failure activation source (categorized lifecycle signal):**

```typescript
const billingConflictResolve = trail('billing.conflict-resolve', {
  on: [{
    signal: 'trail.failed.conflict',
    where: (signal) => signal.trailId.startsWith('billing.'),
  }],
  intent: 'write',
  input: TrailFailureSchema,
  blaze: async (input, ctx) => { /* ... */ },
});
```

If this draft is accepted, the execution pipeline would be able to produce categorized lifecycle signals such as `trail.failed.conflict`, `trail.failed.auth`, and `trail.failed.timeout`. Each would map to an error taxonomy category. The activation source would bind to a specific category and filter further with `where`. The error taxonomy would compound with activation sources: the error classes become signal vocabulary for reactive error handling.

#### Webhook activation sources

Proposed activation when an external system sends a webhook payload.

```typescript
const githubEventReceived = trail('github.event.received', {
  on: [{
    webhook: 'github',
    path: '/webhooks/github',
    verify: githubSignatureVerifier,
  }],
  intent: 'write',
  input: GitHubEventSchema,
  blaze: async (input, ctx) => { /* ... */ },
});
```

Webhook verification is permit resolution for this activation path — it produces a `Permit` through a connector, not necessarily a JWT. See the Webhooks ADR for the full webhook trailhead design.

### Conditional activation sources with `where`

Proposed activation sources can include a predicate that filters activations:

```typescript
const highValueApproval = trail('approval.high-value', {
  on: [{
    signal: 'order.completed',
    where: (payload) => payload.total > 10000,
  }],
  intent: 'write',
  input: OrderSchema,
  blaze: async (input, ctx) => { /* ... */ },
});
```

`where` predicates can have examples:

```typescript
where: {
  predicate: (payload) => payload.total > 10000,
  examples: [
    { payload: { total: 15000 }, on: true },
    { payload: { total: 5000 }, on: false },
    { payload: { total: 10000 }, on: false },
  ],
},
```

`testExamples` would validate the predicate against these examples. The activation condition would be part of the contract, testable without the actual signal source.

### Multiple activation sources on one trail

```typescript
const healthCheck = trail('health.check-all', {
  on: [
    { schedule: '*/5 * * * *' },
    { signal: 'trail.failed.network' },
  ],
  intent: 'read',
  input: z.object({}),
  blaze: async (_input, ctx) => { /* ... */ },
});
```

Each proposed activation source is an independent activation path. The trail's implementation would not know which one activated it (by design: the trail is the execution layer, not the activation layer).

### Activation source resolution and the lockfile

If this draft is implemented, topo construction would resolve activation sources and the lockfile would capture the full reactive graph:

- **Schedule activation sources** would register with the scheduler.
- **Signal activation sources** would register with the signal routing pipeline.
- **Webhook activation sources** would register endpoints on the HTTP trailhead.

The lockfile would record every activation source on every trail, including overrides. This would make the reactive graph inspectable without running the app:

```text
Activation:
  booking.confirm          ← webhook:stripe (payment_intent.succeeded)
  booking.send-reminders   ← schedule (0 * * * *)
  billing.conflict-resolve ← signal (trail.failed.conflict, where: billing.*)
  health.check-all         ← schedule (*/5 * * * *), signal (trail.failed.network)

Reactive chains:
  webhook:stripe → booking.confirm → booking.confirmed → notify.booking-confirmed
```

The reactive chain is derived by tracing: an activation source activates a trail, the trail fires a signal, and that signal activates the next trail. The full activation path is inspectable.

Invalid activation sources would be caught at construction time:

- A signal activation source referencing a signal ID that no trail declares and that isn't a framework lifecycle signal: warning.
- An activation source with a `where` predicate whose input type doesn't match the signal payload schema: error.
- A scheduled activation source whose input doesn't validate against the trail's input schema: error.

### Activated execution uses `run()`

When an activation source fires, the framework executes the trail through the full pipeline via `run(trailId, input)`. Tracing records the execution with activation provenance:

```json
{
  "trailId": "booking.confirm",
  "activation": {
    "type": "webhook:stripe",
    "event": "payment_intent.succeeded",
    "receivedAt": "2026-03-31T14:32:05Z"
  },
  "duration": 230,
  "result": "ok"
}
```

Tracing queries can filter by activation source type: "show me all scheduled executions," "show me all webhook-activated failures."

### Dispatch semantics

Reactive Activation v1 uses in-process dispatch. When a source activates a
trail, the runtime invokes every declared consuming trail whose source
declaration matches and whose guard checks pass. Handler order is intentionally
unspecified; code that needs ordered work should put that order inside a trail
and use normal `ctx.cross()` composition.

Handler failures are isolated. A failing consumer records diagnostics and
trace data, but it does not prevent sibling consumers from being invoked and it
does not produce a producer-facing delivery `Result`. Likewise, `ctx.fire()`
resolves after the framework validates the payload, records the signal
lifecycle point, and initiates dispatch. It does not promise that every
consuming trail has completed before the producer continues. The current
in-process runtime may still track pending consumers for lifecycle cleanup; the
public contract is dispatch initiation, not handler completion.

Cycle safety is bounded. The runtime suppresses re-entrant signal fires when
the same signal ID is already in the current fire stack, and it enforces a max
fan-out depth for chains of distinct signals. Suppression records activation
diagnostics instead of failing the producer.

V1 does not define retry, queue, dead-letter, backpressure, external delivery,
or total-order semantics.

### Warden rules for activation

- **Orphan signal source.** An `on:` source references a signal ID that no trail declares and that isn't a framework lifecycle signal. Warning.
- **Schema mismatch.** An `on:` source's signal payload schema is incompatible with the trail's input schema. Error.
- **Dangerous scheduled destroy.** A trail with `intent: 'destroy'` and a scheduled `on:` source. Warning.
- **Activation cycle.** Trail A activates on a signal fired by trail B, which activates on a signal fired by trail A. Error.
- **Missing where examples.** An `on:` source with a `where` predicate but no examples. Coaching suggestion.
- **Unreachable trail.** A trail with `visibility: 'internal'` that has no `on` declaration and no crossings. Warning.
- **Override contradicts intent.** An app overrides a trail's `on` in a way that changes the activation semantics (for example, overriding a signal source with a schedule source on a trail whose examples assume signal-shaped input). Warning.

### How activation compounds with existing features

**With packs.** A pack declares `on:` for its trails. When the pack composes into a topo, those activation sources register automatically. The pack author declared the activation. The app author overrides only when needed.

**With visibility.** Reactively fired trails can be `visibility: 'internal'`. They don't appear on trailheads. They activate reactively. Background workers, compensators, and audit trails.

**With parallel composition.** An activated trail can use the array form of `ctx.cross()` for concurrent work. The activation model and the composition model compose without knowing about each other.

**With the signal runtime.** Activation sources consume the signal routing pipeline. Authored signals, framework lifecycle signals, and webhook sources all flow through the same mechanism.

**With the error taxonomy.** The categorized failure signals map directly from the 13 error classes. One error class, multiple derivations.

**With tracing.** Every activation is a trace with provenance. Tracing can report: "this trail was activated 847 times by schedule last week, average duration 1.2s, 3 failures (all TimeoutError)."

## Consequences

### Positive

- **Activation is part of the contract.** `on:` sources are declared on the trail, visible to survey, governed by the warden, testable via examples.
- **Authored defaults with overrides.** The trail declares what activates it. The consuming app can override, extend, or suppress. The lockfile resolves the final state.
- **Three activation source types cover the full space.** Schedule (time), signal (authored + lifecycle + error category), webhook (external inbound). Fewer concepts, one routing mechanism.
- **The framework sees the full picture.** The static call graph (crossings) and the reactive activation graph (`on:` sources) together describe the system's behavior. Both are in the lockfile.
- **Activation conditions are testable.** `where` predicates with examples are tested by `testExamples`.
- **No workflow engine.** Activation sources activate trails. Trails handle composition through crossings. The activation layer and the execution layer stay separate.

### Tradeoffs

- **New field on the trail spec.** `on` adds a concept to learn. The justification: activation is genuinely new information that the framework can't derive.
- **Activation resolution adds startup cost.** Topo construction resolves `on:` sources: register schedules, bind signal consumers, register webhook endpoints.
- **Complex reactive chains.** Deep chains are inspectable via survey and the lockfile, and the warden detects cycles, but emergent behavior of long chains requires attention.
- **Runtime suppression is narrower than static activation governance.** Warden can detect authored activation cycles in the graph, but the runtime still suppresses re-entrant delivery by signal-id membership in the current fire stack. That prevents infinite loops while over-suppressing some legitimate diamond paths until per-path provenance is promoted.
- **Scheduled activation needs runtime infrastructure.** `Bun.cron` for production, mock scheduler for testing.

### What this does NOT decide

- **How webhook activation sources interact with the HTTP trailhead.** The webhook trailhead design covers signature verification and endpoint registration.
- **Whether activation sources support debouncing or throttling.** Future concern addressable with source options.
- **Whether activation sources support batching.** Batching changes timing and input shape. Not part of v1.
- **Outbound signals (publishing to external systems).** `on:` is about inbound activation. Publishing is a separate concern.
- **Replay and reprocessing.** Replaying activations is future work that builds on tracing data.

## References

- [ADR-0000: Core Premise](../0000-core-premise.md) — "derive by default"; `on:` declares activation, the framework derives the reactive graph
- [ADR-0003: Unified Trail Primitive](../0003-unified-trail-primitive.md) — trails with `on:` are still trails. Activation is a property.
- [ADR-0004: Intent as a First-Class Property](../0004-intent-as-first-class-property.md) — intent compounds with activation; lifecycle signals filter by intent
- [ADR-0013: Tracing](../0013-tracing.md) — tracing records activation provenance on every execution
- [ADR-0038: Typed Signal Emission](../0038-typed-signal-emission.md) — **this ADR depends on it**; provides `ctx.fire(signal, payload)`, `fires`, `on`, and the authored signal graph
- [ADR-0026: Error Taxonomy as Transport-Independent Behavior Contract](../0026-error-taxonomy-as-transport-independent-behavior-contract.md) — future delivery semantics may use error categories, but ADR-0038 does not define retry or dead-letter behavior
- [ADR: Unified Observability](20260409-unified-observability.md) (draft) — tracing moves into core; activation provenance is recorded intrinsically by the execution pipeline
- [ADR-0024: Typed Trail Composition](../0024-typed-trail-composition.md) — typed `ctx.cross()` complements signal-based activation; `on:` is for reactive decoupling, `crosses` is for direct composition
- [ADR: Layer Evolution](20260409-layer-evolution.md) (draft) — pipeline stages (auth, recording) apply automatically to activated trails
- ADR: The Serialized Topo Graph (draft) — the lockfile captures the reactive graph
- ADR: Trail Visibility and Trailhead Filtering (draft) — reactively activated trails can be internal
- ADR: Packs as Namespace Boundaries (draft) — packs carry `on:` declarations; overridable in consuming apps
- ADR: Concurrent Cross Composition (draft) — activated trails can use concurrent crossing
