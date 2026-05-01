---
id: 38
slug: typed-signal-emission
title: Typed Signal Emission
status: accepted
created: 2026-03-31
updated: 2026-05-01
owners: ['[galligan](https://github.com/galligan)']
depends_on: [2, 3, 6, 7, 13, 17, 24, 26]
---

# ADR-0038: Typed Signal Emission

## Context

### Signals had a contract but not a runtime path

The `signal()` primitive already gave Trails a named, schema-typed notification
contract. A topo could know that a signal existed. Survey could list it. The
lockfile could serialize it. But a trail could not yet say "this happened" in a
typed, runtime-observable way.

That gap weakened the primitive. A signal without a fire path is metadata, not a
live graph edge. A trail that completed meaningful work had to either cross
another trail directly or leave follow-up work to application glue.

### The schema must be the first thing preserved

The reason signals belong in Trails is not pub/sub convenience. The reason is
the contract. A signal payload has a schema, inferred TypeScript payload type,
examples, stable ID, and topo identity.

If the runtime accepts untyped strings and arbitrary payloads, the signal
primitive stops compounding with the rest of the framework. The producer can
drift from the contract. Consumers have to guess. Agents lose the ability to
inspect the graph before invoking anything.

The typed signal runtime keeps the schema on the signal contract and threads that
same contract through authoring, runtime validation, testing, tracing, survey,
and the serialized graph.

### Loose coupling still needs graph shape

`ctx.cross()` is the direct composition mechanism. It is the right tool when one
trail intentionally calls another and needs its Result.

Signals serve a different relationship. A producer announces that something
happened. Consumers may react, but the producer should not depend on their
number, ordering, output, or success. That decoupling is useful only if the
graph remains inspectable:

- producers declare `fires: [signal]`,
- consumers declare `on: [signal]`,
- survey and the lockfile show both sides,
- tracing records what actually happened at runtime.

The resolved graph is still the story. Signals add edges to that story; they do
not create a second runtime vocabulary outside it.

## Decision

### Signal contracts own payload schemas

The typed signal runtime starts from authored `signal()` contract objects.

```typescript
const bookingConfirmed = signal('booking.confirmed', {
  description: 'A booking was confirmed and can be observed by downstream trails.',
  payload: z.object({
    bookingId: z.string(),
    confirmedAt: z.string(),
    userId: z.string(),
  }),
  examples: [
    {
      bookingId: 'bk_123',
      confirmedAt: '2026-05-01T12:00:00.000Z',
      userId: 'user_123',
    },
  ],
});
```

The signal contract is the schema owner. It gives `ctx.fire()` its payload type,
gives the runtime its validation boundary, and gives topo/survey/lockfile output
one stable ID to project.

String IDs still appear where they are the right representation: serialized
artifacts, fixture files, and compatibility seams that normalize authored
references to IDs. The runtime fire API is signal-object first.

### Producers fire through `ctx.fire(signal, payload)`

The execution context exposes typed signal firing as:

```typescript
type FireFn = <T>(signal: Signal<T>, payload: T) => Promise<void>;
```

A producing trail declares the signal and then fires the same contract object:

```typescript
const confirmBooking = trail('booking.confirm', {
  input: z.object({ bookingId: z.string(), userId: z.string() }),
  output: z.object({ bookingId: z.string(), status: z.literal('confirmed') }),
  fires: [bookingConfirmed],
  blaze: async (input, ctx) => {
    const booking = await confirmInStore(input);

    await ctx.fire(bookingConfirmed, {
      bookingId: booking.id,
      confirmedAt: booking.confirmedAt,
      userId: input.userId,
    });

    return Result.ok({ bookingId: booking.id, status: 'confirmed' });
  },
});
```

`ctx.fire()` returns `Promise<void>`. It is best-effort from the producer's
perspective. The producer waits for the framework to validate, record, and
attempt local fan-out, but it does not receive a delivery `Result` and it does
not branch on consumer success.

This is deliberate. A producer should not become coupled to consumers through a
return value. Problems in the fire path become diagnostics and trace records,
not producer-facing business results.

