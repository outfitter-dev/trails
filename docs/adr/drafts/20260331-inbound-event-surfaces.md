---
slug: inbound-event-surfaces
title: Inbound Event Surfaces
status: draft
created: 2026-03-31
updated: 2026-04-01
owners: ['[galligan](https://github.com/galligan)']
depends_on: [9, 12, webhooks-and-adapters]
---

# ADR: Inbound Event Surfaces

## Context

Trails has three inbound surfaces: CLI (human types a command), MCP (agent calls a tool), HTTP (client sends a request). All three are request-initiated — something external says "do this" and the framework dispatches a trail.

But real applications receive events from external systems that also need to trigger trail execution:

### Incoming webhooks

Cal.com receives a Stripe `payment_intent.succeeded` webhook. The payload must be verified (signature check), validated against a schema, and dispatched to a trail that completes the booking.

Payload CMS receives a GitHub webhook when content is pushed. The payload triggers a content sync trail.

The pattern: **external system POSTs a typed payload, the framework verifies, validates, and dispatches.**

### Message queue consumers

A Kafka consumer receives order events. Each message maps to a trail: `order.process`, `order.ship`, `order.refund`. The consumer needs to handle partitioning, ordering, backpressure, and acknowledgment — but the business logic is a trail.

The pattern: **a transport delivers messages, the framework maps each to a trail invocation.**

### Scheduled/cron triggers

Cal.com sends booking reminders 24 hours before each event. A nightly cleanup trail archives old data. A health check trail runs every 5 minutes.

The pattern: **time triggers trail execution, with optional input (the current time, a batch of pending items).**

### Shared infrastructure needs

All three are inbound surfaces — they receive something from outside and dispatch a trail. They share the same infrastructure needs as CLI/MCP/HTTP:

- **Config**: endpoint URLs, secrets, queue connection strings
- **Auth**: webhook signature verification, queue auth, cron doesn't need auth but needs permit context for crumbs
- **Crumbs**: record what arrived, what was dispatched, outcome, timing
- **Validation**: the incoming payload validates against the trail's input schema
- **Error taxonomy**: webhook returns 400 on validation failure, 500 on internal error. Queue nacks on failure. Cron logs the error.

They also follow the same surface model: `blaze()` one-liner, `build*` escape hatch.

## Decision

### Webhooks

Webhooks are HTTP under the hood — they could be a mode of the existing HTTP surface rather than a separate package. The trail itself stays surface-agnostic. It knows its input schema and its run function. It does not know about HTTP paths or signature verification:

```typescript
const paymentCompleted = trail('billing.payment-completed', {
  intent: 'write',
  input: StripePaymentEventSchema,
  services: [bookingStore],
  run: async (input, ctx) => {
    const booking = bookingStore.from(ctx);
    return booking.confirmPayment(input.paymentIntentId);
  },
});
```

Webhook configuration lives at the surface level, in `blaze()` options. The verifier is an auth adapter that produces a Permit — webhook signature verification IS permit resolution, just through a different adapter than bearer tokens:

```typescript
import { blaze } from '@ontrails/http/hono';

blaze(app, {
  port: 3000,
  webhooks: {
    '/webhooks/stripe': {
      trail: 'billing.payment-completed',
      verify: stripeSignatureVerifier,  // (headers, body) => Result<Permit, AuthError>
    },
  },
});
```

The execution pipeline is identical to any other surface invocation — validate input against the trail's schema, resolve context (the verifier produces the Permit), compose layers, run. The warden can verify that webhook-bound trails have verifiers configured in at least one surface.

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

Webhook trails need idempotency examples. The same event may arrive multiple times. `testExamples` validates idempotency with mock services.

### Message queues

A queue consumer surface maps messages to trails:

```typescript
import { blaze } from '@ontrails/queue/kafka';

blaze(app, {
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

Each message deserializes → validates against the trail's input schema → dispatches through `executeTrail`. Failed messages nack (or dead-letter). Crumbs records each message processing.

**What the examples teach us:**

```typescript
const processOrder = trail('order.process', {
  intent: 'write',
  input: OrderCreatedSchema,
  examples: [
    { name: 'new order', input: { orderId: 'ord_1', items: [...] }, expected: { status: 'processing' } },
    { name: 'out of stock', input: { orderId: 'ord_2', items: [...] }, expectErr: ConflictError },
  ],
  run: async (input, ctx) => { ... },
});
```

Queue-consumed trails must handle failures gracefully — the queue will retry. Examples should cover both success and failure paths. The `ConflictError` example tells the queue adapter "this is a permanent failure, don't retry" vs `NetworkError` "this is transient, retry."

The error taxonomy maps to queue behavior:

- Retryable errors (timeout, network, rate_limit) → nack + retry
- Permanent errors (validation, not_found, conflict) → nack + dead-letter
- Success → ack

This is the same mapping HTTP does with status codes, just for a different transport.

### Scheduled triggers

```typescript
import { blaze } from '@ontrails/cron';

