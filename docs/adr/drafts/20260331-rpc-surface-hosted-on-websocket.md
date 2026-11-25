---
slug: rpc-surface-hosted-on-websocket
title: RPC Is a Surface Hosted on WebSocket
status: draft
created: 2026-03-31
updated: 2026-11-25
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 5, 6, 12, 26, 35, 38, 39, 48, 50, 52, 59]
---

# ADR: RPC Is a Surface Hosted on WebSocket

## Context

Trails needs a persistent connection that can run trails and deliver signals without inventing a second trail contract. The March 31 draft explored that boundary as `@ontrails/ws`. Its custom message envelope, connection-local replay buffer, query-string credentials, and drop-on-backpressure policy no longer fit the framework. This rewrite preserves trail-id invocation, signal-id channels, permit-scoped discovery, one permit per connection, and graceful draining.

The October 27 decisions recorded in [TRL-1166] and the WebSocket plan choose an RPC surface with WebSocket as its first host.[^plan] RPC is a peer of CLI, MCP, HTTP, and library calls. MCP is a separate surface using its official SDK and sharing core's error codes and data shape. This ADR remains a draft; the parts already implemented do not accept the rest of the proposal.

## What exists today

The RPC kernel ([#1147](https://github.com/outfitter-dev/trails/pull/1147)), cancellation and progress ([#1148](https://github.com/outfitter-dev/trails/pull/1148)), Bun WebSocket host ([#1150](https://github.com/outfitter-dev/trails/pull/1150)), and base host conformance suite ([#1151](https://github.com/outfitter-dev/trails/pull/1151)) have landed. The [package README](../../../packages/rpc/README.md) describes the implemented API. Bun carries trail requests, discovery, cancellation, request-scoped progress, and graceful draining over `trails.v1`.

By default, Bun's `trails.discover` reports `progress: true`, `subscribe: false`, and `input: false`. The host passes caller capability overrides through to the kernel. Setting `subscribe: true` changes the reported flag but does not advertise or enable any subscription method. Discovery lists the trails this permit can invoke and the topo's signal IDs; signal IDs are channel candidates, not grant-checked subscriptions. The host does not implement durable delivery, acknowledgments, checkpoints, replay, or `trails.auth` refresh.

## Decision

### One package owns the protocol; hosts own connections

`@ontrails/rpc` owns `deriveRpcMethods(graph)`, `createRpcHandler(graph, options)`, the `trails.*` vocabulary and schemas, capability advertisement, and `createRpcConformanceCases`. `@ontrails/rpc/websocket` owns framing, upgrade, subprotocol, close codes, backpressure, and the Bun `surface(graph, options)` entry. `@ontrails/rpc/stdio` is a later host. This supersedes the proposed `@ontrails/jsonrpc`, `@ontrails/websocket`, and `@ontrails/ws` package splits.

The API follows [ADR-0035](../0035-surface-apis-render-the-graph.md#decision): derive a method/channel table as a `Result` without opening anything, create a host-independent kernel and upgrade check, or let the WebSocket `surface()` own the boundary. Hono's upgrade helper belongs in `adapters/hono`; the hibernatable Durable Object host belongs in `adapters/cloudflare`. Neither derives a competing method table.

Protocol rendering does not belong in core: every application loads core, and core owns trail contracts and execution rather than a connection protocol. It does not belong in HTTP: WebSocket, stdio, MessagePort, and Workers hosting do not need REST routing or OpenAPI. One RPC package is sufficient while this protocol is the shared capability. MCP never imports RPC to obtain core error behavior.

### JSON-RPC carries trail identity

Use full JSON-RPC 2.0, including batches, request/response correlation, notifications without responses, and the reserved `rpc.` prefix.[^jsonrpc] Each WebSocket text message carries one JSON-RPC message or batch, using subprotocol `trails.v1`. A malformed WebSocket frame is a connection failure; a JSON-RPC parse or request error retains the JSON-RPC error response rules. The reserved framework prefix `trails.` cannot be used for authored trail IDs; topo validation or Warden rejects collisions.

A trail ID is the method name and `params` carries its input. `_meta.version` selects a trail version under [ADR-0048](../0048-trail-versioning-v3.md); omission selects the latest version. `_meta.idempotencyKey` is reserved for the proposed retry-safe write path, not a retry guarantee in the current kernel. Layer inputs use the same reserved field names as other surfaces. Use the existing `filterSurfaceTrails` grammar, visibility, intent, and `_draft.` exclusion. Any future RPC surface-overlay bindings preserve trail identity: scalar bindings normalize to the trail ID, and grouped entries preserve the selected member in invocation and response, under [ADR-0050](../0050-surface-accommodations-preserve-trail-identity.md#core-rule) and [ADR-0052](../0052-overlays-one-extension-mechanism.md#decision).

The method directions and kinds come from the plan's concrete method table:

| Method | Direction | Kind | Availability and meaning |
| --- | --- | --- | --- |
| `<trail id>` | Client to server | Request | Implemented. Run the trail through the shared pipeline. |
| `trails.discover` | Client to server | Request | Implemented. Return permit-scoped trails with schemas, examples, and intent, plus topo signal IDs and host capabilities. |
| `trails.subscribe` | Client to server | Request | Proposed. Open or resume a client-held subscription with `{ signals, after? }`, or reconnect a named subscription with `{ subscriptionId, after? }`; return `{ subscriptionId, checkpoint }`. |
| `trails.unsubscribe` | Client to server | Request | Proposed. Close a subscription. |
| `trails.event` | Server to client | Notification | Proposed. Deliver `{ subscriptionId, eventId, signal, payload, firedAt, checkpoint? }`. |
| `trails.checkpoint` | Server to client | Notification | Proposed. Send `{ subscriptionId, checkpoint }` without an event payload. |
| `trails.ack` | Client to server | Notification | Proposed. Confirm processing through a checkpoint; advance a named subscription's server cursor. |
| `trails.input` | Server to client | Request | Proposed. Render the shared input-required outcome as elicitation. |
| `trails.progress` | Server to client | Notification | Implemented on push-capable hosts. Report progress for an in-flight request. |
| `trails.cancel` | Client to server | Notification | Implemented. Abort an in-flight request through `ctx.abortSignal`. |
| `trails.auth` | Client to server | Request | Proposed. Authenticate a fallback connection or refresh its credential. |
| `trails.draining` | Server to client | Notification | Implemented on Bun. Announce shutdown before closing; the client can reconnect, not resume a durable stream. |

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
| 1008 | Authentication or policy failure at upgrade. The proposed refresh flow also uses it for expiry without accepted refresh, revocation, and identity changes. |
| 1009 | Message exceeds the configured size limit. |
| 1011 | Internal connection-kernel failure. |
| 1013 | The host closes when buffered outbound bytes exceed its hard limit. Resume from a checkpoint requires durable subscriptions. |
| 4000–4999 | Reserved for Trails-specific reasons if 1008 proves too coarse. |

The host implementation owns the close-code mapping and its conformance tests. The shared core surface registration and registered mappers must remain covered by `error-mapping-completeness`; a green category-coverage rule alone does not prove a host's close behavior.

### Identity is established before upgrade

The Bun host resolves bearer identity before upgrade through `resolvePermit` and selects exactly `trails.v1`. Missing credentials allow anonymous use of public trails; a rejected credential closes with 1008. The proposed browser cookie and admission-ticket paths, first-frame authentication, and credential refresh are not implemented in this host.

The proposed design resolves identity before upgrade wherever possible. A browser uses a same-origin cookie or offers a short-lived admission ticket alongside `trails.v1` in `Sec-WebSocket-Protocol`. The upgrade selects `trails.v1`, not the ticket. Credentials never go in query strings. Auth [TRL-1479] owns ticket issuance, validation, single-use enforcement, scope, and refresh policy; RPC and its hosts consume those contracts.

Identity keys on `(iss, sub, tenant)`, with tenant where applicable. A first-frame `trails.auth` fallback lands in a per-connection object with an authentication timeout. The socket stays in that object after authentication; it does not migrate to a subject-keyed object. Refresh may extend verified expiry or narrow authority, but must preserve issuer, subject, and tenant and remain inside the existing permission ceiling. An identity change or expiry without an accepted refresh closes 1008. Check subscription permits at subscribe time and on every delivery.

**Source reconciliation:** revision 24's method table says `trails.auth` is a client-to-server request, while its refresh paragraph says the server sends it. This draft preserves the method table: the client supplies a fresh credential before expiry and the server verifies it. There is no reverse-direction `trails.auth`, invented refresh-prompt method, or reuse of input/progress messages for that purpose. A future proactive prompt needs a separate direction/schema decision. This reconciles the contradictory prose rather than claiming both wordings already agree.

**Refresh acceptance still required:** Before the RPC host claims seamless refresh, prove how cookie, opaque-credential, and ticket clients learn the verified expiry and schedule refresh. Server-side `expiresAt` does not prove the client knows it. Do not assume JWT decoding, treat an admission ticket's lifetime as permit lifetime, or add client-visible fields in this ADR. The Auth issue's status is not evidence that Bun implements the flow.

### Subscriptions render one durable model

[ADR-0059](../0059-durable-subscriptions-over-signals.md) owns recording, replay, checkpoints, authorization gaps, retention, and identity. For the proposed RPC rendering ([TRL-1441]), the signal ID is the channel name. RPC does not invent a ring buffer or use an outbox event ID as a resume cursor. Client-held resume uses an opaque server-issued checkpoint and exclusive `after`. On `replay_gap`, pass the shared opaque `resumeAfter` as `after` to accept only the reported retention loss, not to certify completed admission or acknowledge delivery. Recovery works even when no retained delivery matches.

Use the existing `subscriptionId` to reconnect a named subscription; signals do not select or change it. The server checks its existing ownership, tenant, and current grant before resuming from its server-held cursor. In this form `after` is only for the `resumeAfter` returned for that subscription, not for overriding the named cursor. Reconnecting does not acknowledge delivery; only `trails.ack` of processed delivery advances the acknowledged cursor.

Replay follows per-subscription delivery-sequence order. Live delivery guarantees order per signal within a subscription only; it promises no total order across signals. This explicitly replaces revision 24's stronger “Replay and live” ordering sentence with the shared primitive's settled guarantee. Do not add an RPC-only reorder buffer or advertise a stronger host guarantee.

Checkpoint safety is separate from live arrival order. If sequence 8 arrives before 7 across two signals, no checkpoint may certify 8 while 7 is unresolved or the scan watermark is unsafe across relevant consumers. Once the prefix is complete under ADR-0059, a later or standalone checkpoint may certify it. The client only acknowledges after processing all covered deliveries; processing 8 alone cannot acknowledge past unresolved 7. If both remain authorized, replay returns 7 then 8.

A standalone `trails.checkpoint` may advance `scan` while leaving `seq` unchanged, keeping a filtered idle subscription within retention. Stable event IDs support deduplication. Run the primitive's conformance cases, including retention recovery with a lagging consumer or no retained matches. Also reconnect one of two named subscriptions watching the same signals: select by its ID, reject an unauthorized caller, and replay its unacknowledged tail without advancing its server cursor. Auth owns grant intervals and typed `authorization_gap`; the RPC rendering must not conflate it with `replay_gap`.

Every delivery remains in durable storage. At a soft backpressure threshold, stop pushing; at a hard limit, close 1013 and let the client resume. Do not silently drop lower-priority records. An offline-host delivery attempt may end without an acknowledgment, but it cannot advance the cursor or discard the durable replay record.

### The kernel survives host replacement

The kernel maps `(connection state, inbound frame)` to `(new state, outbound frames, effects)`. State and effects are plain serializable data. Bun keeps connection state in memory; a future hibernatable Durable Object host would persist it and own effects such as storage writes and alarms. Live cancellation handles are process-local and not restored. The trail still runs through the shared execution pipeline and never receives RPC or WebSocket types in `TrailContext`.

An attachment restores metadata, not work. Store permit references, subscription IDs/checkpoints, protocol version, and in-flight request IDs rather than payloads or full permits. When recovery finds an in-flight ID without a result, answer that ID with a JSON-RPC error carrying `data.outcome: 'unknown'`. Never re-run it automatically. Reads may be retried by the client; retrying a write requires the separately governed idempotency path in [TRL-1295].

Cloudflare [TRL-1481] owns the proposed hibernation host and issuer-qualified routing. Subject, connection, or topic-shard host keys would be recorded on subscriptions so delivery reaches the holding object without moving sockets. The proposed Worker strips client-supplied principal headers before forwarding verified identity. Durable Object storage, attachment/tag budgets, fan-out, and ticket-consumption enforcement remain host acceptance work.

### The lock describes one protocol across hosts

The kernel derives its method table from the live topo and rejects reserved-prefix collisions today. The proposal would persist one method table, subscribable signal facts, and the subprotocol version in the lock for hosts to reference. New overlay namespaces retain the lock-v6 gate [TRL-1424]. Public output-schema checks, error mapping, and checks against exposing signals without durable materialization belong to their implementing issues, not this documentation change.

## Consequences

The RPC surface gives hosts one contract-derived protocol and preserves the `derive`/`create`/`surface` ladder. A serialized kernel can run in Bun or a hibernating host without changing trail behavior. One shared delivery model prevents a WebSocket replay fork.

The delivery log, admission/watermark accounting, host state persistence, and connection lifecycle have real cost. Per-signal live ordering avoids promising unnecessary total ordering, but it still requires safe checkpoint accounting. Authentication and refresh need client-visible proof rather than server-only state. None of those costs is solved by an in-process buffer.

## Sequencing and completion

The plan's earlier “Waiting on Matt” sequencing note is historical. The October 28 operating decision allowed the kernel and basic Bun host to land before durable subscriptions, with only their implemented capabilities advertised. That source-work order did not authorize a release or change the delivery contract. The subscription rendering [TRL-1441] still needs ADR-0059, outbox [TRL-1505], Auth grant [TRL-1464], subscription conformance, and applicable lock-v6 gates. Passing base host conformance does not satisfy the subscription cases.

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
[TRL-1441]: https://linear.app/outfitter/issue/TRL-1441
[TRL-1464]: https://linear.app/outfitter/issue/TRL-1464
[TRL-1479]: https://linear.app/outfitter/issue/TRL-1479
[TRL-1481]: https://linear.app/outfitter/issue/TRL-1481
[TRL-1505]: https://linear.app/outfitter/issue/TRL-1505
[TRL-1295]: https://linear.app/outfitter/issue/TRL-1295

[^plan]: [WebSocket surface plan, connected Notion copy](https://app.notion.com/p/4061b36f46cb8189a6d3d488b661adc1), read October 28, 2026. Its Sources identifies Claude artifact `UoKu97C72N4fsGSLQP1zPW`, revision 24, copied October 27. The method table and decisions log ground this rewrite; the campaign's later sequencing decision and the explicit reconciliations above govern the conflicting passages.
[^jsonrpc]: [JSON-RPC 2.0 specification](https://www.jsonrpc.org/specification): requests, notifications, errors, batches, and the reserved `rpc.` prefix.
