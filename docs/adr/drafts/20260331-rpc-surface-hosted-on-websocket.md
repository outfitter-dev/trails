---
slug: rpc-surface-hosted-on-websocket
title: RPC Is a Surface Hosted on WebSocket
status: draft
created: 2026-03-31
updated: 2026-10-28
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 5, 6, 12, 26, 35, 38, 39, 48, 50, 52, 59]
---

# ADR: RPC Is a Surface Hosted on WebSocket

## Context

Trails needs a persistent connection that can run trails and deliver signals without inventing a second trail contract. The March 31 draft explored that boundary as `@ontrails/ws`. Its custom message envelope, connection-local replay buffer, query-string credentials, and drop-on-backpressure policy no longer fit the framework. This rewrite preserves trail-id invocation, signal-id channels, permit-scoped discovery, one permit per connection, and graceful draining.

The October 27 decisions recorded in [TRL-1166] and the WebSocket plan choose an RPC surface with WebSocket as its first host.[^plan] This is a draft design, not an implemented package or an automatic promotion to an accepted numbered ADR. It is a peer of CLI, MCP, HTTP, and library calls. MCP is a separate surface using its official SDK and sharing core's error codes and data shape.

## Decision

### One package owns the protocol; hosts own connections

`@ontrails/rpc` owns `deriveRpcMethods(graph)`, `createRpcHandler(graph, options)`, the `trails.*` vocabulary and schemas, capability advertisement, and `createRpcConformanceCases`. `@ontrails/rpc/websocket` owns framing, upgrade, subprotocol, close codes, backpressure, and the Bun `surface(graph, options)` entry. `@ontrails/rpc/stdio` is a later host. This supersedes the proposed `@ontrails/jsonrpc`, `@ontrails/websocket`, and `@ontrails/ws` package splits.

