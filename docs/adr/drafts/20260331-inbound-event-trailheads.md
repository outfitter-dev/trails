---
slug: inbound-event-trailheads
title: Inbound Event Trailheads
status: draft
created: 2026-03-31
updated: 2026-04-02
owners: ['[galligan](https://github.com/galligan)']
depends_on: [9, 12, webhooks-and-connectors]
---

# ADR: Inbound Event Trailheads

## Context

Trails has three inbound trailheads: CLI (human types a command), MCP (agent calls a tool), HTTP (client sends a request). All three are request-initiated — something external says "do this" and the framework runs a trail.

But real applications receive events from external systems that also need to trigger trail execution:

### Incoming webhooks

Cal.com receives a Stripe `payment_intent.succeeded` webhook. The payload must be verified (signature check), validated against a schema, and run through a trail that completes the booking.

Payload CMS receives a GitHub webhook when content is pushed. The payload triggers a content sync trail.

The pattern: **external system POSTs a typed payload, the framework verifies, validates, and runs it.**

### Message queue consumers

A Kafka consumer receives order events. Each message maps to a trail: `order.process`, `order.ship`, `order.refund`. The consumer needs to handle partitioning, ordering, backpressure, and acknowledgment — but the business logic is a trail.

The pattern: **a transport delivers messages, the framework maps each to a trail invocation.**

### Scheduled/cron triggers

Cal.com sends booking reminders 24 hours before each event. A nightly cleanup trail archives old data. A health check trail runs every 5 minutes.

The pattern: **time triggers trail execution, with optional input (the current time, a batch of pending items).**

### Shared infrastructure needs

All three are inbound trailheads — they receive something from outside and run a trail. They share the same infrastructure needs as CLI/MCP/HTTP:

- **Config**: endpoint URLs, secrets, queue connection strings
- **Auth**: webhook signature verification, queue auth, cron doesn't need auth but needs permit context for tracker
- **Tracker**: record what arrived, what was run, outcome, timing
- **Validation**: the incoming payload validates against the trail's input schema
- **Error taxonomy**: webhook returns 400 on validation failure, 500 on internal error. Queue nacks on failure. Cron logs the error.

They also follow the same trailhead model: `trailhead()` one-liner, `build*` escape hatch.

## Decision

### Webhooks

Webhooks are HTTP under the hood — they could be a mode of the existing HTTP trailhead rather than a separate package. The trail itself stays trailhead-agnostic. It knows its input schema and its run function. It does not know about HTTP paths or signature verification:

```typescript
const paymentCompleted = trail('billing.payment-completed', {
  intent: 'write',
  input: StripePaymentEventSchema,
  provisions: [bookingStore],
  blaze: async (input, ctx) => {
    const booking = bookingStore.from(ctx);
    return booking.confirmPayment(input.paymentIntentId);
  },
});
```

Webhook configuration lives at the trailhead level, in `trailhead()` options. The verifier is an auth connector that produces a Permit — webhook signature verification IS permit resolution, just through a different connector than bearer tokens:

```typescript
import { trailhead } from '@ontrails/http/hono';

trailhead(app, {
  port: 3000,
  webhooks: {
    '/webhooks/stripe': {
      trail: 'billing.payment-completed',
      verify: stripeSignatureVerifier,  // (headers, body) => Result<Permit, AuthError>
    },
  },
});
```

The execution pipeline is identical to any other trailhead invocation — validate input against the trail's schema, resolve context (the verifier produces the Permit), compose gates, run. The warden can verify that webhook-bound trails have verifiers configured in at least one trailhead.

**What the examples teach us:**

```typescript
examples: [
  {
    name: 'successful payment',
    input: { paymentIntentId: 'pi_123', amount: 5000, currency: 'usd' },
    expected: { bookingId: 'bk_456', status: 'confirmed' },
  },
  {
    name: 'duplicate payment (idempotent)',
    input: { paymentIntentId: 'pi_123', amount: 5000, currency: 'usd' },
    expected: { bookingId: 'bk_456', status: 'already_confirmed' },
  },
],
```

