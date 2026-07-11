---
'@ontrails/core': minor
'@ontrails/cloudflare': minor
'@ontrails/warden': patch
---

Add first-class queue activation sources with `queue()` in `@ontrails/core`.
Queue sources validate their runtime queue name and parse contract, project the
queue name into durable topo facts, participate in activation input
compatibility, and block established outputs when malformed.

Add `@ontrails/cloudflare/queues` with `cloudflareQueue`, `createMemoryQueue`,
and `createQueueHandler`. Cloudflare Workers now expose both `fetch` and
`queue` entrypoints from `createWorkersHandler`, resolve env-bound resources for
queue-activated trails, acknowledge successful/skipped/cancelled messages, and
acknowledge traced non-retryable Trails errors so permanently invalid messages
do not churn through the queue. Failures explicitly marked retryable enter
Cloudflare's retry and DLQ flow, with rate-limit delays preserved.

`@ontrails/warden` now treats queue activation sources as materialized and
requires `cloudflareQueue` public export example coverage.
