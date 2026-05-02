---
id: 39
slug: reactive-trail-activation
title: Reactive Trail Activation
status: accepted
created: 2026-03-31
updated: 2026-05-02
owners: ['[galligan](https://github.com/galligan)']
depends_on: [3, 4, 5, 13, 17, 24, 26, 27, 38]
---

# ADR-0039: Reactive Trail Activation

## Context

### Trails were callable before they were activatable

Every trail in a topo is callable. A surface or `run()` can invoke it with
typed input and receive a Result. That tells Trails how work runs, but not when
work should run.

Without an activation contract, real applications put the "when" in external
glue: webhook handlers call `run()`, schedulers call `run()`, application event
buses call `run()`, and background workers keep their own routing tables. The
work executes, but Trails cannot see the reactive graph. Survey cannot explain
what wakes a trail. Warden cannot govern source drift. Tracing cannot attribute
an execution to the source that caused it.

Activation is new authored information. The framework cannot derive "run this
trail when Stripe calls this path" from a trail ID or schema. The developer has
to declare it once, and the framework should project that declaration into
runtime routing, validation, survey, serialized graph state, Warden checks, and
tracing attributes.

### Typed signal emission supplies the local reactive edge

[ADR-0038](0038-typed-signal-emission.md) made `signal()` live: producers
declare `fires: [signal]`, call `ctx.fire(signal, payload)`, and consumers
declare `on: [signal]`. That established the local in-process activation edge.

This decision broadens `on:` from signal-only shorthand into a universal
activation declaration. Signal activation, schedule activation, and webhook
activation all use the same trail field and the same normalized graph shape.

### Activation is not orchestration

Activation sources activate trails. They do not compose trails, branch workflow,
own retries, or replace `ctx.cross()`.

If a source should start "A then B then C", it activates one trail. That trail
uses normal imperative composition with `ctx.cross()` to do the ordered work.
The source is the trigger. The trail is still the unit of behavior.

## Decision

### `on:` declares activation sources

A trail declares inbound activation with `on:`. Entries can be bare signal
references or source objects produced by `signal()`, `schedule()`, or
`webhook()`.

```typescript
const paymentReceived = webhook('webhook.payment.received', {
  path: '/webhooks/payment',
  parse: z.object({ paymentId: z.string() }),
});

const recordPayment = trail('payment.record', {
  input: z.object({ paymentId: z.string() }),
  output: z.object({ recorded: z.boolean() }),
  on: [paymentReceived],
  blaze: async (input) => Result.ok({ recorded: true }),
});
```

`on:` is optional. Trails without `on:` remain explicit trails invoked through
surfaces, `run()`, or `ctx.cross()`.

A trail with `on:` is still a normal trail. It has one input schema, one output
schema, one Result-returning blaze, examples, intent, resources, detours, and
visibility. Activation is an additional invocation path, not a new kind of
trail.

### Activation sources are source shapes, not new primitives

The core primitive set does not grow. `schedule()` and `webhook()` define
activation source objects that are consumed by a trail's `on:` declaration.
They sit next to `signal()` because they need stable IDs, schemas, metadata,
and graph projection, but they do not become standalone topo primitives.

This preserves the primitive hierarchy:

| Concept | Role | Primitive? |
| --- | --- | --- |
| `trail()` | Unit of work | Yes |
| `signal()` | Typed notification node | Yes |
| `schedule()` | Clock source for a trail | No, activation source |
| `webhook()` | HTTP inbound source for a trail | No, activation source |

The normalized runtime trail exposes:

- `trail.on`: signal source IDs for compatibility and signal routing;
- `trail.activationSources`: all source entries, including signal, schedule,
  webhook, source metadata, and optional guards.

### Signal sources materialize through `ctx.fire()`

Signal activation uses the signal runtime accepted in ADR-0038. A producer
declares and fires a signal. Consumers declare that same signal in `on:`.

```typescript
const bookingConfirmed = signal('booking.confirmed', {
  payload: z.object({ bookingId: z.string(), userId: z.string() }),
});

const confirmBooking = trail('booking.confirm', {
  input: z.object({ bookingId: z.string(), userId: z.string() }),
  output: z.object({ bookingId: z.string() }),
  fires: [bookingConfirmed],
  blaze: async (input, ctx) => {
    await ctx.fire(bookingConfirmed, input);
    return Result.ok({ bookingId: input.bookingId });
  },
});

const sendReceipt = trail('booking.send-receipt', {
  input: bookingConfirmed.payload,
  output: z.object({ sent: z.boolean() }),
  on: [bookingConfirmed],
  blaze: async () => Result.ok({ sent: true }),
});
```

Signal dispatch is in-process. `ctx.fire()` validates the payload, records
signal lifecycle diagnostics and trace records, initiates local fan-out, and
keeps producer business results decoupled from consumer results.

