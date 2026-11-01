# Cloudflare deployment bindings

Author portable infrastructure with `@ontrails/kv`, `@ontrails/blob`, and `@ontrails/queue`. The Cloudflare adapter binds those contracts to existing native Worker bindings. The native resources `cloudflareKv`, `cloudflareR2`, and `cloudflareQueue` remain available for applications that need their provider-specific APIs.

This fieldguide covers resource binding and migration. It does not create infrastructure, choose account identifiers, apply migrations, publish packages, or deploy a Worker. Automated deploy rendering and durable target-locked markers remain separate work.

## Connect role resources to a Worker

The adapter declares the three role packages as runtime peers. Install compatible role versions alongside the adapter; a source checkout or local pack check does not establish their availability in a package registry.

Declare resources with stable ids in the app module:

```ts
import { blob } from '@ontrails/blob';
import { kv } from '@ontrails/kv';
import { queueProducer } from '@ontrails/queue';

export const flags = kv('flags');
export const uploads = blob('uploads');
export const jobs = queueProducer<{ id: string }>('jobs');
```

Trails continue to declare `resources: [...]` and use `flags.from(ctx)`, `uploads.from(ctx)`, or `jobs.from(ctx)`. Each resource has an isolated memory mock for `testAll(app)`; production creation requires an explicit binding and never silently falls back to memory.

Supply Cloudflare clients through the existing Worker resource overrides:

```ts
import { createCloudflareKvBinding } from '@ontrails/cloudflare/kv';
import { createCloudflareBlobBinding } from '@ontrails/cloudflare/r2';
import { createCloudflareQueueBinding } from '@ontrails/cloudflare/queues';
import { createWorkersHandler } from '@ontrails/cloudflare/workers';
import { graph, flags, uploads, jobs } from './app.js';

export default createWorkersHandler(graph, {
  resources: (env) => ({
    [flags.id]: createCloudflareKvBinding(env['FLAGS']),
    [uploads.id]: createCloudflareBlobBinding(env['UPLOADS'], {
      maxBufferedBytes: 1_048_576,
    }),
    [jobs.id]: createCloudflareQueueBinding(env['JOBS']),
  }),
});
```

The native bindings must already be present on the Worker env. Use the selected app's Wrangler configuration to associate `FLAGS` with its KV namespace, `UPLOADS` with its R2 bucket, and `JOBS` with its queue. Keep account and resource identifiers in the owning configuration. The factories do not register a global resource/env map or change the portable resource definitions. Missing or malformed bindings fail explicitly.

The Worker host resolves resource overrides per env identity. A new env identity builds fresh clients; list cursors belong to the client and prefix that issued them. Do not persist cursors across client reconstruction, copy them between resources, or reuse old native cursors after migration. Tokens are opaque continuations, not authorization credentials or a cross-deployment compatibility format.

## Migrate existing resources

Keep the same resource id when replacing a native declaration, then add the corresponding client to `resources(env)`. Merely renaming an import does not supply a native binding.

| Existing resource | Portable declaration | Cloudflare binding |
| --- | --- | --- |
| `cloudflareKv('flags', { binding: 'FLAGS' })` | `kv('flags')` | `createCloudflareKvBinding(env['FLAGS'])` |
| `cloudflareR2('uploads', { binding: 'UPLOADS' })` | `blob('uploads')` | `createCloudflareBlobBinding(env['UPLOADS'], { maxBufferedBytes })` |
| `cloudflareQueue<Body>('jobs', { binding: 'JOBS' })` | `queueProducer<Body>('jobs')` | `createCloudflareQueueBinding<Body>(env['JOBS'])` |

Review each call site's input and result shape:

- **KV:** use `ttlSeconds` instead of native `expirationTtl`. The classic Workers KV binding rejects TTLs below 60 seconds and list limits above 1000. Absolute expiration is not a portable option; retain the native API where it is required or make the application's relative-expiry policy explicit. Portable list keys are strings, and `complete` replaces `list_complete`. A short or empty page can still be incomplete. Continue until `complete` is true.
- **Blob:** writes accept `Uint8Array` or readable byte streams, with `mimeType` as the portable MIME option. Encode text explicitly before writing. `put`, `head`, and `list` return `{ key, size, mimeType }`; `get` returns core `BlobRef` or `null`. Read bytes through `BlobRef.data`, and use its native measured size and key-derived name. Native R2 conditions, ranges, checksums, versions and multipart APIs remain on the native resource.
- **Queue:** use plain acyclic JSON bodies, including arrays, primitives and `null`. Own data keys such as `__proto__` remain data. Native `v8`, text and byte content modes are outside this producer contract. The binding snapshots and validates the entire batch before I/O; an empty batch is a no-op. Delay is per entry, with omission retaining the queue default and explicit `0` requesting no delay. Consumer activation remains core `queue()` with an authored `parse` contract; producer typing does not validate consumer compatibility.

The native resources keep their existing behavior and can coexist with portable resources in the same app. A resource that continues to use provider-specific capabilities remains intentionally target-locked. [TRL-1452](https://linear.app/outfitter/issue/TRL-1452) owns the saved role/target-locked markers and deploy namespace migration. An inspectable live `role` field or a successful local test is not evidence that those lock facts are present.

## R2 stream writes and metadata

`maxBufferedBytes` is required and must be a positive safe integer in bytes. Choose it from the application's payload and memory budget; the adapter supplies no universal default. All authored streams are buffered up to that cap before one native `put`. Byte arrays go directly to native `put` and are not limited by this stream-only cap.

Overflow, invalid byte chunks and source-read failure release the reader and attempt cancellation without starting a native write. These pre-write failures leave an existing object untouched. Once native I/O starts, a rejection can leave the outcome uncertain: the binding promises neither rollback nor safe automatic retry. It does not try native streaming first and then replay the input, guess a content length, or add multipart machinery.

The cap bounds accumulated payload bytes only. It does not bound isolate RSS, concurrency, final-copy overhead or provider memory. Native R2 streaming remains available through `cloudflareR2` when its provider-specific body constraints fit the app.

Stored MIME metadata is preserved across writes, reads, heads and listing; omitted MIME defaults to `application/octet-stream`, with no extension sniffing. Each read owns a fresh stream. Head and list calls do not consume bodies. `BlobRef.size` reports native stored size, while workerd controls HTTP framing and may omit `Content-Length` for streamed responses.

## Failures and delivery policy

These Promise-based infrastructure methods reject with `TrailsError`; consuming trail implementations catch failures and return `Result.err()`. Local argument, limit and cursor failures are `ValidationError`. Existing typed provider failures retain their identity. Unknown native-operation failures become `NetworkError`, with the original error as cause and neutral role/operation context. Malformed provider results and adapter invariant failures remain distinct internal failures. Failed reads and lists never become a missing value or an empty page.

The existing consumer may retry `NetworkError`; that does not prove a transient outage, a safe repeat, or that no write was accepted. There is no inline retry, hidden batch splitting, new acknowledgement policy, or exactly-once guarantee. Queues success means native acceptance, not business processing or ordering.

Cloudflare imposes provider limits beyond the portable schemas. The queue binding rejects more than 100 messages per batch, delays above 24 hours, JSON bodies above 128 KB, and JSON batch payloads above 256 KB. Those byte checks do not guarantee native acceptance: provider metadata also counts toward limits. See the current [Queues limits](https://developers.cloudflare.com/queues/platform/limits/) and [classic Workers KV limits](https://developers.cloudflare.com/kv/platform/limits/) when choosing app budgets. KV Instant has different limits and is not the classic paginated namespace qualified here.

## Verification boundaries

The unchanged public role conformance cases run against actual Miniflare native storage/queues. Separate browser-bundled Worker integration exercises env resources, R2 byte streaming, queue parsing and native redelivery after a producer failure. Miniflare's Node proxy cannot carry some valid JSON keys or R2 stream transfers under Bun, so the relevant test fixtures invoke native operations inside a Worker. They do not replace native storage with memory mocks.

The local evidence uses the installed June-compatible runtime. It does not establish October runtime qualification, production KV consistency, registry publication, remote deployment, or the pending deploy-lock facts. Existing native-resource regression tests remain part of qualification.
