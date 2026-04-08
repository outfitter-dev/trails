---
slug: webhooks-and-connectors
title: Webhooks and Connectors
status: draft
created: 2026-03-31
updated: 2026-04-02
owners: ['[galligan](https://github.com/galligan)']
depends_on: [5, 12, typed-signal-emission, reactive-trail-activation]
---

# ADR: Webhooks and Connectors

## Context

### The trail contract is clean. The external world is not

A trail has a typed input schema. The developer designed it. It makes sense for the trail's domain. `PaymentConfirmationSchema` has `paymentIntentId`, `amount`, `currency`. Clean, minimal, purpose-built.

Stripe's webhook payload is a deeply nested JSON object with dozens of fields, metadata, and Stripe-specific structure. The trail doesn't want all of that. It wants three fields extracted and validated.

Today's HTTP trailhead assumes the inbound request body matches the trail's input schema. Parse, validate, execute. That works for APIs where the client speaks the trail's contract. It doesn't work for webhooks, where the external system speaks *its own* contract and the trailhead must translate.

### This is not just a webhook problem

The mismatch between external payload format and trail input schema appears in several contexts:

- **Webhooks.** Stripe, GitHub, Linear, Cal.com all send their own payload formats.
- **Queue messages.** A Kafka message from another team's service uses their schema, not yours.
- **Legacy endpoints.** A v1 API consumer sends the old payload format. Your trail expects the new one.
- **MCP parameter reshaping.** An MCP client sends parameters in a shape that needs restructuring before it matches the trail's input.
- **Rigged trail output as input.** A rigged trail's parsed output feeds into another trail whose input schema is different.

In every case, the trail's input schema is correct. The trailhead receives data in a different shape. Something must translate.

### What a webhook additionally requires

Beyond input transformation, webhooks need:

- **Signature verification.** The payload must be authenticated before processing. Stripe signs with HMAC-SHA256. GitHub signs with HMAC-SHA256. Each provider has a different verification algorithm, different header locations for the signature, and different key management.
- **Endpoint registration.** The webhook needs an HTTP path. This path is not derived from the trail ID the way regular routes are (you don't want `/api/billing/confirm` as your Stripe webhook URL; you want `/webhooks/stripe`).
- **Idempotency.** Webhook providers retry on failure. The same event may arrive multiple times. The trail must handle duplicates gracefully, or the trailhead must deduplicate.
- **Acknowledgment semantics.** The webhook sender expects a 200 quickly. Long-running trail execution should not block the HTTP response. The trailhead may need to accept, respond 200, and run asynchronously.

### Verification is permit resolution

Webhook signature checking is structurally identical to any other credential verification. Take credentials (the signature header + the raw body), produce a verified identity (the webhook source, its event type, its trust level). The result is a `Permit`: "this request is a verified Stripe webhook for event `payment_intent.succeeded`."

If the permit model can't accommodate webhook verification, the framework needs a separate verification system that duplicates the same pattern. That's the wrong outcome. Verification should flow through the same permit resolution path as any other auth connector — the mechanism that produces the `Permit` varies (HMAC signature, bearer token, API key, session cookie), but the output is always a `Permit`.

## Decision

### Input connectors as a trailhead-level concept

An input connector transforms external data into a trail's input schema. It sits between the trailhead's raw input parsing and the trail's input validation:

```text
Trailhead receives data
  → Input connector transforms to trail's expected shape
  → Trail's input schema validates
  → executeTrail runs
```

Without an connector, the trailhead passes parsed data directly to the trail's schema (today's behavior). With an connector, the trailhead transforms first, then validates. The connector is trailhead configuration, not trail configuration. The trail's input schema stays clean.

```typescript
const stripeConnector = inputConnector({
  from: StripeWebhookPayloadSchema,
  to: PaymentConfirmationSchema,
  transform: (payload) => ({
    paymentIntentId: payload.data.object.id,
    amount: payload.data.object.amount,
    currency: payload.data.object.currency,
  }),
});
```

The connector declares its source schema (`from`) and target schema (`to`). The `transform` function maps between them. Both schemas are Zod objects, so the framework can validate the connector at construction time: does the transform's output satisfy the `to` schema?

The connector can have examples:

```typescript
const stripeConnector = inputConnector({
  from: StripeWebhookPayloadSchema,
  to: PaymentConfirmationSchema,
  transform: (payload) => ({
    paymentIntentId: payload.data.object.id,
    amount: payload.data.object.amount,
    currency: payload.data.object.currency,
  }),
  examples: [
    {
      name: 'successful payment',
      from: {
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_123', amount: 5000, currency: 'usd' } },
      },
      to: { paymentIntentId: 'pi_123', amount: 5000, currency: 'usd' },
    },
  ],
});
```

Connector examples are testable. `testExamples` validates that the transform produces the expected output for each example input. The connector contract is tested independently of the trail, the webhook infrastructure, and the external provider.

### Webhooks as an HTTP trailhead mode

Webhooks are HTTP POST endpoints with specific concerns: verification, input adaptation, endpoint paths. They're a mode of the HTTP trailhead, not a separate trailhead. The HTTP trailhead already handles POST requests, status code responses, and error mapping. Webhooks add verification and transformation.

```typescript
import { trailhead } from '@ontrails/http/hono';

trailhead(app, {
  port: 3000,
  webhooks: {
    '/webhooks/stripe': {
      trail: 'booking.confirm',
      verify: stripeVerifier,
      connector: stripeConnector,
    },
    '/webhooks/github': {
      trail: 'github.event.received',
      verify: githubVerifier,
      // no connector: payload passes through directly
    },
  },
});
```

The `webhooks` config on trailhead options registers webhook endpoints alongside regular trail routes. Each webhook specifies:

- **`trail`**: the trail ID to run.
- **`verify`**: the verification function (signature checking).
- **`connector`** (optional): the input connector that transforms the payload.