blaze(app, {
  schedules: {
    'booking.send-reminders': { cron: '0 * * * *', input: {} },       // hourly
    'data.archive-old': { cron: '0 2 * * *', input: { olderThanDays: 90 } }, // nightly
    'health.check-services': { cron: '*/5 * * * *', input: {} },      // every 5 min
  },
});
```

The cron surface triggers trail execution on a schedule. Input can be static (configured in the schedule) or dynamic (the current time, a batch query). Crumbs records each execution.

**What the examples teach us:**

```typescript
const sendReminders = trail('booking.send-reminders', {
  intent: 'write',
  input: z.object({}),  // no input needed — reads from service
  output: z.object({ sent: z.number(), failed: z.number() }),
  examples: [
    { name: 'three bookings due', input: {}, expected: { sent: 3, failed: 0 } },
    { name: 'no bookings due', input: {}, expected: { sent: 0, failed: 0 } },
  ],
  services: [bookingStore, emailService],
  run: async (_input, ctx) => {
    const store = bookingStore.from(ctx);
    const email = emailService.from(ctx);
    const due = await store.findDueReminders();
    // ...
  },
});
```

Cron trails are testable via `testExamples` with mock services — no actual scheduler needed. The examples validate the business logic independent of timing.

### Implications for infrastructure ADRs

### Webhook verification IS permit resolution

Webhook signature checking is structurally identical to bearer token verification — take credentials (the signature + headers), produce a verified identity (the webhook source). The verifier is just another auth adapter that produces a Permit. The core permit type doesn't need to know about credential kinds (bearer, webhook, session, API key) — that's the adapter's business. Each adapter takes its transport-specific input and outputs the same framework Permit type. ADR-0012's adapter-agnostic model holds as-is.

### Error taxonomy maps to every transport

The 13 error classes already map to HTTP status codes, CLI exit codes, and JSON-RPC codes. They also map naturally to queue semantics (retryable → retry, permanent → dead-letter) and webhook responses (400, 500). The error taxonomy is more universal than we realized — it's a transport-independent behavior contract.

Worth noting in the infrastructure pattern doc: error taxonomy mappings should be extensible per surface, not hardcoded for the original three.

### Idempotency is an infrastructure concern

`idempotent: true` on a trail spec is a declaration. But webhook trails and queue-consumed trails NEED idempotency — duplicate delivery is the norm. The framework should help:

- An idempotency layer that deduplicates by request/message ID
- A service that stores processed IDs (could be the same SQLite store as crumbs)

This is a layer + service, following the infrastructure pattern.

### Inbound surfaces share the same `blaze()` pattern

Every surface — including these new inbound ones — follows `blaze(app, options)`. The framework builds handlers from the topo, the surface wires them to its transport. This validates the surface model's extensibility.

### The trail spec may need a surface-hints field

Webhook trails need a path and verifier. Queue trails need a topic mapping. Cron trails need a schedule. Today these live in `blaze()` options, separate from the trail. But they're part of the trail's contract — "this trail is triggered by a Stripe webhook at /webhooks/stripe."

Should this be on the trail spec (like `http: { path }` overrides) or on the surface config? If it's on the spec, survey can report it. If it's on the surface config, it's invisible to introspection.

## Consequences

### Positive

- The surface model proves extensible beyond request-initiated patterns — webhooks, queues, and cron all fit the `blaze(app, options)` shape without special-casing
- Error taxonomy gains broader applicability as a transport-independent behavior contract, mapping naturally to queue retry/dead-letter semantics alongside existing HTTP status and CLI exit code mappings
- Webhook verification unifies with the permit model, avoiding a parallel authentication system
- Examples and `testExamples` validate inbound surface trails without running actual schedulers, brokers, or webhook endpoints

### Tradeoffs

- Each new inbound surface adds a package to maintain and a transport adapter to keep aligned with the execution pipeline
- Idempotency infrastructure (deduplication layer + ID store) is new framework surface area that must justify itself across multiple surface types
- Surface-hints on the trail spec increase the authored surface for trail definitions, trading the "reduce ceremony" principle against the "contract is queryable" principle

### Open questions

1. **Webhooks as HTTP sub-surface or separate package?** Webhooks are HTTP POSTs. They could be a mode of `@ontrails/http` rather than `@ontrails/webhooks`. But webhook-specific concerns (signature verification, idempotency, retry) are significant enough to justify separation.

2. **Queue surface scope.** Should `@ontrails/queue` be generic (any message broker) or start with one concrete adapter (`@ontrails/queue/kafka`, `@ontrails/queue/sqs`)? The port-adapter pattern suggests a generic core with adapter subpaths.

3. **Cron surface vs cron layer.** A cron trigger could be a surface (`blaze()` starts a scheduler) or a layer (wraps trails with scheduling metadata). Surface is cleaner for standalone use. Layer is better for embedding in an existing app.

4. **Dead letter handling.** When a queue message permanently fails, where does it go? A dead-letter trail? A service? An event? This needs a pattern.

## References

- [ADR-0009: Services as a First-Class Primitive](../0009-first-class-services.md) — inbound surfaces depend on the service primitive for infrastructure dependencies (stores, email, queue clients)
- [ADR-0008: Deterministic Surface Derivation](../0008-deterministic-surface-derivation.md) — validates that the surface derivation model extends to event-driven inbound patterns
- [ADR-0010: Trails-Native Infrastructure Pattern](../0010-native-infrastructure.md) — idempotency layer and deduplication store follow the infrastructure pattern (layer + service)
- [ADR-0012: Adapter-Agnostic Permits](../0012-adapter-agnostic-permits.md) — webhook signature verification maps to the permit resolution model
- [ADR-0013: Crumbs](../0013-crumbs.md) — inbound surface execution recording uses the crumbs system
- ADR: Webhooks and Input Adapters (draft) — explores the webhook surface in more detail