### Schedule sources materialize through the schedule runtime

Schedule activation declares a clock source with a cron expression and optional
static input.

```typescript
const nightlyArchive = schedule('schedule.data.archive-old', {
  cron: '0 2 * * *',
  input: { olderThanDays: 90 },
});

const archiveOldData = trail('data.archive-old', {
  input: z.object({ olderThanDays: z.number().int().positive() }),
  output: z.object({ archived: z.number() }),
  on: [nightlyArchive],
  blaze: async (input) => Result.ok({ archived: input.olderThanDays }),
});
```

`createScheduleRuntime(topo, options)` registers schedule sources from the topo,
uses the source input for each tick, evaluates optional guards, and runs the
target trail through the normal execution pipeline. Tests can supply a fake cron
factory, so schedule activation remains deterministic.

### Webhook sources materialize through the HTTP surface

Webhook activation declares an HTTP method/path, a parse schema, and an
optional verification hook. The source is provider-agnostic; provider helpers
wrap `webhook()` rather than inventing provider-specific source kinds.

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getWebhookHeader, PermissionError, Result, webhook } from '@ontrails/core';

const githubIssue = webhook('webhook.github.issue', {
  method: 'POST',
  path: '/webhooks/github/issue',
  parse: z.object({
    action: z.string(),
    issue: z.object({ id: z.number(), title: z.string() }),
  }),
  verify: (request) => {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    const header = getWebhookHeader(request, 'x-hub-signature-256');
    if (secret === undefined || header === undefined) {
      return Result.err(new PermissionError('Invalid webhook signature'));
    }
    // GitHub sends `sha256=<hex HMAC of the raw body>`. Compute the
    // expected HMAC and compare in constant time. `timingSafeEqual`
    // requires equal-length buffers, so guard the length first.
    const signature = header.startsWith('sha256=') ? header.slice(7) : header;
    const body =
      typeof request.body === 'string'
        ? Buffer.from(request.body, 'utf8')
        : Buffer.from(request.body);
    const expected = createHmac('sha256', secret).update(body).digest();
    let received: Buffer;
    try {
      received = Buffer.from(signature, 'hex');
    } catch {
      return Result.err(new PermissionError('Invalid webhook signature'));
    }
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      return Result.err(new PermissionError('Invalid webhook signature'));
    }
    return Result.ok();
  },
});