If no connector is specified, the raw parsed payload is passed directly to the trail's input schema for validation. This works when the trail's input schema matches the webhook payload (e.g., the trail is designed to accept the provider's raw format).

### Verification functions

A verifier takes the raw request and produces a Result:

```typescript
type WebhookVerifier = (request: {
  headers: Headers;
  body: string;
  secret: string;
}) => Result<WebhookIdentity, AuthError>;

type WebhookIdentity = {
  provider: string;
  event: string;
  deliveryId?: string;
  timestamp?: string;
};
```

The verifier receives headers, the raw body (before JSON parsing, since signature verification needs the raw bytes), and the webhook secret (resolved from config). It returns a `WebhookIdentity` on success or an `AuthError` on failure.

The `WebhookIdentity` becomes the trail's `Permit` for this execution. The framework treats webhook verification as permit resolution: the verifier is a permit connector for this endpoint, just like any other auth connector that produces a `Permit`.

Built-in verifiers for common providers:

```typescript
import { verifyStripe, verifyGitHub, verifyLinear } from '@ontrails/http/webhooks';

// Each verifier knows its provider's signature algorithm and header conventions
trailhead(app, {
  webhooks: {
    '/webhooks/stripe': {
      trail: 'billing.payment-completed',
      verify: verifyStripe,
      connector: stripeConnector,
    },
  },
});
```

Custom verifiers follow the same signature for any provider:

```typescript
const verifyMyProvider = (req) => {
  const signature = req.headers.get('X-My-Signature');
  const expected = hmacSha256(req.body, req.secret);
  if (signature !== expected) {
    return Result.err(new AuthError('Invalid webhook signature'));
  }
  return Result.ok({
    provider: 'my-provider',
    event: JSON.parse(req.body).event_type,
    deliveryId: req.headers.get('X-Delivery-ID'),
  });
};
```

### Webhook execution pipeline

The webhook endpoint follows a specific pipeline:

```text
POST /webhooks/stripe
  → Read raw body (preserve for signature verification)
  → Resolve webhook secret from config
  → verify(headers, rawBody, secret) → WebhookIdentity or AuthError
  → If AuthError: return 401
  → Parse body as JSON
  → connector.transform(parsedBody) → trail input (or pass through if no connector)
  → Validate against trail's input schema
  → If ValidationError: return 400
  → executeTrail(trail, validatedInput, { permit: webhookIdentity })
  → Return 200 (success) or error status (from error taxonomy)
```

The pipeline is mostly the standard HTTP execution path with two additions: verification before parsing, and optional transformation before validation. The same `executeTrail` function runs the trail. The same error taxonomy maps to HTTP status codes.

### Webhook secrets in config

Webhook secrets resolve from the app's config, following the config ADR patterns:

```typescript
// In the provider pack's config schema
config: z.object({
  webhookSecret: z.string().env('STRIPE_WEBHOOK_SECRET').secret(),
}),
```

The secret is not hardcoded in the webhook config. It's resolved at runtime from the config system. The `.secret()` marker ensures it's redacted in logs and config.explain output.

### Acknowledgment and async execution

For long-running trails, the webhook endpoint should respond quickly and run asynchronously:

```typescript
'/webhooks/stripe': {
  trail: 'billing.payment-completed',
  verify: verifyStripe,
  connector: stripeConnector,
  async: true,  // respond 202, run in background
},
```

When `async: true`, the endpoint verifies and validates, responds 202 (Accepted), and runs the trail in the background. The trail's Result is recorded by tracing but not returned to the webhook sender.

Default is `false` (synchronous): verify, validate, execute, respond with the result status. This is simpler and correct for fast trails.

### Idempotency

Webhook providers include a delivery ID in headers (`Stripe-Idempotency-Key`, `X-GitHub-Delivery`). The verifier extracts this as `deliveryId` on the `WebhookIdentity`.

An optional idempotency layer checks the delivery ID against a store before dispatching:

```typescript
'/webhooks/stripe': {
  trail: 'billing.payment-completed',
  verify: verifyStripe,
  connector: stripeConnector,
  idempotent: true,  // deduplicate by deliveryId
},
```

When `idempotent: true`, the trailhead checks `deliveryId` against the tracing store (or a dedicated idempotency store). If the delivery has already been processed, the trailhead returns 200 without re-dispatching. This is a trailhead-level concern, not a trail concern. The trail doesn't know about deduplication.

### Interaction with triggers

The activation ADR introduces `on: [{ webhook: 'stripe', ... }]` on the trail spec. The fires declaration captures the activation intent. The webhook trailhead config in `trailhead()` handles the HTTP concerns. These are complementary:

- **The fires declaration** says "this trail is activated by Stripe webhooks." It's part of the trail's contract. Survey reports it. The warden governs it.
- **The webhook config** says "Stripe webhooks arrive at `/webhooks/stripe`, verified with this function, adapted with this transformer." It's trailhead configuration.

When a trail has a webhook trigger AND the HTTP trailhead has webhook config, the framework connects them: the trigger's declaration matches the webhook config's trail reference. Survey reports the full path: "Stripe webhook at `/webhooks/stripe` → verify → adapt → `booking.confirm`."

If a trail has a webhook trigger but no corresponding webhook config in blaze, the warden warns: "trail `booking.confirm` declares a webhook trigger but no webhook endpoint is configured."

### Input connectors generalize beyond webhooks

Input connectors are defined independently of webhooks because the pattern applies to any trailhead that receives data in a non-trail format:

```typescript
// Queue message adaptation
const orderMessageConnector = inputConnector({
  from: KafkaOrderMessageSchema,
  to: OrderProcessSchema,
  transform: (msg) => ({
    orderId: msg.key,
    items: msg.value.line_items,
    total: msg.value.total_cents / 100,
  }),
});

// Legacy API endpoint adaptation
const v1Connector = inputConnector({
  from: V1RequestSchema,
  to: V2RequestSchema,
  transform: (v1) => ({
    name: v1.full_name,
    email: v1.email_address,
    role: v1.user_type === 'admin' ? 'administrator' : 'member',
  }),
});
```

Any trailhead can use an input connector. The webhook trailhead uses them most naturally, but the queue trailhead and HTTP trailhead can also reference connectors for specific endpoints or message types.

### Testing webhooks

Webhook trails are tested like any other trail via `testExamples`. The trail doesn't know about webhooks. It has an input schema and examples.

The connector is tested separately via its own examples: does the transform produce the expected output from the provider's payload format?

The verifier is tested separately: does it accept valid signatures and reject invalid ones?

The full webhook pipeline (verify → adapt → execute) is tested via the HTTP trailhead harness:

```typescript
import { testWebhook } from '@ontrails/testing';

testWebhook(app, '/webhooks/stripe', {
  headers: { 'Stripe-Signature': validSignature },
  body: stripePayload,
  expectedTrail: 'booking.confirm',
  expectedInput: { paymentIntentId: 'pi_123', amount: 5000, currency: 'usd' },
  expectedStatus: 200,
});
```

`testWebhook` validates the full chain: verification passes, adaptation produces correct input, the trail executes, the response is correct. The mock resource factories provide test infrastructure. No real Stripe required.

## Consequences

### Positive

- **Input connectors are a general-purpose concept.** Webhooks motivated the design, but connectors work for any trailhead that receives non-trail-shaped input. The pattern is useful for queues, legacy APIs, MCP parameter reshaping, and cross-system integration.
- **Verification is permit resolution.** Webhook signature checking flows through the same permit connector model as any other auth mechanism. No separate verification system. The `WebhookIdentity` becomes the `Permit`.
- **Connectors are testable contracts.** The `from`/`to` schemas and transform function have their own examples. Connector correctness is verified independently of the trail and the external provider.
- **Webhooks are an HTTP mode, not a separate trailhead.** No new trailhead package. No new `trailhead()` entrypoint. The HTTP trailhead gains a `webhooks` config alongside its existing route derivation. One trailhead, two modes.
- **Idempotency is trailhead-level.** The trail doesn't know about deduplication. The trailhead handles it. This is the right separation because idempotency depends on the delivery mechanism (webhook delivery ID, queue message ID), not on the trail logic.

### Tradeoffs

- **Connector authoring is manual.** The developer writes the transform function. For common providers (Stripe, GitHub), built-in connectors or connector packs can amortize this. But each new provider integration needs a new connector.
- **Two schemas per webhook.** The provider's payload schema (`from`) and the trail's input schema (`to`). Both must be maintained. If the provider changes their payload format, the connector needs updating. This is inherent to the problem: you're bridging two contracts.
- **Webhook config in `trailhead()` is trailhead-side.** The endpoint path, verification function, and connector are configured on trailhead options, not on the trail spec. This is correct (the trail shouldn't know about HTTP paths) but means the webhook wiring is split between the trail (`on: [{ webhook: '...' }]`) and the trailhead (`trailhead({ webhooks: ... })`). The warden validates consistency between the two.
- **Async run adds complexity.** The `async: true` option introduces background execution, which means the webhook response doesn't reflect the trail's result. Tracing records the result, but the webhook sender only sees 202. This is standard for long-running webhook handlers but adds operational complexity.

### What this does NOT decide

- **Outbound webhooks (sending webhooks to external systems).** This ADR covers inbound webhooks. Sending webhooks is a different concern: serialization, retry logic, delivery tracking, failure handling. That's future work, likely as a service or a pack pattern.
- **Which providers get built-in verifiers and connectors.** Stripe, GitHub, and Linear are likely first candidates. The set grows based on ecosystem demand.
- **Whether connectors should support streaming transformation.** Current connectors transform a complete payload. Streaming connectors (for large payloads or chunked delivery) are a future extension.
- **Global webhook layers.** Rate limiting, IP allowlisting, payload size limits: these are HTTP layers concerns that apply to webhook endpoints. They're handled by the HTTP trailhead's existing layer model, not by the webhook config.

## References

- [ADR-0000: Core Premise](../0000-core-premise.md) -- "author what's new, derive what's known"; the trail's input schema is the clean contract, the connector transforms the messy external world
- [ADR-0005: Framework-Agnostic HTTP Route Model](../0005-framework-agnostic-http-route-model.md) -- webhooks extend the HTTP route model with verification and adaptation
- [ADR-0006: Shared Execution Pipeline](../0006-shared-execution-pipeline.md) -- `executeTrail` runs the trail after verification and adaptation; the pipeline is unchanged
- [ADR-0008: Deterministic Trailhead Derivation](../0008-deterministic-trailhead-derivation.md) -- webhook endpoints are not derived from trail IDs; they're explicitly configured paths
- [ADR-0013: Tracing](../0013-tracing.md) -- tracing records async trail results and provides the idempotency store for delivery deduplication
- ADR: The Serialized Topo Graph (draft) -- webhook secrets resolve through the config system; lockfile captures the resolved config shape
- ADR: Reactive Trail Activation (draft) -- webhook triggers declare activation intent on the trail; webhook trailhead config handles HTTP concerns
- ADR: Trail Visibility and Trailhead Filtering (draft) -- webhook-triggered trails may be internal (not surfaced on CLI or MCP)
- ADR: Packs as Namespace Boundaries (draft) -- provider packs can include built-in verifiers and connectors for their webhooks
