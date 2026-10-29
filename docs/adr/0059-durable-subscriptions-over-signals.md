---
id: 59
slug: durable-subscriptions-over-signals
title: Durable Subscriptions Share One Delivery Model
status: accepted
created: 2026-10-28
updated: 2026-10-28
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 6, 12, 26, 38, 39, 47, 52]
---

# ADR-0059: Durable Subscriptions Share One Delivery Model

## Context

`signal()` already names the event catalog. Delivering those events to another process needs a durable record, admission rules, authorization, and a resume position. Building that machinery separately for webhooks, MCP, or WebSocket would give the same signal incompatible failure semantics.

Matt's October 27 decision, recorded in [TRL-1497], is to build the primitive rather than one host's flavor: durable subscriptions over signals, with at-least-once delivery and replay. Exactly-once delivery is not promised. The MCP catch-up plan's shared failure model grounds this decision; the RPC plan renders it rather than redefining it.[^model][^rpc]

This ADR accepts the model. It does not claim the outbox, grant entity, host integrations, or channel conformance already exist. The current source baseline for this document is landed fixture-repair main `4973f974`; implementing issues retain their own acceptance gates.

## Decision

### A subscription specializes existing contracts

A subscription is a store entity: signal selection, filter, delivery target, secret, cursor, and TTL. Derive subscribe, unsubscribe, list, and renew trails from that entity. Delivery is a derived consumer trail with `on: [signal]`; activation owns fan-out and detours own retry. A `durable` tightening declaration enables logging and requires a Warden materialization check. This extends typed signal emission and activation under [ADR-0038](0038-typed-signal-emission.md#decision) and [ADR-0039](0039-reactive-trail-activation.md#decision).

The common model owns an outbox, a per-subscription delivery log, admission/watermark state, and checkpoint semantics. Webhook POST, MCP `subscriptions/listen` and Events, RPC hosted on WebSocket, HTTP SSE, library `app.subscribe()`, and queue delivery are renderings. A host may optimize delivery, but it cannot replace this model with its own cursor or recovery guarantee.

### Record before fan-out and name the crash boundary

Store-derived `created`, `updated`, and `removed` signals append their outbox row in the same adapter call that commits the record. On atomic SQLite, D1, and Durable Object backends, mutation and outbox append are one write; jsonfile provides the same contract through its single writer. Fan-out occurs after the append, so a delivery attempt can be retried from durable state.

Authored `ctx.fire()` signals retain a crash window between the business commit and outbox append. For them, `durable` guarantees at-least-once delivery after the append; it does not make an independent business write atomic with event recording. An outbox-first store call for authored signals is a later release. Store `reconcile` is the repair path for store-backed state until then. Do not present the stronger store-derived guarantee as applying to every authored signal.

### Event identity is different from resume position

An outbox event ID is monotonic in commit order and remains on delivered events for deduplication and audit. It is never a resume cursor. Admission happens after tenant and scope filtering and assigns a contiguous per-subscription delivery sequence, starting at 1, recorded in the delivery log.

A checkpoint is opaque to clients and has two server-owned components:

| Component | Meaning |
| --- | --- |
| `seq` | The subscription's contiguous admitted delivery sequence. |
| `scan` | The global outbox position through which every relevant signal consumer has completed admission or rejection for that subscription. |

A standalone checkpoint can advance `scan` while leaving `seq` unchanged. Thousands of filtered-out events therefore do not strand an idle subscription's retention position. Measuring retention from its last admitted event would make an otherwise healthy filtered subscriber lose continuity.

Replay follows delivery-sequence order, never event-ID order. Parallel consumers may admit event 101 as sequence 7 before event 100 becomes sequence 8; replay delivers 101, then 100. Live delivery is ordered per signal within a subscription only. There is no ordering promise across signals or subscriptions, and a channel must not advertise a stronger total live order merely because a particular implementation happens to provide it.

### A checkpoint certifies a safe prefix

Emit a checkpoint only after all admitted events covered by its sequence boundary have been sent on that stream and its scan watermark is safe across all relevant consumers. A live frame may carry a checkpoint when those conditions hold; a later or standalone checkpoint can certify the completed prefix. If cross-signal live delivery sends sequence 8 before 7, it cannot certify 8 while 7 is missing. This requires admission/frontier accounting, not an RPC-specific payload reorder buffer.

Clients advance their stored checkpoint only after processing everything it covers. Sending and receiving are not processing. Resume is exclusive: `after: C` delivers the tail after C. Already processed events after the last saved checkpoint may recur; stable event IDs allow the consumer to deduplicate them. Every replay frame carries its own safe checkpoint.

Client-held cursors are the default. Named subscriptions hold a server cursor that advances only on an acknowledgment meaning processed. Webhook cursors are server-held. The channel defines how its acknowledgment is carried, while the common model owns what it certifies. An offline host or failed delivery attempt cannot advance the cursor or delete the replay record.

### Authorization controls admission and replay

A broad signal scope is not an authorization decision. Match event tenant to grant tenant first, then check the grant's effective permission: stored granted scopes intersected with current role expansion and the current actor's ceiling, recomputed at revalidation. Initial durable signals declare a tenant key path in their payload. Record-level visibility predicates are a later release; applications needing them keep those signals non-durable or use the library rendering rather than imply safe external fan-out.

Subscription ownership keys on issuer plus subject and, where applicable, tenant. A bare subject ID is not globally unique. Auth owns the stored grant entity, actor/delegation checks, renewal and revalidation policy, and interval cutoffs through [TRL-1464]; a channel does not substitute a current socket token for a webhook or queue grant.

A transient revalidation failure keeps the cursor and retries. An expired or revoked grant delivers nothing. Renewal in place before lapse preserves authorization continuity, while replay still checks the current grant at delivery time. Renewal after a lapse resumes from the cursor but excludes the lapsed authorization span and reports a typed `authorization_gap`. That is distinct from missing retained data, which is `replay_gap`.

The grant records authorization intervals with opening/closing outbox positions, times, and lapse causes: expired, revoked, revalidation failure, or narrowing. Renewal opens a new interval rather than reopening the old span. Replay comparisons use positions; times are retained for display and audit. Auth owns conservative conversion of revocation timestamps into outbox positions, including the configurable five-minute default skew allowance. Ambiguous windows are excluded rather than replayed. Do not invent a separate channel-specific cutoff formula.

The grant's default lifetime is 30 days, with an expiring signal three days before lapse on the subscription's own channel. Renew accepts a fresh credential and preserves subscription ID and cursor; optional sliding renewal is explicit policy. A never-expiring or sliding grant requires the Auth adapter's applicable delegation revalidation, not just a subject-active check. Where the adapter cannot verify delegation, grants stay bounded and cannot silently become never-expiring. Those grant details remain Auth acceptance, not a capability asserted by this ADR alone.

### Retention failure is explicit and recoverable

Outbox and delivery-log retention defaults to 33 days: the 30-day grant lifetime plus three days' renewal notice. Applications may declare shorter or longer retention. Continuous authorization renewal does not guarantee replay continuity; a consumer that falls behind retention still encounters a gap.

If the checkpoint's `scan` predates the retained range, return typed `replay_gap` with an opaque `resumeAfter` checkpoint immediately before the oldest retained admitted event. Internally its sequence is that event's sequence minus one and its scan is the preceding outbox position. `after: resumeAfter` therefore returns the oldest retained admitted event first, without an off-by-one skip. Never return a raw sequence as the recovery cursor. The subscriber chooses that recovery or a new start and uses trails to rebuild state that retention no longer covers.

### Channels share checkpoints and failures

The [RPC surface draft](drafts/20260331-rpc-surface-hosted-on-websocket.md) renders this model through `trails.subscribe`, `trails.event`, `trails.checkpoint`, and `trails.ack`. It preserves client-held defaults, named acknowledgment, exclusive resume, `replay_gap`, `resumeAfter`, and the distinct live/replay ordering guarantees. Its host applies backpressure by pausing or closing 1013 and resuming; it never drops durable records to relieve queue pressure.

MCP `subscriptions/listen` and the MCP Events cursor render the same checkpoint value. Events is an optional, flag-gated rendering, not the primitive: retain the SEP-3415 merge gate and verify the host's actual documented schema and conformance before enabling it. Map an underlying replay gap to a supported gap notification or a host's `truncated` form where required; do not infer ordinary ChatGPT plugin protocol support from Events support. Webhook rendering uses Standard Webhooks signing; SSE, library, and queue renderings retain their own delivery adapters while sharing the model.

Channel implementations must not confuse a broken request-response stream with durable replay. Modern MCP's lack of SSE response-stream resumability does not remove the subscription checkpoint model. Conversely, an SDK's in-process notification bus does not establish an outbox or durable replay.

### Every rendering proves the same boundary cases

The common conformance cases must run on every implemented channel:

| Case | Required evidence |
| --- | --- |
| Unprocessed tail | Deliver sequences 7 and 8, disconnect before 8 is processed, resume after the checkpoint at 7, and deliver 8 again. |
| Idle filter | Unrelated events advance the scan watermark without changing admitted sequence; the subscription stays inside retention. |
| Reversed admission | Event 101 admitted as sequence 7 before event 100 as 8 replays in sequence order: 101, then 100. |
| Retention boundary | With oldest retained admitted event at sequence 50, resuming after `resumeAfter` delivers 50 first and once in that replay, rather than skipping to 51. |
| Cross-signal live prefix | Sending sequence 8 before 7 cannot expose a checkpoint or acknowledgment that skips the missing sequence. |
| Authorization lapse | Renewal cannot replay the lapsed authorization span; it reports `authorization_gap` separately from retention loss. |

The retention-boundary test's one delivery in that replay does not change the overall at-least-once guarantee. Persistence, restart, retry, acknowledgment, and current-grant behavior must be exercised by the implementing issues; a model or a mocked cursor alone is not channel acceptance.

## Consequences

One failure model lets webhook, MCP, RPC, SSE, library, and queue consumers share contract facts and recovery rules. Client-visible checkpoints stay stable when parallel signal admission differs from outbox commit order. Tenant and grant checks apply before delivery rather than becoming a host convention.

Durability has storage and accounting cost: one delivery-log row per admitted event per subscription, plus per-consumer watermark state, pruned with retention. Applications also carry the authored-signal crash window until an outbox-first authoring path ships. The explicit model makes those costs and limits reviewable rather than masking them with a connection-local ring buffer.

## Implementation and release gates

[TRL-1505] owns outbox/delivery logs and checkpoints, [TRL-1507] the durable declaration and Warden materialization check, [TRL-1503] the subscription entity/renderings, and [TRL-1464] grant integration. Subscription renderings merge only after the shared model, usable outbox, Auth grant, and channel conformance are satisfied. New persisted overlay namespaces retain [TRL-1424]'s lock-v6 gate under [ADR-0052](0052-overlays-one-extension-mechanism.md#decision).

The October 28 operating decision permits the RPC kernel and basic WebSocket host earlier, with only implemented request-response capabilities advertised. It does not relax the durable subscription gates or authorize a publication. Elicitation, tasks, provider provisioning, production deployment, and public-release declarations remain separate horizons.

`release:none`: this accepted ADR and its reference/map updates are documentation only. Implementation must carry runtime examples, generated lock facts where applicable, Warden rules, migration instructions, package changesets, and the full conformance evidence. This document closes no implementation issue and claims no live delivery.

## References

- [TRL-1497] — the settled primitive and failure-model acceptance.
- [RPC surface draft](drafts/20260331-rpc-surface-hosted-on-websocket.md) — one rendering; remains draft-only under [TRL-1166].
- [ADR-0000](0000-core-premise.md#decision) — one authored contract, many renderings.
- [ADR-0006](0006-shared-execution-pipeline.md#decision) — trail runtime behavior and Result boundaries.
- [ADR-0026](0026-error-taxonomy-as-transport-independent-behavior-contract.md#decision) — shared failure categories.
- [ADR-0038](0038-typed-signal-emission.md#decision) and [ADR-0039](0039-reactive-trail-activation.md#decision) — typed signal production and consumption.
- [ADR-0052](0052-overlays-one-extension-mechanism.md#decision) — one lock extension mechanism.

[TRL-1497]: https://linear.app/outfitter/issue/TRL-1497
[TRL-1166]: https://linear.app/outfitter/issue/TRL-1166
[TRL-1424]: https://linear.app/outfitter/issue/TRL-1424
[TRL-1464]: https://linear.app/outfitter/issue/TRL-1464
[TRL-1503]: https://linear.app/outfitter/issue/TRL-1503
[TRL-1505]: https://linear.app/outfitter/issue/TRL-1505
[TRL-1507]: https://linear.app/outfitter/issue/TRL-1507

[^model]: [MCP catch-up plan, connected Notion copy](https://app.notion.com/p/4061b36f46cb81129d35c2812931a17a), read October 28, 2026. Its Sources identifies Claude artifact `EFMnjkqV7Lji7j2A7b28jW`, revision 46, including the three review rounds' failure-model, checkpoint, authorization-interval, scan-watermark, replay, and skew corrections. This is an identified connected copy, not a separate live read of the original Claude artifact.
[^rpc]: [WebSocket surface plan, connected Notion copy](https://app.notion.com/p/4061b36f46cb8189a6d3d488b661adc1), Sources identifies Claude artifact `UoKu97C72N4fsGSLQP1zPW`, revision 24. Its stronger live-ordering sentence is explicitly reconciled to this shared primitive; its historical sequencing note is superseded by the October 28 campaign decision.