### Consumers declare activation with `on: [signal]`

Consumers declare the same signal contract:

```typescript
const sendReceipt = trail('booking.send-receipt', {
  input: bookingConfirmed.payload,
  output: z.object({ sent: z.boolean() }),
  on: [bookingConfirmed],
  blaze: async (input, ctx) => {
    const mailer = await mailerResource.from(ctx);
    await mailer.sendReceipt(input.bookingId, input.userId);
    return Result.ok({ sent: true });
  },
});
```

`fires` and `on` are graph declarations. They serve the same inspectability role
for signals that `crosses` serves for typed trail composition: authored edges
become queryable edges. They are separate from `crosses` because notification
and direct composition have different coupling.

### Invalid payloads become diagnostics

The fire boundary validates payloads against the signal schema. Invalid payloads
record `signal.invalid` diagnostics with schema issues, trace/run/provenance
metadata when available, and redacted payload summaries. They do not throw into
the producer and they do not return `Result.err()` to the producer.

The diagnostic vocabulary is intentionally explicit:

- `signal.invalid`,
- `signal.unknown`,
- `signal.handler.failed`,
- `signal.handler.rejected`,
- `signal.fire.suppressed`.

Strict mode can promote selected diagnostics for environments that want signal
runtime problems to fail louder. The public producer API remains `Promise<void>`.

### Signal tracing is lexicon-aligned

Runtime signal records use `kind: 'signal'` and names that describe the signal
lifecycle:

- `signal.fired`,
- `signal.invalid`,
- `signal.handler.invoked`,
- `signal.handler.completed`,
- `signal.handler.failed`.

Signal trace attributes carry stable IDs, producer trail IDs, consumer trail IDs
when present, trace/run IDs, and redacted payload summaries. Raw payloads are not
recorded by default.

These records make signal behavior observable without turning signals into a
durable delivery system. Tracing answers what happened in this runtime. It does
not promise replay, retry, or external delivery.

### Examples can assert fired signals

Trail examples may assert expected signal fires:

```typescript
examples: [
  {
    name: 'successful confirmation',
    input: { bookingId: 'bk_123', userId: 'user_123' },
    expected: { bookingId: 'bk_123', status: 'confirmed' },
    signals: [
      {
        signal: bookingConfirmed,
        payloadMatch: { bookingId: 'bk_123', userId: 'user_123' },
      },
    ],
  },
],
```

`testExamples` captures `ctx.fire()` calls while exercising the trail and checks
the example assertions. Assertions may match exact payloads or payload subsets,
and may declare `times` when cardinality matters.

The assertion model does not imply total ordering across independent consumers.
If a workflow needs ordering, it should use sequential `ctx.cross()` composition.

### Signals project into topo, lockfile, and survey

Signals are first-class graph nodes. The signal namespace includes payload
schema, examples, producers, consumers, diagnostics/governance metadata, and
user meta where available.

Survey keeps the split shape:

- `survey.signal` answers signal-specific questions,
- `survey.trail` answers trail-specific questions,
- list/overview output exposes activation counts and IDs,
- trail detail shows `fires`, `on`, `activates`, `activatedBy`, and static
  activation chains.

This preserves one graph with many views. There is no separate signal registry
or side-channel discovery model.

### Warden can govern only implemented evidence

The typed signal runtime gives Warden concrete facts to inspect: authored
`fires`/`on` declarations, static `ctx.fire()` usage hooks, example signal
assertions, and the serialized graph shape.

Rules should stay tied to those facts. Warden should not claim enforcement for
future lifecycle signals, durable delivery, schedule/webhook source
materializers, or dead-letter behavior until those capabilities exist.

## Non-goals

Typed signal v1 does not introduce:

- **No `ctx.signal()`.** `signal()` is the contract factory. `ctx.fire()` is the
  runtime method.
- **No public string-fire API.** Runtime authoring uses signal contract objects.
  Stable string IDs are for serialized views, fixtures, and compatibility
  normalization.
