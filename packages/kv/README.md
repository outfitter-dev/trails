# @ontrails/kv

Declare string key-value infrastructure without naming a provider. The role declaration is an ordinary Trails resource with a fixed, frozen `role: 'kv'` field. It has a default isolated memory mock, so `testAll(app)` works without configuration. Production creation fails with a `ValidationError` until a binding is supplied through ordinary resource overrides; it never silently uses memory.

```ts
import { createKvMock, kv } from '@ontrails/kv';

const flags = kv('flags');
const client = createKvMock();
await client.put('color', 'blue', { ttlSeconds: 60 });
const color = await client.get('color'); // 'blue'
// Trails declare resources: [flags] and use flags.from(ctx).
```

The runtime root is portable and does not import the Bun test runner. Shared conformance cases live in `@ontrails/kv/testing`.

## Client contract

| Method | Outcome |
| --- | --- |
| `get(key)` | A string, or `null` for a missing or expired key. |
| `put(key, value, options?)` | Replaces the value. An omitted TTL removes any previous expiry. |
| `delete(key)` | Succeeds even when the key is absent. |
| `list(options?)` | A discriminated page: `{ complete: true, keys }` or `{ complete: false, cursor, keys }`. |

Options and page facts have canonical Zod schemas: `kvPutOptionsSchema`, `kvListOptionsSchema`, and `kvListPageSchema`. Their TypeScript types are inferred from those schemas. Keys and values are strings; this package adds no JSON codec, entity schema, transaction, or compare-and-swap API.

`ttlSeconds` is a finite positive whole number of seconds. Expiry occurs at `now >= deadline`. Unsupported expiry ranges fail rather than producing immortal entries. The memory factory alone accepts a `now()` clock returning milliseconds. A provider may impose a larger minimum TTL; its binding must translate or reject unsupported durations explicitly. The neutral contract does not adopt Cloudflare's provider-specific minimum.

List options accept `prefix`, a positive integer `limit`, and an opaque `cursor`. Limit is a maximum; a short or empty page can still be incomplete. Continue until `complete` is true. Incomplete pages require a nonempty cursor; complete pages have none. Cursors belong to one binding and prefix query; they are not portable across bindings. No ordering or snapshot consistency across pages is promised. The memory mock defaults to a maximum of 1000 keys per page when limit is omitted; provider bindings document their own default page size.

These infrastructure accessors return Promises and reject with typed `TrailsError` failures, following the existing store accessor boundary. A binding failure must not become `null` or an empty page. Trail implementations catch and return `Result.err()`; they do not throw. Resource creation retains the core lifecycle `Result` contract.

## Shared binding conformance

```ts
import { test } from 'bun:test';
import { createKvMock } from '@ontrails/kv';
import { createKvContractCases } from '@ontrails/kv/testing';

for (const example of createKvContractCases({
  createSubject: () => {
    let now = 0;
    return {
      client: createKvMock({ now: () => now }),
      advanceTime: (milliseconds: number) => { now += milliseconds; },
    };
  },
})) {
  test(example.name, example.check);
}
```

Each case creates an isolated subject and disposes it even on failure. The suite covers missing values, overwrite/delete, prefix pagination with explicit completion, expiry, clearing expiry on overwrite, and typed validation failures. The fixture supplies `advanceTime(milliseconds)` to advance a controlled clock or await real expiry. Its `ttlSeconds` defaults to 60 and may be raised for a provider; real-time expiry tests need an appropriate runner timeout. Exact deadline behavior is additionally tested on the memory clock. Memory success does not establish remote consistency or a provider's limits.

## Ownership and rollout

This infrastructure role coexists with schema-derived persistence through `store()`; it does not replace or narrow that model. Core owns `resource()`, `BlobRef`, and queue consumer activation. The dedicated role packages own their runtime contracts; providers own bindings. See [ADR-0051](../../docs/adr/0051-package-ownership-follows-natural-altitude.md).

The role field is inspectable on the live declaration and topo. It is not currently included in `trails.lock` or its hash; later deploy overlay work owns that capture and drift coverage. No deployment portability is proved here.

[TRL-1519](https://linear.app/outfitter/issue/TRL-1519) owns Cloudflare rebinding, the same conformance suite under Miniflare, and migration guidance. Existing `cloudflareKv` resources keep their provider-specific API. This source package does not claim that binding, migration, registry publication, or live deployment is complete. The first package release needs normal pack validation and separate publication authority.
