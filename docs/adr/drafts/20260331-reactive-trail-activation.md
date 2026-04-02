---
slug: reactive-trail-activation
title: Reactive Trail Activation
status: draft
created: 2026-03-31
updated: 2026-04-01
owners: ['[galligan](https://github.com/galligan)']
depends_on: [3, 4, 13, typed-event-emission]
---

# ADR: Reactive Trail Activation

## Context

### Trails are callable but not activatable

Every trail in a topo is callable: a surface or `dispatch()` can invoke it with input and receive a Result. But the framework has no concept of *when* a trail should be invoked. Activation logic lives outside the contract: in surface configuration (blaze options), in external schedulers (crontab), in application code (a webhook handler that calls `dispatch`), or in infrastructure (a queue consumer).

This means the framework can't see the reactive graph. Survey reports what trails exist and what they follow. It can't report what activates them. The warden governs trail contracts and composition. It can't govern activation. Crumbs records what happened. It can't attribute the execution to a trigger source.

### Real applications are event-driven

The patterns are everywhere:

- A Stripe webhook triggers booking confirmation
- A nightly schedule triggers data archival
- A trail failure triggers an alert or compensation
- An emitted event triggers a downstream trail
- A config change triggers a cache invalidation

Developers build these patterns today with application code: webhook handlers call `dispatch`, schedulers call `dispatch`, error handlers call `dispatch`. The activation logic works, but it's invisible to the framework. The trigger, the condition, and the action are disconnected.

### The key constraint

Triggers activate trails. That's the boundary. A trigger does not compose trails. It does not orchestrate. It does not branch. It fires, the trail runs, the trail handles composition with normal `follow` inside its implementation.

If someone wants "when X happens, do A then B then C with branching," the answer is: put a trigger on a trail that follows A, B, and C with normal imperative composition. The trigger is the activation layer. The trail is the execution layer. These stay separate.

### Depends on: Events Runtime

The Events Runtime ADR establishes `ctx.emit()`, the `emits` declaration, and framework lifecycle events (`trail.completed`, `trail.failed`, `trail.failed.<category>`). Triggers consume the event routing pipeline. Trail completions and failures are lifecycle events emitted by the framework. Rather than implementing separate trigger types for these, the trigger system listens for events — both authored and framework-emitted — through one mechanism.

## Decision

### `on` field on the trail spec

A trail can declare what activates it with the `on` field:

```typescript
const confirmBooking = trail('booking.confirm', {
  on: trigger('webhook:stripe', {
    event: 'payment_intent.succeeded',
    verify: stripeSignatureVerifier,
  }),
  intent: 'write',
  input: PaymentConfirmationSchema,
  run: async (input, ctx) => {
    const booking = bookingStore.from(ctx);
    return booking.confirmPayment(input.paymentIntentId);
  },
});
```

`on` is optional. Most trails don't have it. They're invoked explicitly via surfaces or `dispatch`. `on` adds reactive activation without changing anything about how the trail works.

A trail with `on` is still a normal trail. It still has an input schema, output schema, examples, intent, and implementation. It's still callable via `dispatch`, `follow`, or surfaces. The trigger is an *additional* invocation path, not the only one.

### Authored defaults, overridable in context

The `on` field is part of the trail's contract — the author's stated design for what activates this trail. It follows the same pattern as `visibility` and `intent`: authored default on the trail, overridable at the pack or app level.

This matters for provisions. A provisioned pack declares `on` for its trails. The consuming app may need different activation:

```typescript
// The provisioned trail declares its default trigger
const notifyBooking = trail('notify.booking-confirmed', {
  on: trigger('event', { id: 'booking.confirmed' }),
  // ...
});

// The consuming app overrides activation
app.override('notify.booking-confirmed', {
  on: trigger('event', { id: 'reservation.finalized' }),
});

// Or suppresses it entirely
app.override('notify.booking-confirmed', {
  on: null,  // disable default trigger
});

// Or adds additional triggers
app.override('notify.booking-confirmed', {
  on: [
    trigger('event', { id: 'booking.confirmed' }),     // keep default
    trigger('event', { id: 'reservation.finalized' }),  // add another
  ],
});
```

The authored `on` documents intent: "I was designed to respond to this." The override enables reuse: "in my app, I need you to respond to that instead." The lockfile resolves the final state. The warden can flag overrides that contradict the original intent.

### Trigger types

Three trigger types. Schedule is the only non-event trigger (time isn't an event, it's a clock). Event triggers handle both authored events and framework lifecycle events through one mechanism. Webhook triggers handle external inbound activation.

#### Schedule triggers

Time-based activation. Cron expressions for recurring schedules.

```typescript
const archiveOld = trail('data.archive-old', {
  on: trigger('schedule', {
    cron: '0 2 * * *',
    input: { olderThanDays: 90 },
  }),
  intent: 'write',
  input: z.object({ olderThanDays: z.number() }),
  run: async (input, ctx) => { /* ... */ },
});
```

