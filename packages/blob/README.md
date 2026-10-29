# @ontrails/blob

Provider-neutral object storage for Trails. Declare a `blob` resource once and access its binding through the resource accessor. Each declaration includes an isolated memory mock for `testAll(app)`. Production creation fails explicitly until an ordinary resource override supplies a binding.

```ts
import { blob, createBlobMock } from '@ontrails/blob';

const uploads = blob('uploads');
const local = createBlobMock();
await local.put('notes/hello', new TextEncoder().encode('hello'), {
  mimeType: 'text/plain',
});
const info = await local.head('notes/hello');
// { key: 'notes/hello', size: 5, mimeType: 'text/plain' }
```

Trails declare `resources: [uploads]` and use `uploads.from(ctx)`. The ordinary resource override map supplies a client under the resource ID. The live resource carries a frozen `role: 'blob'`; this package does not add core role resolution, deploy profile selection, lock derivation, or provider provisioning.

## Contract

- `put(key, data, { mimeType? })` accepts core `BlobRef['data']`: bytes or a readable byte stream. It consumes a stream once and resolves with `{ key, size, mimeType }` after the write completes. Size describes the actual stored bytes, including zero bytes. No caller-asserted size or second object name is accepted.
- `get(key)` returns core `BlobRef` or `null`. Its `name` is the exact storage key. Each read has independent bytes or a fresh stream; consuming or mutating one read cannot change a later read. Presentation filenames belong to the consuming trail.
- `head(key)` returns metadata or `null` without consuming the object body. `delete(key)` deletes one object and succeeds when it is already absent.
- `list({ prefix?, limit?, cursor? })` returns `{ objects, complete: true }` or `{ objects, complete: false, cursor }`. Metadata includes the actual size and MIME type. Continue until `complete` is true, including after empty or short pages. Limit is a page maximum. Ordering and snapshot consistency are unspecified; cursors are opaque and belong to their binding and prefix query.

Explicit MIME metadata is preserved across put, get, head, and list. Omitted or unavailable MIME metadata is `application/octet-stream`; there is no extension inference or content sniffing. Keys are used exactly. Providers may impose documented size and key limits without silently narrowing the accepted body types.

Infrastructure methods reject with a specific `TrailsError`. Consuming trails convert failures to `Result.err()`. A failed write does not promise rollback or prove that nothing was stored. There is no automatic stream replay, retry, or tee. Target-locked resources retain provider capabilities such as signed URLs, multipart uploads, ranges, conditions, custom metadata, and object events.

## Memory and shared conformance

The memory mock buffers bodies, snapshots input bytes, and returns fresh bytes for each read. Its default list limit is 1000. Stream failure preserves its previous stored value; that mock behavior is stronger than the portable failure contract. This unbounded in-memory mock is for tests and explicit local overrides, not production stream buffering guidance.

The test-only `@ontrails/blob/testing` export provides `createBlobContractCases({ createSubject })`. Each case creates an isolated binding and calls optional `dispose` in `finally`. Register each case's `name` and `check` with Bun's test runner. The cursor isolation case creates two distinct bindings; fixtures must return a fresh binding each time, and both subjects dispose even when a rejection assertion fails. The runtime root does not import `bun:test`.

The cases cover zero bytes, ordinary multi-chunk stream writes, actual size, explicit and default MIME, overwrite, missing reads, idempotent deletion, independent byte ownership, prefix pagination, and typed failures. They follow explicit completion even after an empty incomplete page. Memory passing does not prove a provider binding conforms.

## Integration and release status

This package introduces a new contract without replacing existing Cloudflare `/r2` resources. Cloudflare rebinding and its actual Miniflare conformance run belong to [TRL-1519](https://linear.app/outfitter/issue/TRL-1519). That binding must qualify ordinary authored streams and retain known MIME metadata when listing. A bounded provider write strategy, if needed, belongs to the provider owner; this mock does not mandate buffering.

The new package needs its first registry publication through the repository's Bun release workflow. Source, memory tests, a changeset, and package validation do not claim publication, provider conformance, profile wiring, or deployment. Core continues to own `BlobRef` and `resource`; see [ADR-0051](../../docs/adr/0051-package-ownership-follows-natural-altitude.md).
