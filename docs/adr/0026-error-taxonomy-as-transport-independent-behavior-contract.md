---
id: 26
slug: error-taxonomy-as-transport-independent-behavior-contract
title: Error Taxonomy as Transport-Independent Behavior Contract
status: accepted
created: 2026-04-09
updated: 2026-04-13
owners: ['[galligan](https://github.com/galligan)']
depends_on: [2, 6]
---

# ADR-0026: Error Taxonomy as Transport-Independent Behavior Contract

## Context

### The taxonomy already works across three transports

ADR-0002[^1] established Trails' original error taxonomy with deterministic mappings to HTTP status codes, CLI exit codes, and JSON-RPC error codes. The developer returns `Result.err(new NotFoundError('User not found'))`. The framework looks up the mapping for the current surface and renders the right code. The developer never thinks about transport-specific error representation.

This was designed for the original three surfaces: CLI, HTTP, and MCP. But the framework is acquiring new transports — webhook responses, queue consumers (ack/nack/dead-letter), WebSocket close codes, signal delivery outcomes. Each of these needs to know: is this error permanent or transient? Should the transport retry? What does the consumer see?

The taxonomy already answers these questions. `retryable` is a property of the error class itself. The category groups errors into behavioral families. The insight: the error taxonomy is not a set of three surface-specific mapping tables. It's a universal behavior contract that any transport can read.

### The mapping pattern is the same every time

Every transport integration follows the same steps:

1. Receive the error class from the trail's Result
2. Look up the category and `retryable` flag
3. Map to the transport's native error representation

HTTP maps to status codes. CLI maps to exit codes. JSON-RPC maps to error codes. Queues map to ack/nack/dead-letter decisions. WebSockets map to close codes. The mechanism is identical. Only the target representation changes.

If every new transport repeats this pattern ad hoc, the mappings will drift. A queue connector might treat `ConflictError` as retryable because the author didn't check the taxonomy. A webhook handler might return 500 for `ValidationError` because the mapping wasn't consulted. The taxonomy should declare these mappings centrally so transports implement them, not reinvent them.

## Decision

### The error taxonomy is a transport-independent behavior contract

The 14 error classes define *behavioral categories*, not transport-specific codes. Each category carries two properties that any transport can read:

- **`retryable`** — should the transport attempt redelivery?
- **`category`** — what family of failure is this?

Transports map these properties to their native representations. The framework provides the mapping tables. Adding a new transport means adding one new column to the mapping, not redesigning the error model.

### The complete mapping

