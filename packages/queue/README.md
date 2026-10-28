# @ontrails/queue

Provider-neutral queue producers for Trails. `queueProducer()` declares an ordinary resource with a frozen live `role: 'queue'`. Each declaration includes an isolated recorder for `testAll(app)`; production creation fails explicitly until a resource override supplies a binding. Core `queue()` continues to own consumer activation.

```ts
import { createQueueMock, queueProducer } from '@ontrails/queue';

const jobs = queueProducer<{ id: string }>('jobs');
const local = createQueueMock<{ id: string }>();
await local.send({ id: 'job-1' }, { delaySeconds: 0 });
local.messages(); // [{ body: { id: 'job-1' }, delaySeconds: 0 }]
```

Trails declare `resources: [jobs]` and use `jobs.from(ctx)`. Existing resource override maps supply a client under the resource ID. Role identity is live-inspectable only; this package adds no deploy profile resolution, lock projection, provisioning, or consumer registration.

## Producer contract

- `send(body, { delaySeconds? })` accepts one portable JSON value. Objects, arrays, strings, finite numbers, booleans, and `null` are supported. Unsupported values reject without coercion: no Date-to-string, NaN-to-null, omitted undefined, custom `toJSON`, or typed-array conversion. Cycles, symbols, accessors, hidden properties, sparse/decorated arrays, and class instances are rejected. Shared acyclic references are allowed and snapshotted as JSON values.
- `sendBatch(messages)` accepts a finite readonly array of `{ body, delaySeconds? }`. The binding validates and snapshots the complete batch before starting provider I/O, so a locally invalid later entry cannot cause an earlier send. An empty array is a no-op. There is no batch-level delay option or hidden chunking around backend limits.
- `delaySeconds` requests a minimum delivery delay and must be a finite nonnegative integer. Omission preserves configured binding defaults; explicit `0` overrides delay. Exact timing is not promised. Provider size, count, and maximum-delay limits are explicit binding constraints.

Success means accepted for enqueueing. It does not prove consumer processing, delivery ordering, exactly-once delivery, deduplication, or business atomicity. Provider rejection or timeout can leave the outcome uncertain; no rollback, batch atomicity, or automatic retry is promised. Infrastructure methods reject with a specific `TrailsError`; consuming trails return `Result.err()`.

The generic `QueueProducer<Body>` supplies call-site typing. It does not prove consumer compatibility or replace business validation. The application owns its message schema and can derive the producer body from that schema's wire **input** type. Core consumer parse may transform input into a different output type, so `QueueSource<TOutput>` is not automatically a producer body type.

```ts
import { queue } from '@ontrails/core';
import { queueProducer } from '@ontrails/queue';
import { z } from 'zod';

const messageSchema = z.object({ count: z.string().transform(Number) });
const source = queue('job.received', { parse: messageSchema });
const outbox = queueProducer<z.input<typeof messageSchema>>('outbox');
```

Those declarations remain separate. Profiles/provider configuration must connect the producer binding and existing consumer source to the same physical queue. Matching strings alone do not prove wiring. Core retains source identity, parse/output/payload, and activation; the Cloudflare consumer materializer retains acknowledgement and retry mapping.

## Memory and shared conformance

`createQueueMock()` returns a producer recorder with `messages()` and `clear()` on its mock type only. It snapshots bodies/options on submission and returns independent snapshots on inspection. It records requested delay, including omission versus `0`, and submission order. It never sleeps, delivers, subscribes, acknowledges, retries, or invokes consumers; recorded order is not a real delivery-order promise.

The test-only `@ontrails/queue/testing` export provides `createQueueContractCases({ createSubject })`. A fixture supplies an isolated `client`, an `observe()` hook for accepted bodies/options, an `attempts()` counter, and optional `dispose()`, which runs in `finally`. Real provider fixtures increment attempts **before** each native provider call, including rejected calls. Memory fixtures count recorded submissions because the recorder performs no I/O. Invalid single/batch submissions and empty batches must leave attempts at zero; valid probes confirm that the counter observes operations. Register each case's `name` and `check` with Bun's test runner. Provider fixtures must invoke the actual binding before observing acceptance; an observation log alone cannot establish consumer delivery or timing. The runtime root does not import `bun:test`.

The same suite checks JSON values, mutation isolation, requested delays, complete-batch validation, invalid bodies/options, and empty batches. Real provider conformance and an integration case through existing core consumer parse and acknowledgement/retry mapping remain required via [TRL-1519](https://linear.app/outfitter/issue/TRL-1519). Passing a memory recorder is not provider proof.

## Integration and release status

This additive package does not replace `cloudflareQueue`. Provider-specific bytes/text/V8 modes, metrics, batch defaults, and other richer capabilities remain on target-locked resources. This producer contract does not relocate the consumer materializer or narrow its existing behavior.

The new package needs its first registry publication through the repository's Bun release workflow. Source, memory conformance, a changeset, and package checks do not claim publication, Cloudflare producer conformance, profile wiring, or deployment. Core retains `resource` and consumer activation; see [ADR-0051](../../docs/adr/0051-package-ownership-follows-natural-altitude.md).