Webhook trails need idempotency examples. The same event may arrive multiple times. `testExamples` validates idempotency with mock provisions.

### Message queues

A queue consumer trailhead maps messages to trails:

```typescript
import { trailhead } from '@ontrails/queue/kafka';

trailhead(app, {
  brokers: ['localhost:9092'],
  topics: {
    'orders': {
      // Message key → trail ID mapping
      'order.created': 'order.process',
      'order.shipped': 'order.notify',
      'order.refunded': 'order.refund',
    },
  },
  // Consumer group, partitioning, etc.
  group: 'order-service',
});
```

Each message deserializes → validates against the trail's input schema → executes through the pipeline. Failed messages nack (or dead-letter). Tracker records each message processing.

**What the examples teach us:**

```typescript
const processOrder = trail('order.process', {
  intent: 'write',
  input: OrderCreatedSchema,
  examples: [
    { name: 'new order', input: { orderId: 'ord_1', items: [...] }, expected: { status: 'processing' } },
    { name: 'out of stock', input: { orderId: 'ord_2', items: [...] }, expectErr: ConflictError },
  ],
  blaze: async (input, ctx) => { ... },
});
```

Queue-consumed trails must handle failures gracefully — the queue will retry. Examples should cover both success and failure paths. The `ConflictError` example tells the queue connector "this is a permanent failure, don't retry" vs `NetworkError` "this is transient, retry."

The error taxonomy maps to queue behavior:

- Retryable errors (timeout, network, rate_limit) → nack + retry
- Permanent errors (validation, not_found, conflict) → nack + dead-letter
- Success → ack

This is the same mapping HTTP does with status codes, just for a different transport.

### Scheduled triggers

```typescript
import { trailhead } from '@ontrails/cron';

trailhead(app, {
  schedules: {
    'booking.send-reminders': { cron: '0 * * * *', input: {} },       // hourly
    'data.archive-old': { cron: '0 2 * * *', input: { olderThanDays: 90 } }, // nightly
    'health.check-services': { cron: '*/5 * * * *', input: {} },      // every 5 min
  },
});
```

The cron trailhead triggers trail execution on a schedule. Input can be static (configured in the schedule) or dynamic (the current time, a batch query). Tracker records each execution.

**What the examples teach us:**

```typescript
const sendReminders = trail('booking.send-reminders', {
  intent: 'write',
  input: z.object({}),  // no input needed — reads from provision
  output: z.object({ sent: z.number(), failed: z.number() }),
  examples: [
    { name: 'three bookings due', input: {}, expected: { sent: 3, failed: 0 } },
    { name: 'no bookings due', input: {}, expected: { sent: 0, failed: 0 } },
  ],
  provisions: [bookingStore, emailService],
  blaze: async (_input, ctx) => {
    const store = bookingStore.from(ctx);
    const email = emailService.from(ctx);
    const due = await store.findDueReminders();
    // ...
  },
});
```

Cron trails are testable via `testExamples` with mock provisions — no actual scheduler needed. The examples validate the business logic independent of timing.

### Implications for infrastructure ADRs

### Webhook verification IS permit resolution

Webhook signature checking is structurally identical to bearer token verification — take credentials (the signature + headers), produce a verified identity (the webhook source). The verifier is just another auth connector that produces a Permit. The core permit type doesn't need to know about credential kinds (bearer, webhook, session, API key) — that's the connector's business. Each connector takes its transport-specific input and outputs the same framework Permit type. ADR-0012's connector-agnostic model holds as-is.

### Error taxonomy maps to every transport

The 13 error classes already map to HTTP status codes, CLI exit codes, and JSON-RPC codes. They also map naturally to queue semantics (retryable → retry, permanent → dead-letter) and webhook responses (400, 500). The error taxonomy is more universal than we realized — it's a transport-independent behavior contract.