The `input` field on the schedule trigger provides static input for each invocation. If omitted, the trail receives an empty object. The trail's input schema validates the trigger's input at topo construction time.

#### Event triggers

Activation when an event is emitted. This covers authored events (via `ctx.emit()`) AND framework lifecycle events (`trail.completed`, `trail.failed`, `trail.failed.<category>`). One trigger type, one routing mechanism.

**Authored event trigger:**

```typescript
const notifyBooking = trail('notify.booking-confirmed', {
  on: trigger('event', { id: 'booking.confirmed' }),
  intent: 'write',
  input: BookingConfirmedSchema,
  run: async (input, ctx) => { /* ... */ },
});
```

**Trail failure trigger (categorized lifecycle event):**

```typescript
const billingConflictResolve = trail('billing.conflict-resolve', {
  on: trigger('event', {
    id: 'trail.failed.conflict',
    where: (e) => e.trailId.startsWith('billing.'),
  }),
  intent: 'write',
  input: TrailFailureSchema,
  run: async (input, ctx) => { /* ... */ },
});
```

The Events Runtime emits categorized failure events: `trail.failed.conflict`, `trail.failed.auth`, `trail.failed.timeout`, etc. Each maps to an error taxonomy category. The trigger binds to a specific category and filters further with `where`. The error taxonomy compounds with triggers: the 13 error classes become event vocabulary for reactive error handling.

#### Webhook triggers

Activation when an external system sends a webhook payload.

```typescript
const githubEventReceived = trail('github.event.received', {
  on: trigger('webhook:github', {
    path: '/webhooks/github',
    verify: githubSignatureVerifier,
  }),
  intent: 'write',
  input: GitHubEventSchema,
  run: async (input, ctx) => { /* ... */ },
});
```

Webhook verification is permit resolution for this activation path — it produces a `Permit` through an adapter, not necessarily a JWT. See the Webhooks ADR for the full webhook surface design.

### Conditional triggers with `where`

Triggers can include a predicate that filters activations:

```typescript
const highValueApproval = trail('approval.high-value', {
  on: trigger('event', {
    id: 'order.completed',
    where: (payload) => payload.total > 10000,
  }),
  intent: 'write',
  input: OrderSchema,
  run: async (input, ctx) => { /* ... */ },
});
```

`where` predicates can have examples:

```typescript
where: {
  predicate: (payload) => payload.total > 10000,
  examples: [
    { payload: { total: 15000 }, fires: true },
    { payload: { total: 5000 }, fires: false },
    { payload: { total: 10000 }, fires: false },
  ],
},
```

`testExamples` validates the predicate against these examples. The trigger condition is part of the contract, testable without the actual event source.

### Multiple triggers on one trail

```typescript
const healthCheck = trail('health.check-all', {
  on: [
    trigger('schedule', { cron: '*/5 * * * *' }),
    trigger('event', { id: 'trail.failed.network' }),
  ],
  intent: 'read',
  input: z.object({}),
  run: async (_input, ctx) => { /* ... */ },
});
```

Each trigger is an independent activation path. The trail's implementation doesn't know which trigger fired (by design: the trail is the execution layer, not the activation layer).

### Trigger resolution and the lockfile

When a topo is constructed, the framework resolves all triggers. The lockfile captures the full reactive graph:

- **Schedule triggers** register with the scheduler service.
- **Event triggers** register as listeners on the event routing pipeline.
- **Webhook triggers** register endpoints on the HTTP surface.

The lockfile records every trigger on every trail, including overrides. This makes the reactive graph inspectable without running the app:

```bash
$ trails survey --triggers
Triggers:
  booking.confirm          ← webhook:stripe (payment_intent.succeeded)
  booking.send-reminders   ← schedule (0 * * * *)
  billing.conflict-resolve ← event (trail.failed.conflict, where: billing.*)
  health.check-all         ← schedule (*/5 * * * *), event (trail.failed.network)

Reactive chains:
  webhook:stripe → booking.confirm → booking.confirmed → notify.booking-confirmed
```

The reactive chain is derived by tracing: trigger activates trail, trail emits event, event activates next trail. The full activation path is inspectable.

Invalid triggers are caught at construction time:

- An event trigger referencing an event ID that no trail emits and that isn't a framework lifecycle event: warning.
- A trigger with a `where` predicate whose input type doesn't match the event's payload schema: error.
- A schedule trigger whose input doesn't validate against the trail's input schema: error.

### Trigger-activated execution uses `dispatch`

When a trigger fires, the framework calls `dispatch(trailId, input)` internally. The trail goes through the full execution pipeline. Crumbs records the execution with trigger provenance:

```json
{
  "trailId": "booking.confirm",
  "trigger": {
    "type": "webhook:stripe",
    "event": "payment_intent.succeeded",
    "receivedAt": "2026-03-31T14:32:05Z"
  },
  "duration": 230,
  "result": "ok"
}
```

