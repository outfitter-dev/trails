# @ontrails/kv

## 0.3.0

### Minor Changes

- [`2c17f6d`](https://github.com/outfitter-dev/trails/commit/2c17f6dc73bbcd014e192926c4652d61f3a7dd7b): Add provider-neutral KV resource declarations, canonical option/page schemas, an isolated memory mock, and shared binding conformance cases. Provider rebinding and profile selection remain separate work.

### Patch Changes

- [`ef1701b`](https://github.com/outfitter-dev/trails/commit/ef1701bf8ab186faad64f40b220d23e129740e3b): Add Cloudflare KV, R2 blob and Queue producer bindings for the portable role contracts through ordinary Worker resource overrides. Reuse the neutral public schemas, enforce client/prefix cursor scope, preserve native size/MIME, require an explicit bounded stream-write budget, and validate/snapshot complete JSON batches before native I/O. Preserve typed failures and map unknown native-operation failures to the existing retryable NetworkError boundary without automatic retries. Native resource APIs retain their behavior. Add runtime role peers and migration/deployment-binding guidance; durable target-locked/deploy facts remain separate work.
  
  The shared `createKvContractCases` suite gains a cursor-scope case: a valid list cursor used with another prefix or against another binding is refused, and the same binding and prefix continue from it.