Worth noting in the infrastructure pattern doc: error taxonomy mappings should be extensible per trailhead, not hardcoded for the original three.

### Idempotency is an infrastructure concern

`idempotent: true` on a trail spec is a declaration. But webhook trails and queue-consumed trails NEED idempotency — duplicate delivery is the norm. The framework should help:

- An idempotency layer that deduplicates by request/message ID
- A provision that stores processed IDs (could be the same SQLite store as tracker)

This is a gate + provision, following the infrastructure pattern.

### Inbound trailheads share the same `trailhead()` pattern

Every trailhead — including these new inbound ones — follows `trailhead(app, options)`. The framework builds handlers from the topo, the trailhead wires them to its transport. This validates the trailhead model's extensibility.

### The trail spec may need a trailhead-hints field

Webhook trails need a path and verifier. Queue trails need a topic mapping. Cron trails need a schedule. Today these live in `trailhead()` options, separate from the trail. But they're part of the trail's contract — "this trail is triggered by a Stripe webhook at /webhooks/stripe."

Should this be on the trail spec (like `http: { path }` overrides) or on the trailhead config? If it's on the spec, survey can report it. If it's on the trailhead config, it's invisible to introspection.

## Consequences

### Positive

- The trailhead model proves extensible beyond request-initiated patterns — webhooks, queues, and cron all fit the `trailhead(app, options)` shape without special-casing
- Error taxonomy gains broader applicability as a transport-independent behavior contract, mapping naturally to queue retry/dead-letter semantics alongside existing HTTP status and CLI exit code mappings
- Webhook verification unifies with the permit model, avoiding a parallel authentication system
- Examples and `testExamples` validate inbound trailhead trails without running actual schedulers, brokers, or webhook endpoints

### Tradeoffs

- Each new inbound trailhead adds a package to maintain and a transport connector to keep aligned with the execution pipeline
- Idempotency infrastructure (deduplication layer + ID store) is new framework trailhead area that must justify itself across multiple trailhead types
- Trailhead-hints on the trail spec increase the authored trailhead for trail definitions, trading the "reduce ceremony" principle against the "contract is queryable" principle

### Open questions

1. **Webhooks as HTTP sub-trailhead or separate package?** Webhooks are HTTP POSTs. They could be a mode of `@ontrails/http` rather than `@ontrails/webhooks`. But webhook-specific concerns (signature verification, idempotency, retry) are significant enough to justify separation.

2. **Queue trailhead scope.** Should `@ontrails/queue` be generic (any message broker) or start with one concrete connector (`@ontrails/queue/kafka`, `@ontrails/queue/sqs`)? The port-connector pattern suggests a generic core with connector subpaths.

3. **Cron trailhead vs cron gate.** A cron fire source could be a trailhead (`trailhead()` starts a scheduler) or a gate (wraps trails with scheduling metadata). Trailhead is cleaner for standalone use. Gate is better for embedding in an existing app.

4. **Dead letter handling.** When a queue message permanently fails, where does it go? A dead-letter trail? A provision? An event? This needs a pattern.

## References

- [ADR-0009: Provisions as a First-Class Primitive](../0009-first-class-provisions.md) — inbound trailheads depend on the provision primitive for infrastructure dependencies (stores, email, queue clients)
- [ADR-0008: Deterministic Trailhead Derivation](../0008-deterministic-trailhead-derivation.md) — validates that the trailhead derivation model extends to event-driven inbound patterns
- [ADR-0010: Trails-Native Infrastructure Pattern](../0010-native-infrastructure.md) — idempotency layer and deduplication store follow the infrastructure pattern (gate + provision)
- [ADR-0012: Connector-Agnostic Permits](../0012-connector-agnostic-permits.md) — webhook signature verification maps to the permit resolution model
- [ADR-0013: Tracker](../0013-tracker.md) — inbound trailhead execution recording uses the tracker system
- ADR: Webhooks and Input Connectors (draft) — explores the webhook trailhead in more detail