Crumbs queries can filter by trigger type: "show me all scheduled executions," "show me all webhook-triggered failures."

### Warden rules for triggers

- **Orphan event trigger.** A trigger references an event ID that no trail emits and that isn't a framework lifecycle event. Warning.
- **Schema mismatch.** A trigger's event payload schema is incompatible with the trail's input schema. Error.
- **Dangerous scheduled destroy.** A trail with `intent: 'destroy'` and a schedule trigger. Warning.
- **Trigger cycle.** Trail A triggers on an event emitted by trail B, which triggers on an event emitted by trail A. Error.
- **Missing where examples.** A trigger with a `where` predicate but no examples. Coaching suggestion.
- **Unreachable trail.** A trail with `visibility: 'internal'` that has no `on` trigger and no followers. Warning.
- **Override contradicts intent.** An app overrides a trail's `on` in a way that changes the activation semantics (e.g., overriding an event trigger with a schedule trigger on a trail whose examples assume event-shaped input). Warning.

### How triggers compound with existing features

**With packs.** A provider pack declares triggers on its trails. When the pack composes into a topo, the triggers register automatically. The pack author declared the activation. The app author overrides only when needed.

**With visibility.** Triggered trails can be `visibility: 'internal'`. They don't appear on surfaces. They activate reactively. Background workers, compensators, and audit trails.

**With parallel composition.** A triggered trail can use the array form of `ctx.follow()` for concurrent work. The activation model and the composition model compose without knowing about each other.

**With the Events Runtime.** Triggers consume the event routing pipeline. Authored events, framework lifecycle events, and webhook events all flow through the same mechanism.

**With the error taxonomy.** The categorized failure events map directly from the 13 error classes. One error class, multiple derivations.

**With crumbs.** Every trigger activation is a crumb with provenance. Crumbs can report: "this trail was activated 847 times by schedule last week, average duration 1.2s, 3 failures (all TimeoutError)."

## Consequences

### Positive

- **Activation is part of the contract.** Triggers are declared on the trail, visible to survey, governed by the warden, testable via examples.
- **Authored defaults with overrides.** The trail declares what activates it. The consuming app can override, extend, or suppress. The lockfile resolves the final state.
- **Three trigger types cover the full space.** Schedule (time), event (authored + lifecycle + error category), webhook (external inbound). Fewer concepts, one routing mechanism.
- **The framework sees the full picture.** The static call graph (follows) and the reactive activation graph (triggers) together describe the system's behavior. Both are in the lockfile.
- **Trigger conditions are testable.** `where` predicates with examples are tested by `testExamples`.
- **No workflow engine.** Triggers activate trails. Trails handle composition with `follow`. The activation layer and the execution layer stay separate.

### Tradeoffs

- **New field on the trail spec.** `on` adds a concept to learn. The justification: activation is genuinely new information that the framework can't derive.
- **Trigger resolution adds startup complexity.** Topo construction resolves triggers: register schedules, bind event listeners, register webhook endpoints.
- **Complex reactive chains.** Deep chains are inspectable via survey and the lockfile, and the warden detects cycles, but emergent behavior of long chains requires attention.
- **Schedule triggers need runtime infrastructure.** `Bun.cron` for production, mock scheduler for testing.

### What this does NOT decide

- **How webhook triggers interact with the HTTP surface.** The webhook ADR covers input adapters, signature verification, and endpoint registration.
- **Whether triggers support debouncing or throttling.** Future concern addressable with trigger options.
- **Whether triggers support batching.** Batching changes timing and input shape. Not part of v1.
- **Outbound events (publishing to external systems).** Triggers are about inbound activation. Publishing is a separate concern.
- **Replay and reprocessing.** Replaying triggers is future work that builds on crumbs data.

## References

- [ADR-0000: Core Premise](../0000-core-premise.md) — "derive by default"; triggers declare activation, the framework derives the reactive graph
- [ADR-0003: Unified Trail Primitive](../0003-unified-trail-primitive.md) — trails with triggers are still trails. Activation is a property.
- [ADR-0004: Intent as a First-Class Property](../0004-intent-as-first-class-property.md) — intent compounds with triggers; lifecycle events filter by intent
- [ADR-0013: Crumbs](../0013-crumbs.md) — crumbs records trigger provenance on every activation
- ADR: Typed Event Emission (draft) — **this ADR depends on it**; provides `ctx.emit()`, lifecycle events, and the event routing pipeline
- ADR: The Serialized Topo Graph (draft) — the lockfile captures the reactive graph
- ADR: Trail Visibility and Surface Filtering (draft) — triggered trails can be internal
- ADR: Packs as Namespace Boundaries (draft) — packs carry trigger declarations; overridable in consuming apps
- ADR: Webhooks and Input Adapters (draft) — webhook triggers delegate to the webhook surface
- ADR: Concurrent Follow Composition (draft) — triggered trails can use concurrent follow
