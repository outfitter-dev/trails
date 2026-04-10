---
slug: websocket-trailhead
title: WebSocket Trailhead
status: draft
created: 2026-03-31
updated: 2026-04-09
owners: ['[galligan](https://github.com/galligan)']
depends_on: [typed-signal-emission]
---

# ADR: WebSocket Trailhead

## Context

### Four trailheads, all request-response

CLI, MCP, and HTTP are request-response trailheads. Something external says "do this," the framework executes a trail, a Result comes back. Each trailhead parses input in its format, calls `executeTrail`, and formats the Result in its response format. The trailhead model is clean and proven.

WebSocket breaks this model because it's two things over one persistent connection: request-response (client calls trails, gets Results) AND server-push (clients subscribe to events, receive them as they happen). The first part follows the established trailhead pattern. The second part has no precedent in the current trailhead model.

### Why WebSocket matters now

With the Events Runtime shipping `ctx.signal()`, trails can announce what happened. Events have typed schemas, delivery tracking, and routing. But the only consumers of events are internal (triggers that activate other trails). There's no way for external clients to subscribe to events.

WebSocket is the natural first trailhead for event subscriptions. A browser dashboard subscribing to `booking.confirmed` events. An agent maintaining a live view of system health. A mobile client receiving push notifications. All of these need a persistent connection where the server pushes typed events to subscribers.

SSE (Server-Sent Events) on the HTTP trailhead is a lighter-weight option for server-push, but it's unidirectional (server to client only). WebSocket provides bidirectional communication: the client can call trails AND receive events over the same connection. For applications that need both, WebSocket is the right trailhead.

### What the pre-Trails prototype proved

A production WebSocket implementation (pre-Trails) validated several patterns:

- JSON-RPC style framing works well for trail invocation over WebSocket
- Connection state machines (connecting, authenticating, ready, draining) are necessary for reliability
- Per-connection send queue depth monitoring prevents backpressure from crashing clients
- Circular event buffers with sequence numbers enable replay on reconnect
- `lastSeenSeq` on reconnect is sufficient for most replay needs

These patterns inform the design but don't constrain it. The Trails version can be cleaner because the framework provides typed contracts, the event runtime provides emission, and the permit model provides authentication.

## Decision

### WebSocket follows the trailhead pattern

WebSocket is a trailhead. It has a `trailhead()` one-liner, a `build*` escape hatch, and it renders the topo's trails and events for its transport.

```typescript
import { trailhead } from '@ontrails/ws';

trailhead(app, { port: 3001 });
```

Or sharing a port with the HTTP trailhead via upgrade:

```typescript
import { trailhead as trailheadHttp } from '@ontrails/http/hono';
import { trailhead as trailheadWs } from '@ontrails/ws';

const http = blazeHttp(app, { port: 3000, serve: false });
blazeWs(app, { server: http });
```

`buildWsHandlers(topo)` produces handler definitions. `trailhead()` wires them to a WebSocket server. The same two-step pattern as every other trailhead.

### Two capabilities over one connection

#### Trail invocation (request-response)

Clients call trails by sending a request message:

```json
{ "type": "request", "id": "req_1", "trail": "booking.show", "input": { "id": "bk_123" } }
```

The trailhead executes through the pipeline. The Result comes back:

```json
{ "type": "response", "id": "req_1", "ok": true, "value": { "bookingId": "bk_123", "status": "confirmed" } }
```

On error:

```json
{ "type": "response", "id": "req_1", "ok": false, "error": { "code": "NotFoundError", "category": "not_found", "message": "Booking not found: bk_123" } }
```

The `id` field correlates requests to responses. The client manages its own request IDs. The framing is JSON-RPC-adjacent but simplified: no JSON-RPC version field, no `jsonrpc: "2.0"` boilerplate, just `type`, `id`, `trail`, `input`.

Trail invocation respects the same filtering as other trailheads: visibility (internal trails are not callable), intent filtering (if configured on blaze), and permit-gated discovery (the client only sees trails it can call, based on its connection permit).

#### Event subscription (server-push)

Clients subscribe to event types:

```json
{ "type": "subscribe", "events": ["booking.confirmed", "booking.cancelled"] }
```

The trailhead validates the event IDs against the topo (do these events exist?) and the connection's permit (does this client have read access to the event's namespace?). Response:

```json
{ "type": "subscribed", "events": ["booking.confirmed", "booking.cancelled"] }
```

Or partial subscription if some events are unauthorized:

```json
{
  "type": "subscribed",
  "events": ["booking.confirmed"],
  "denied": [{ "event": "booking.cancelled", "reason": "insufficient scope" }]
}
```

When a subscribed event is emitted (via `ctx.signal()` or framework lifecycle events), the trailhead pushes it to all subscribed connections:

```json
{ "type": "event", "event": "booking.confirmed", "payload": { "bookingId": "bk_123", "userId": "user_1" }, "seq": 42 }
```

The `seq` field is a per-connection monotonically increasing sequence number. It enables replay on reconnect.

Unsubscribe:

```json
{ "type": "unsubscribe", "events": ["booking.cancelled"] }
```

### Connection lifecycle

```text
connect -> authenticate -> ready -> draining -> closed
                             |
                       receiving events
                       calling trails
```

#### Connect

The WebSocket handshake establishes the connection. No authentication yet. The connection is in a pending state.

#### Authenticate

The first message from the client must be an authentication message:

```json
{ "type": "auth", "token": "bearer_token_here" }
```

The trailhead resolves the token through the permit model's configured auth connector. On success:

```json
{ "type": "authenticated", "permit": { "id": "user_1", "scopes": ["booking:read", "booking:write"] } }
```

On failure:

```json
{ "type": "error", "code": "AuthError", "message": "Invalid token" }
```

The connection closes on authentication failure. On success, the connection transitions to ready.

Alternative authentication mechanisms: token in the WebSocket URL query string (resolved during handshake, no auth message needed), or token in a custom header during the upgrade request. The trailhead supports multiple auth strategies through the same permit resolver used by other trailheads. The Permit is the framework type; JWT, API key, or session cookie are auth connectors that produce a Permit. The WebSocket trailhead is connector-agnostic — it receives a Permit from whichever auth connector is configured.

#### Ready

The connection is authenticated. The client can call trails and subscribe to events. The connection's permit determines what's accessible.

#### Draining

When the server shuts down gracefully, connections enter a draining state. No new trail invocations are accepted. In-flight invocations complete. A final message is sent:

```json
{ "type": "draining", "reason": "server shutting down" }
```

The client has a window to reconnect to another instance.

#### Closed

The connection terminates. Subscriptions are removed. In-flight requests receive no response (the client should retry on reconnect).

### Reconnection and replay

When a client reconnects, it sends its last seen sequence number:

```json
{ "type": "auth", "token": "bearer_token_here", "lastSeenSeq": 38 }
```

The trailhead replays events from sequence 39 onward. Events are buffered in a per-connection circular buffer (configurable size, default 1000 events). If the client's `lastSeenSeq` is too old (outside the buffer window), the trailhead sends a gap notification:

```json
{ "type": "replay_gap", "from": 38, "available_from": 142, "message": "Events 39-141 are no longer available" }
```

The client decides how to handle the gap: refetch state via trail invocations, or accept the loss. The framework doesn't mandate a recovery strategy.

The WebSocket trailhead maintains a cursor position per connection — the last sequence number delivered. On reconnect, the trailhead reads forward from that position. For authored events, it reads from the events runtime's delivery log. For execution observations, it reads from whatever tracking infrastructure exists. "Replay" is the trailhead catching up a reconnected client by reading forward from its last known position. There is no separate replay buffer or abstraction — the trailhead is a cursor over existing data sources. If those data sources are durable, replay survives server restarts.

### Permit-scoped discovery and subscriptions

The connection's permit scopes what the client can see and do:

**Trail discovery.** The client can request the list of available trails:

```json
{ "type": "discover" }
```

The trailhead responds with trails filtered by the connection's permit, same as MCP's permit-gated tool listing:

```json
{
  "type": "trails",
  "trails": [
    { "id": "booking.show", "intent": "read", "input": { "...schema..." } },
    { "id": "booking.confirm", "intent": "write", "input": { "...schema..." } }
  ]
}
```

Only trails the permit authorizes are included. Internal trails are excluded. Intent filtering from blaze options applies.

**Event discovery.** The client can request available events:

```json
{ "type": "events" }
```

Response filtered by permit scopes. `booking.*` events require `booking:read` scope. Namespace-to-scope mapping, same as trail discovery.

