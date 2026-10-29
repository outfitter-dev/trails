---
'@ontrails/cloudflare': minor
---

Add Cloudflare KV, R2 blob and Queue producer bindings for the portable role contracts through ordinary Worker resource overrides. Reuse the neutral public schemas, enforce client/prefix cursor scope, preserve native size/MIME, require an explicit bounded stream-write budget, and validate/snapshot complete JSON batches before native I/O. Preserve typed failures and map unknown native-operation failures to the existing retryable NetworkError boundary without automatic retries. Native resource APIs retain their behavior. Add runtime role peers and migration/deployment-binding guidance; durable target-locked/deploy facts remain separate work.