const receiveIssue = trail('github.issue.receive', {
  input: z.object({
    action: z.string(),
    issue: z.object({ id: z.number(), title: z.string() }),
  }),
  output: z.object({ accepted: z.boolean() }),
  on: [githubIssue],
  blaze: async () => Result.ok({ accepted: true }),
});
```

The HTTP route builder materializes public webhook sources as HTTP routes. The
Hono connector reads the raw body, runs `verify` before JSON parsing, parses the
JSON body, validates it with the source `parse` schema, and then executes the
trail through the same Result/error-taxonomy pipeline used by direct HTTP
routes.

Webhook-activated trails are not also exposed as direct HTTP trail routes by
default. The source path is the public route.

### Guards filter activation without changing trail input

Activation entries can use object form when a source needs metadata or a
predicate guard.

```typescript
const highValueApproval = trail('approval.high-value', {
  input: z.object({ orderId: z.string(), total: z.number() }),
  output: z.object({ requested: z.boolean() }),
  on: [
    {
      source: orderCompleted,
      where: (payload) => payload.total > 10_000,
    },
  ],
  blaze: async () => Result.ok({ requested: true }),
});
```

`where` filters activation. It does not transform input. The same source
payload still has to satisfy the receiving trail's input schema.

### Activation provenance travels through context and tracing

Materialized activation runs through the normal execution pipeline with
activation provenance attached to `TrailContext`.

```typescript
const audit = trail('activation.audit', {
  input: z.object({ id: z.string() }),
  output: z.object({ source: z.string() }),
  on: [nightlyArchive],
  blaze: async (_input, ctx) =>
    Result.ok({ source: ctx.activation?.source.id ?? 'manual' }),
});
```

The provenance includes fire IDs, root/parent fire IDs when applicable, source
ID, source kind, and source-specific attributes such as cron/timezone. Core
tracing projects that data into `trails.activation.*` attributes. The later
observe ADR decides the public observe record contract and sink package shape;
this ADR decides that activation provenance is intrinsic runtime data.

### The resolved graph includes activation sources and edges

Topo validation and graph projection treat activation as first-class resolved
state:

- source kinds must be known;
- source-to-trail edges must be unique;
- the same source ID cannot carry conflicting source options;
- schedule sources validate cron/timezone/input shape;
- webhook sources validate method/path/parse/verify shape;
- source payloads must be compatible with receiving trail input schemas.

Schema projection and the topo store catalog activation sources and activation
edges so survey, locks, and CI can inspect the static reactive graph without
running the app.

### Warden governs source graph drift

Warden rules coach the pieces static validation cannot fully express:

- signal consumers with no producer declaration;
- declared or produced signals with no useful graph edge;
- internal trails that are neither crossed nor activated;
- scheduled destroy trails that deserve explicit scrutiny;
- activation source kinds that are known but not materialized by the current
  stack;
- webhook method/path collisions between webhook sources and direct HTTP routes.

These rules stay evidence-based. Warden should not claim durable delivery,
framework lifecycle signal families, app-level activation overrides, or queue
semantics until those capabilities exist.

## Non-goals

Reactive activation v1 does not define:

- **Activation overrides.** Pack, mount, or app-level overrides that add,
  remove, or replace authored `on:` declarations remain deferred.
- **Framework lifecycle signals.** Families such as `trail.completed`,
  `trail.failed`, and `trail.failed.<category>` remain future signal sources.
- **Direct dynamic dispatch.** There is no public "run every trail activated by
  arbitrary source X" API. Materializers own their source kind.
- **Durable delivery.** Retry, queue, dead-letter, replay, backpressure,
  exactly-once, external delivery, and total-order semantics are out of scope.
- **Provider-specific webhook connectors.** This ADR accepts the universal
  source shape. Stripe/GitHub/etc. helpers can wrap it later.
- **Outbound subscription surfaces.** WebSocket, SSE, and external signal
  publication remain separate decisions.
- **Source option sugar.** Debounce, throttle, batching, delivery policy, and
  helper chaining are deferred until the base source graph has more use.

## Consequences

### Positive

- **Activation becomes queryable contract data.** Agents can inspect what wakes
  a trail before invoking anything.
- **One field covers local, clock, and HTTP inbound activation.** `on:` is the
  graph edge regardless of source kind.
- **The trail remains the unit of behavior.** Activation starts work; `ctx.cross`
  composes work.
- **Source declarations multiply.** The same authored source feeds runtime
  materialization, validation, Warden, survey, serialized graph state, and
  tracing provenance.
- **Activation runtime records are shared observability data.** The
  [Unified Observability](0041-unified-observability.md) ADR
  defines the public `activation.*` trace record names for schedule, webhook,
  and safety boundaries.
- **External inbound activation is surface-derived.** Webhook paths are rendered
  by the HTTP surface from the topo instead of maintained in application glue.

### Tradeoffs

- **The trail spec grows.** `on:` and source factories add API surface. The
  justification is that activation is real authored information.
- **Materializers are source-specific.** Signal, schedule, and webhook sources
  share graph shape, but each still needs a runtime that knows how to receive
  that kind of source.
- **In-process dispatch is intentionally modest.** It is observable and
  governed, but not durable.
- **Guards are runtime predicates.** They keep source declarations expressive,
  but they are not fully statically inspectable.
- **Webhook routes add collision space.** HTTP materialization must reject
  collisions with direct trail routes and other webhook sources.

### Deferred Work

- App/pack/mount-level activation overrides.
- Framework-authored lifecycle signals.
- Durable signal or activation delivery.
- Provider-specific webhook helper packages.
- More precise per-path fan-out provenance for complex signal graphs.

## References

- [ADR-0000: Core Premise](0000-core-premise.md) - activation follows
  "author what's new, derive what's known."
- [ADR-0003: Unified Trail Primitive](0003-unified-trail-primitive.md) -
  activated trails remain ordinary trails.
- [ADR-0004: Intent as a First-Class Property](0004-intent-as-first-class-property.md) -
  intent continues to drive surface behavior and governance for activated
  trails.
- [ADR-0005: Framework-Agnostic HTTP Route Model](0005-framework-agnostic-http-route-model.md) -
  webhook materialization extends HTTP route derivation.
- [ADR-0013: Tracing](0013-tracing.md) - activation provenance is projected into
  runtime traces.
- [ADR-0017: The Serialized Topo Graph](0017-serialized-topo-graph.md) -
  activation sources and edges belong in the resolved graph.
- [ADR-0024: Typed Trail Composition](0024-typed-trail-composition.md) -
  `ctx.cross()` remains the composition mechanism after activation.
- [ADR-0026: Error Taxonomy as Transport-Independent Behavior Contract](0026-error-taxonomy-as-transport-independent-behavior-contract.md) -
  activated executions use the same error categories and surface mappings.
- [ADR-0027: Trail Visibility and Surface Filtering](0027-visibility-and-filtering.md) -
  activated trails can stay internal to direct surfaces.
- [ADR-0038: Typed Signal Emission](0038-typed-signal-emission.md) - signal
  activation builds on typed `ctx.fire()`.
- [HTTP Surface](../surfaces/http.md) - current webhook materialization guide.
- [ADR-0041: Unified Observability](0041-unified-observability.md) - decides
  the public observe package and sink composition layer.