The API follows [ADR-0035](../0035-surface-apis-render-the-graph.md#decision): derive a method/channel table as a `Result` without opening anything, create a host-independent kernel and upgrade check, or let the WebSocket `surface()` own the boundary. Hono's upgrade helper belongs in `adapters/hono`; the hibernatable Durable Object host belongs in `adapters/cloudflare`. Neither derives a competing method table.

Protocol rendering does not belong in core: every application loads core, and core owns trail contracts and execution rather than a connection protocol. It does not belong in HTTP: WebSocket, stdio, MessagePort, and Workers hosting do not need REST routing or OpenAPI. One RPC package is sufficient while this protocol is the shared capability. MCP never imports RPC to obtain core error behavior.

### JSON-RPC carries trail identity

Use full JSON-RPC 2.0, including batches, request/response correlation, notifications without responses, and the reserved `rpc.` prefix.[^jsonrpc] Each WebSocket text message carries one JSON-RPC message or batch, using subprotocol `trails.v1`. A malformed WebSocket frame is a connection failure; a JSON-RPC parse or request error retains the JSON-RPC error response rules. The reserved framework prefix `trails.` cannot be used for authored trail IDs; topo validation or Warden rejects collisions.

A trail ID is the method name and `params` carries its input. `_meta.version` selects a trail version under [ADR-0048](../0048-trail-versioning-v3.md); omission selects the latest version. `_meta.idempotencyKey` marks a retry-safe write. Layer inputs use the same reserved field names as other surfaces. Use the existing `filterSurfaceTrails` grammar, visibility, intent, and `_draft.` exclusion. Scalar surface-overlay bindings normalize to the trail ID; grouped entries preserve the selected member's identity in both invocation and response, under [ADR-0050](../0050-surface-accommodations-preserve-trail-identity.md#core-rule) and [ADR-0052](../0052-overlays-one-extension-mechanism.md#decision).

The method directions and kinds come from the plan's concrete method table:

| Method | Direction | Kind | Meaning |
| --- | --- | --- | --- |
| `<trail id>` | Client to server | Request | Run the trail through the shared pipeline. |
| `trails.discover` | Client to server | Request | Return permitted public trails and signals, schemas, examples, intent, and host capabilities. |
| `trails.subscribe` | Client to server | Request | Open or resume with `{ signals, after? }`; return `{ subscriptionId, checkpoint }`. |
| `trails.unsubscribe` | Client to server | Request | Close a subscription. |
| `trails.event` | Server to client | Notification | Deliver `{ subscriptionId, eventId, signal, payload, firedAt, checkpoint? }`. |
| `trails.checkpoint` | Server to client | Notification | Send `{ subscriptionId, checkpoint }` without an event payload. |
| `trails.ack` | Client to server | Notification | Confirm processing through a checkpoint; advance a named subscription's server cursor. |
| `trails.input` | Server to client | Request | Render the shared input-required outcome as elicitation. |
| `trails.progress` | Server to client | Notification | Report progress for an in-flight request. |
| `trails.cancel` | Client to server | Notification | Abort an in-flight request through `ctx.abortSignal`. |
| `trails.auth` | Client to server | Request | Authenticate a fallback connection or refresh its credential. |
| `trails.draining` | Server to client | Notification | Announce shutdown so a client can reconnect and resume. |

Hosts advertise implemented capabilities rather than changing method meanings. A host that cannot push omits `trails.subscribe`, `trails.progress`, and `trails.input`. Request-response-only operation remains valid without a subscription store. Naming a future method in this design does not advertise it before implementation.

### Errors share the core contract

Trail failures render as JSON-RPC error responses with codes from core's `codesByCategory` and `data.category`, `data.retryable`, and `data.name`. The `jsonRpc` column retains its name. `not_found` defaults to `-32001`, as [ADR-0000](../0000-core-premise.md#one-schema-one-result-one-error-taxonomy) requires; [TRL-1426] owns the implementation and method-specific override slot. A protocol-mandated override such as MCP `resources/read` at `-32602` does not replace that category default.

On MCP, a trail failure remains an `isError` tool result with `_meta['ontrails/error']`; only protocol failures become JSON-RPC errors. This RPC surface is different because the trail itself is the invoked method. Both consume core's taxonomy under [ADR-0026](../0026-error-taxonomy-as-transport-independent-behavior-contract.md#decision), without changing the trail's `Result` contract or public redaction policy.

WebSocket close codes apply to connection-level failures, not ordinary trail failures:

| Code | Connection outcome |
| --- | --- |
| 1000 | Normal close, including client hangup. |
| 1001 | Draining, after `trails.draining`. |
| 1002 | Invalid WebSocket framing or wrong subprotocol. |
| 1008 | Authentication/policy failure, expiry without accepted refresh, revocation, or changed issuer/subject/tenant. |
| 1009 | Message exceeds the configured size limit. |
| 1011 | Internal connection-kernel failure. |
| 1013 | Backpressure or overload; reconnect and resume from the cursor. |
| 4000–4999 | Reserved for Trails-specific reasons if 1008 proves too coarse. |

The host implementation owns the close-code mapping and its conformance tests. The shared core surface registration and registered mappers must remain covered by `error-mapping-completeness`; a green category-coverage rule alone does not prove a host's close behavior.

### Identity is established before upgrade

Resolve identity before upgrade wherever possible. Non-browser clients use `Authorization`; browsers use a same-origin cookie or a short-lived admission ticket offered alongside `trails.v1` in `Sec-WebSocket-Protocol`. The upgrade selects exactly `trails.v1`, never the ticket. Do not put credentials in query strings. Ticket issuance, validation, single-use enforcement, and scope are owned by Auth [TRL-1479], not by a new RPC authentication system.

Identity keys on `(iss, sub, tenant)`, with tenant where applicable. A first-frame `trails.auth` fallback lands in a per-connection object with an authentication timeout. The socket stays in that object after authentication; it does not migrate to a subject-keyed object. Refresh may extend verified expiry or narrow authority, but must preserve issuer, subject, and tenant and remain inside the existing permission ceiling. An identity change or expiry without an accepted refresh closes 1008. Check subscription permits at subscribe time and on every delivery.

**Source reconciliation:** revision 24's method table says `trails.auth` is a client-to-server request, while its refresh paragraph says the server sends it. This draft preserves the method table: the client supplies a fresh credential before expiry and the server verifies it. There is no reverse-direction `trails.auth`, invented refresh-prompt method, or reuse of input/progress messages for that purpose. A future proactive prompt needs a separate direction/schema decision. This reconciles the contradictory prose rather than claiming both wordings already agree.

**Refresh acceptance still required:** [TRL-1479] must establish how cookie, opaque-credential, and ticket clients learn the verified expiry and schedule refresh. Server-side `expiresAt` does not prove the client knows it. Do not assume JWT decoding, treat an admission ticket's lifetime as permit lifetime, or invent client-visible metadata fields here. Drafting and unrelated request-response work can proceed; seamless refresh cannot be claimed until that path is specified and proved.

### Subscriptions render one durable model

[ADR-0059](../0059-durable-subscriptions-over-signals.md) owns recording, replay, checkpoints, authorization gaps, retention, and identity. RPC does not invent a ring buffer or use an outbox event ID as a resume cursor. Resume uses an opaque server-issued checkpoint and exclusive `after`; named subscriptions advance the server-held cursor only through `trails.ack`, meaning processed rather than merely received. `replay_gap` returns the shared opaque `resumeAfter` checkpoint. The signal ID remains the channel name.

Replay follows per-subscription delivery-sequence order. Live delivery guarantees order per signal within a subscription only; it promises no total order across signals. This explicitly replaces revision 24's stronger “Replay and live” ordering sentence with the shared primitive's settled guarantee. Do not add an RPC-only reorder buffer or advertise a stronger host guarantee.

Checkpoint safety is separate from live arrival order. If sequence 8 arrives before 7 across two signals, no checkpoint may certify 8 until all covered admissions have been sent and the scan watermark is safe across relevant consumers. Once that prefix is complete, a later or standalone checkpoint may certify it. The client advances only after processing everything covered; processing 8 alone cannot acknowledge past missing 7. Replay still returns 7 then 8.

A standalone `trails.checkpoint` may advance `scan` while leaving `seq` unchanged, keeping a filtered idle subscription within retention. Stable event IDs support deduplication. Share the primitive's conformance cases: unprocessed tail, idle filtered subscription, reversed admission order, and retention-boundary recovery. Auth owns grant intervals and typed `authorization_gap`; the RPC rendering must not conflate it with `replay_gap`.

Every delivery remains in durable storage. At a soft backpressure threshold, stop pushing; at a hard limit, close 1013 and let the client resume. Do not silently drop lower-priority records. An offline-host delivery attempt may end without an acknowledgment, but it cannot advance the cursor or discard the durable replay record.

### The kernel survives host replacement

The kernel maps `(connection state, inbound frame)` to `(new state, outbound frames, effects)`. State and effects are plain serializable data; effects describe sends, closes, tags, storage writes, and alarms for the host to execute. No closure holds per-connection state between frames. Bun may keep that state in memory; a hibernatable Durable Object persists it. The trail still runs through the shared execution pipeline and never receives RPC or WebSocket types in `TrailContext`.

An attachment restores metadata, not work. Store permit references, subscription IDs/checkpoints, protocol version, and in-flight request IDs rather than payloads or full permits. When recovery finds an in-flight ID without a result, answer that ID with a JSON-RPC error carrying `data.outcome: 'unknown'`. Never re-run it automatically. Reads may be retried by the client; retrying a write requires the separately governed idempotency path in [TRL-1295].

Cloudflare owns the hibernation host and issuer-qualified routing. Subject, connection, or topic-shard host keys are recorded on subscriptions so delivery reaches the holding object without moving sockets. The Worker strips any client-supplied principal header before forwarding verified identity. Durable Object storage, attachment/tag budgets, fan-out, and ticket-consumption enforcement remain host acceptance work, not claims made by this draft.

### The lock describes one protocol across hosts

Derive one method table, subscribable signal facts, and subprotocol version into the lock; hosts reference those facts. New overlay namespaces retain the lock-v6 gate [TRL-1424]. Governance must reject reserved-prefix collisions, require public output schemas on the RPC surface, keep error mapping complete, and reject public subscription exposure without durable materialization. Those rules ship with their implementing issues rather than this documentation-only rewrite.

## Consequences

The RPC surface gives hosts one contract-derived protocol and preserves the `derive`/`create`/`surface` ladder. A serialized kernel can run in Bun or a hibernating host without changing trail behavior. One shared delivery model prevents a WebSocket replay fork.

The delivery log, admission/watermark accounting, host state persistence, and connection lifecycle have real cost. Per-signal live ordering avoids promising unnecessary total ordering, but it still requires safe checkpoint accounting. Authentication and refresh need client-visible proof rather than server-only state. None of those costs is solved by an in-process buffer.

## Sequencing and completion

The plan's earlier “Waiting on Matt” sequencing note is historical. The October 28 campaign operating decision permits the RPC kernel and basic WebSocket host before durable subscription delivery. Implement and advertise only their eligible request-response capabilities. Subscription renderings still wait for ADR-0059, outbox [TRL-1505], Auth grant [TRL-1464], shared conformance, and applicable lock-v6 gates. That source-work order does not authorize publication of a request-response-only release.

This draft belongs to [TRL-1166]. Its merged-acceptance gate includes a link from the durable subscriptions ADR. It remains a draft even when that gate is met. [TRL-1428] owns the kernel, [TRL-1431] the Bun host, and [TRL-1434] conformance. Input-required rendering, later stdio/Node hosts, typed clients, and Cloudflare hosting retain their own issue gates.

`release:none`: this changes design documentation and required reference/map outputs only. It does not expose a package API, implement RPC, add lock facts, enable subscription delivery, or claim client interoperability. Runtime docs, examples, Warden rules, changesets, and migration steps belong to the corresponding implementing issues.

## References

- [ADR-0000](../0000-core-premise.md#decision) — peer surfaces over one trail contract.
- [ADR-0006](../0006-shared-execution-pipeline.md#decision) — shared execution and Result behavior.
- [ADR-0026](../0026-error-taxonomy-as-transport-independent-behavior-contract.md#decision) — taxonomy and connection mapping boundary.
- [ADR-0035](../0035-surface-apis-render-the-graph.md#decision) — derive, create, and surface ownership.
- [ADR-0038](../0038-typed-signal-emission.md#decision) and [ADR-0039](../0039-reactive-trail-activation.md#decision) — typed signals and activation.
- [ADR-0059](../0059-durable-subscriptions-over-signals.md) — the normative durable delivery model.

[TRL-1166]: https://linear.app/outfitter/issue/TRL-1166
[TRL-1424]: https://linear.app/outfitter/issue/TRL-1424
[TRL-1426]: https://linear.app/outfitter/issue/TRL-1426
[TRL-1428]: https://linear.app/outfitter/issue/TRL-1428
[TRL-1431]: https://linear.app/outfitter/issue/TRL-1431
[TRL-1434]: https://linear.app/outfitter/issue/TRL-1434
[TRL-1464]: https://linear.app/outfitter/issue/TRL-1464
[TRL-1479]: https://linear.app/outfitter/issue/TRL-1479
[TRL-1505]: https://linear.app/outfitter/issue/TRL-1505
[TRL-1295]: https://linear.app/outfitter/issue/TRL-1295

[^plan]: [WebSocket surface plan, connected Notion copy](https://app.notion.com/p/4061b36f46cb8189a6d3d488b661adc1), read October 28, 2026. Its Sources identifies Claude artifact `UoKu97C72N4fsGSLQP1zPW`, revision 24, copied October 27. The method table and decisions log ground this rewrite; the campaign's later sequencing decision and the explicit reconciliations above govern the conflicting passages.
[^jsonrpc]: [JSON-RPC 2.0 specification](https://www.jsonrpc.org/specification): requests, notifications, errors, batches, and the reserved `rpc.` prefix.