**Subscription filtering.** A client can only subscribe to events their permit authorizes. Attempts to subscribe to unauthorized events are denied in the subscription response.

### Backpressure

Each connection has a send queue. When the queue depth exceeds a configurable threshold, the trailhead takes progressive action:

1. **Warning.** Log the backpressure condition. Continue sending.
2. **Throttle.** Drop low-priority events (lifecycle events before authored events). Notify the client:

```json
{ "type": "backpressure", "dropped": 12, "since": "2026-03-31T14:32:00Z" }
```

1. **Disconnect.** If the queue is critically full, close the connection with a reason. The client reconnects and replays.

Backpressure thresholds are configurable on blaze options:

```typescript
trailhead(app, {
  port: 3001,
  backpressure: {
    warnAt: 100,
    throttleAt: 500,
    disconnectAt: 1000,
  },
});
```

### Trailhead derivation

Trail ID to WebSocket method name follows the same convention as MCP: the trail ID is the method name. `booking.show` is callable as `"trail": "booking.show"`. No transformation needed.

Event ID to subscription channel follows the same convention: the event ID is the channel name. `booking.confirmed` is subscribable as `"events": ["booking.confirmed"]`. The event declaration is the channel declaration.

### BlazeWsOptions

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `port` | `number` | `3001` | Listen port (standalone mode) |
| `server` | `Server` | none | Existing HTTP server (upgrade mode) |
| `path` | `string` | `/ws` | WebSocket endpoint path (upgrade mode) |
| `intent` | `Intent[]` | all | Filter trails by intent |
| `include` | `string[]` | all | Glob patterns for trail inclusion |
| `exclude` | `string[]` | none | Glob patterns for trail exclusion |
| `layers` | `Layer[]` | `[]` | Layers for trail execution |
| `replayBuffer` | `number` | `1000` | Max events in replay buffer per connection |
| `backpressure` | `BackpressureConfig` | defaults | Backpressure thresholds |
| `authTimeout` | `number` | `5000` | Ms to wait for auth message before disconnecting |

The options follow the same patterns as HTTP and MCP blaze options. Intent filtering, glob patterns, and layers work identically.

### Package structure

```text
@ontrails/ws
├── trailhead()              — one-liner WebSocket server
├── buildWsHandlers()    — escape hatch, returns handler definitions
├── types                — message type definitions
└── /bun                 — Bun.serve WebSocket connector (if needed)
```

The package depends on `@ontrails/core` and benefits from the Events Runtime for subscription delivery. If the Events Runtime is not present, the WebSocket trailhead operates in request-response-only mode (trail invocation works, event subscription is unavailable).

### How WebSocket compounds with existing features

**With Events Runtime.** WebSocket is the first external delivery trailhead for events. `ctx.signal()` produces events. The WebSocket trailhead delivers them to subscribed clients. The event runtime provides the emission and routing. WebSocket provides the transport.

**With triggers.** A webhook trigger fires, activating a trail. The trail emits an event. A WebSocket client subscribed to that event receives it. The full chain: external webhook to trail execution to event emission to WebSocket delivery. Each piece is a different ADR. Together they form a reactive pipeline from external input to external output.

**With visibility.** Internal trails are not callable over WebSocket. The `discover` message only returns public trails. Event subscription respects visibility: events emitted by internal trails are still deliverable (the event is public, the trail that emitted it is internal).

**With packs.** A pack's public trails are callable over WebSocket. A pack's events are subscribable. The pack author doesn't configure anything WebSocket-specific. The trailhead derives everything from the topo.

**With permit-gated discovery.** The connection's permit scopes trail visibility AND event subscription. An agent connected with `booking:read` scope sees booking read trails and can subscribe to booking events. Write trails and admin events are invisible.

**With observability.** WebSocket connections are observed: connection established, authentication result, subscriptions, disconnection, replay requests. Combined with event delivery tracking from the Events Runtime, the tracing system provides full observability of the WebSocket trailhead.

## Consequences

### Positive