| Error class | Category | Retryable | HTTP | CLI | JSON-RPC | Queue | Signal delivery |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ValidationError` | `validation` | no | 400 | 1 | -32602 | nack → dead-letter | drop + dead-event |
| `AmbiguousError` | `validation` | no | 400 | 1 | -32602 | nack → dead-letter | drop + dead-event |
| `NotFoundError` | `not_found` | no | 404 | 2 | -32601 | nack → dead-letter | drop + dead-event |
| `ConflictError` | `conflict` | no | 409 | 3 | -32603 | nack → dead-letter | drop + dead-event |
| `AlreadyExistsError` | `conflict` | no | 409 | 3 | -32603 | nack → dead-letter | drop + dead-event |
| `PermissionError` | `permission` | no | 403 | 4 | -32600 | nack → dead-letter | drop + dead-event |
| `TimeoutError` | `timeout` | yes | 504 | 5 | -32603 | nack → retry | retry |
| `RateLimitError` | `rate_limit` | yes | 429 | 6 | -32603 | nack → retry (with backoff) | retry (with backoff) |
| `NetworkError` | `network` | yes | 502 | 7 | -32603 | nack → retry | retry |
| `InternalError` | `internal` | no | 500 | 8 | -32603 | nack → dead-letter | drop + dead-event |
| `AssertionError` | `internal` | no | 500 | 8 | -32603 | nack → dead-letter | drop + dead-event |
| `DerivationError` | `internal` | no | 500 | 8 | -32603 | nack → dead-letter | drop + dead-event |
| `AuthError` | `auth` | no | 401 | 9 | -32600 | nack → dead-letter | drop + dead-event |
| `CancelledError` | `cancelled` | no | 499 | 130 | -32603 | nack → discard | discard |

The first four columns (HTTP, CLI, JSON-RPC) are established by ADR-0002. The last two (Queue, Signal delivery) extend the contract to new transports.

### Queue semantics follow from `retryable`

The queue mapping is mechanical:

- **Retryable errors** → nack with retry. The queue redelivers the message. `RateLimitError` additionally respects `retryAfter` as a backoff hint.
- **Permanent errors** → nack with dead-letter routing. The message is moved to a dead-letter queue for inspection. Redelivering won't help.
- **`CancelledError`** → nack with discard. The trail was cancelled (e.g., by shutdown). The message is neither retried nor dead-lettered — it's discarded. The cancellation is an operational concern, not a message problem.
- **Success** → ack.

A queue connector (`@ontrails/with-kafka`, `@ontrails/with-sqs`) reads `retryable` from the error and makes the ack/nack decision. The connector doesn't need to understand 14 error classes. It understands one boolean.

### Signal delivery follows the same pattern

When a signal activates a trail and the trail fails, the signal delivery system uses the same mapping:

- **Retryable errors** → redeliver the signal (with backoff for `RateLimitError`).
- **Permanent errors** → stop delivery, emit a dead event. The dead-event detection system in the signal pipeline records the failure.
- **`CancelledError`** → discard silently. Shutdown or abort, not a delivery problem.

This means signal delivery semantics are *derived from the error taxonomy*, not designed separately. The Typed Signal Emission ADR's delivery semantics section builds on this mapping rather than defining its own retry/dead-letter logic.

### Webhook responses are HTTP

Webhook endpoints respond with HTTP status codes. The existing HTTP mapping applies directly — no new column needed. A `ValidationError` on a webhook payload returns 400. A `TimeoutError` returns 504. The webhook sender uses the status code to decide whether to retry, following the same semantics their HTTP client already understands.

### Adding a new transport

Adding a transport to Trails means adding one mapping function:

```typescript
type TransportErrorMapper<T> = (error: TrailsError) => T;
```

The function receives a `TrailsError` with `category` and `retryable` already set. It returns the transport's native representation. The framework can provide a registry of these mappers, or each connector can implement its own — the contract is the error class, not the registry.

The deliberate friction from ADR-0002 applies: adding a new error class to the taxonomy requires updating *every* mapping table. This prevents casual additions and keeps the taxonomy small and universal.

## Consequences

### Positive

- **Queue and signal delivery semantics are derived, not designed.** A queue connector reads `retryable` and makes the ack/nack decision. No transport-specific error logic to author.
- **New transports get error handling for free.** WebSocket close codes, gRPC status codes, any future transport — one mapping function, and the 14 error classes work everywhere.
- **The taxonomy proves its design.** ADR-0002 designed the taxonomy with three transports. This ADR validates that the same 14 classes and the `retryable` flag extend to five transports without modification. The abstraction holds.

### Tradeoffs

- **Queue dead-letter routing is coarse.** All permanent errors go to the dead-letter queue. A more nuanced system might route `ValidationError` (bad message) differently from `PermissionError` (configuration problem). The coarse mapping is correct for the common case; connectors can refine it if needed.
- **`CancelledError` semantics vary.** For queues, discard is correct (the process is shutting down, re-queue the message on another consumer). For signal delivery, discard is also correct (cancellation is operational). But a future transport might want different cancellation behavior. The mapping is overridable per transport.

## Non-decisions

- **Retry policies.** How many times a queue retries, what backoff strategy to use, when to give up — these are connector-level configuration decisions, not taxonomy decisions. The taxonomy says "this error is retryable." The connector decides how many times and how long.
- **Dead-letter handling.** What happens to dead-lettered messages — alerting, manual inspection, automated reprocessing — is an operational concern outside the taxonomy.
- **WebSocket close code mapping.** The specific mapping of error categories to WebSocket close codes (1008 for policy violation, 1011 for internal error, etc.) is deferred to the WebSocket Surface ADR.

## References

- [ADR-0002: Built-In Result Type](0002-built-in-result-type.md) — established the original taxonomy and HTTP/CLI/JSON-RPC mappings
- [ADR-0006: Shared Execution Pipeline with Result-Returning Builders](0006-shared-execution-pipeline.md) — the execution pipeline that produces Results with typed errors
- [Tenets: One schema, one Result, one error taxonomy](../tenets.md) — the governing principle; drift across transports is structurally harder than alignment

[^1]: [ADR-0002: Built-In Result Type](0002-built-in-result-type.md) — the error taxonomy with HTTP, CLI, and JSON-RPC mappings