- **No generic event bus.** Signals are Trails graph contracts, not freeform
  process-wide pub/sub.
- **No framework lifecycle signal family.** `trail.completed`, `trail.failed`,
  categorized failure signals, and similar framework-authored signals need a
  later ADR.
- **No delivery guarantees beyond current runtime behavior.** V1 records and
  attempts local fan-out. It does not promise persistence, replay, retry,
  exactly-once delivery, total ordering, external subscription delivery, or
  dead-letter queues.
- **No source materializer claims.** Schedule, webhook, subscription, and
  predicate provenance should appear only after the runtime really produces
  that data.
- **No separate reactive test runner.** `testExamples` can assert fired signals.
  A full reactive-chain test mode is a later testing decision.

## Consequences

### Positive

- **The signal primitive becomes live.** A signal is now both a contract and a
  runtime notification path.
- **The schema stays central.** The same signal payload schema drives TypeScript
  inference, runtime validation, examples, survey, lockfile output, diagnostics,
  and trace records.
- **Producers remain decoupled.** A trail can announce what happened without
  depending on consumer outputs or failure modes.
- **Agents can inspect activation shape.** Topo, lockfile, and survey reveal
  producers, consumers, signal payloads, and static chains before execution.
- **Runtime problems are observable.** Invalid payloads, unknown signals,
  suppressed fires, and consumer failures become diagnostics and trace records.

### Tradeoffs

- **`fires` and `on` add authoring surface.** The edge is real information, so
  the trail spec grows. The payoff is queryable graph shape.
- **Best-effort fire hides consumer results from producers.** That keeps loose
  coupling honest, but it means teams must use diagnostics/tracing/tests to see
  signal runtime problems.
- **The runtime is intentionally not durable.** V1 gives typed local
  notification. Systems that need replay, retry, or distributed fan-out need a
  later delivery decision.
- **Signal-cycle suppression is currently signal-ID based.** That prevents
  obvious re-entrant loops but may over-suppress some diamond-shaped fan-out
  patterns until per-path provenance is justified.

### Deferred work

- Durable signal delivery, replay, retry, and dead-letter handling.
- Framework-authored lifecycle signal families.
- External subscription surfaces such as WebSocket and SSE.
- Schedule, webhook, and predicate source materializers.
- Signal versioning and schema evolution policy.
- Full reactive-chain testing beyond local signal assertions.
- Per-path fan-out provenance for more precise cycle suppression.

## References

- [ADR-0000: Core Premise](0000-core-premise.md) - signals reinforce the
  contract-first graph.
- [ADR-0002: Built-In Result Type](0002-built-in-result-type.md) - producer
  business results remain separate from signal diagnostics.
- [ADR-0003: Unified Trail Primitive](0003-unified-trail-primitive.md) -
  `fires` and `on` attach signal edges to trails.
- [ADR-0006: Shared Execution Pipeline](0006-shared-execution-pipeline.md) -
  `ctx.fire()` runs through the surface-agnostic execution context.
- [ADR-0007: Governance as Trails](0007-governance-as-trails.md) - Warden
  governs implemented signal evidence.
- [ADR-0013: Tracing](0013-tracing.md) - signal records extend runtime
  observability.
- [ADR-0017: The Serialized Topo Graph](0017-serialized-topo-graph.md) -
  signals are serialized graph nodes.
- [ADR-0024: Typed Trail Composition](0024-typed-trail-composition.md) -
  `ctx.cross()` remains the direct composition mechanism.
- [ADR-0026: Error Taxonomy as Transport-Independent Behavior Contract](0026-error-taxonomy-as-transport-independent-behavior-contract.md) -
  future delivery decisions may use error categories without changing this
  producer API.
- [ADR: Reactive Trail Activation](drafts/20260331-reactive-trail-activation.md)
  (draft) - future activation sources build on this signal contract.
- [ADR: WebSocket Trailhead](drafts/20260331-websocket-trailhead.md) (draft) -
  external subscriptions remain deferred from ADR-0038's local signal runtime.