- **Bidirectional communication over one connection.** Clients call trails (request-response) and receive events (server-push) without managing two separate connections or polling.
- **Event subscriptions use the Events Runtime.** No separate pub/sub system. `ctx.signal()` in any trail delivers to WebSocket subscribers through the same routing pipeline that serves triggers. One emission, multiple consumers.
- **Replay on reconnect.** Per-connection cursor positions and sequence numbers mean clients don't miss events during brief disconnections. The trailhead reads forward from the client's last seen position. The client sends `lastSeenSeq`.
- **Permit-scoped everything.** Trail discovery, event subscription, and invocation all respect the connection's permit. An agent sees exactly what it's authorized to use.
- **Same trailhead patterns.** `trailhead()`, `build*` escape hatch, intent filtering, glob patterns, layers. Developers who know the HTTP or MCP trailhead already know how to configure WebSocket.

### Tradeoffs

- **Persistent connection state.** Unlike HTTP (stateless) and CLI (one-shot), WebSocket connections have lifecycle: auth state, subscriptions, replay position, backpressure state. The trailhead manages per-connection state that no other trailhead needs.
- **Replay query cost.** On reconnect, the trailhead reads forward from the client's last cursor position. For clients that reconnect after long gaps, this may involve reading a large number of records from the events runtime or tracking layer. The configurable replay window (default 1000 events) caps how far back a reconnect can reach.
- **Backpressure complexity.** Slow clients can cause send queue growth. The progressive backpressure strategy (warn, throttle, disconnect) handles this but adds operational complexity. Monitoring send queue depth becomes an operational concern.
- **Graceful shutdown is harder.** Draining WebSocket connections requires signaling clients, waiting for in-flight requests, and closing connections. HTTP can simply stop accepting new requests. WebSocket needs active connection management during shutdown.

### What this does NOT decide

- **The specific WebSocket library.** Bun has native WebSocket support via `Bun.serve()` with WebSocket upgrade. Whether `@ontrails/ws` uses this directly or wraps a library is an implementation choice.
- **Binary message support.** The current design uses JSON text messages. Binary protocols (MessagePack, Protocol Buffers) could improve throughput. That's a future optimization.
- **Connection multiplexing.** Whether one WebSocket connection can operate with multiple permits (e.g., switching user context). Currently, one connection = one permit = one auth. Multiplexing would add complexity.
- **Horizontal scaling.** When multiple server instances run behind a load balancer, event subscriptions must reach the right server. This requires a shared event bus (Redis pub/sub, etc.) that the Events Runtime can plug into. The WebSocket trailhead doesn't solve distributed delivery.
- **SSE as a lighter alternative.** Server-Sent Events on the HTTP trailhead could provide event subscriptions without the complexity of WebSocket connection management. SSE is unidirectional (server to client) but sufficient for many use cases. Whether to add SSE support to the HTTP trailhead is a separate decision.

## References

- [ADR-0000: Core Premise](../0000-core-premise.md) -- "trailheads are peers"; WebSocket is the fourth trailhead, following the same patterns as CLI, MCP, and HTTP
- [ADR-0006: Shared Execution Pipeline](../0006-shared-execution-pipeline.md) -- trail invocations over WebSocket execute through the pipeline
- [ADR-0008: Deterministic Trailhead Derivation](../0008-deterministic-trailhead-derivation.md) -- trail IDs map to WebSocket method names, event IDs map to subscription channels
- [ADR-0013: Tracing](../0013-tracing.md) -- observability and replay buffer backing store
- [ADR: Error Taxonomy as Transport-Independent Behavior Contract](0026-error-taxonomy-as-transport-independent-behavior-contract.md) (draft) -- WebSocket close code mapping deferred there; the error taxonomy extends to WebSocket as a transport
- [ADR: Unified Observability](20260409-unified-observability.md) (draft) -- tracing system that provides WebSocket connection observability
- ADR: Typed Signal Emission (draft) -- `ctx.signal()` provides the events that WebSocket subscriptions deliver
- [ADR: Trail Visibility and Trailhead Filtering](0027-visibility-and-filtering.md) (draft) -- visibility and intent filtering apply to WebSocket trail discovery and invocation
- ADR: Reactive Trail Activation (draft) -- triggers and WebSocket subscriptions are both consumers of the event routing pipeline
- [ADR: `deriveTrail()` and Trail Factories](20260409-derivetrail-and-trail-factories.md) (draft) -- `ingest()` factory for webhook-to-trail flows that can feed events to WebSocket subscribers
- [ADR-0017: The Serialized Topo Graph](../0017-serialized-topo-graph.md) -- captures WebSocket trailhead configuration in the resolved topo graph
