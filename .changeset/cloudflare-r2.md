---
'@ontrails/cloudflare': minor
'@ontrails/warden': patch
---

Add `@ontrails/cloudflare/r2`, an env-bound Cloudflare R2 bucket resource with
`cloudflareR2`, `createMemoryR2`, and `r2ObjectToBlobRef`. The resource
materializes Worker `r2_buckets` bindings through the shared env bridge, records
Cloudflare lock overlay facts, carries an in-memory object mock for
configuration-free tests, and documents the supported object operations plus
streaming/metadata boundaries.

`@ontrails/warden` now treats `cloudflareR2` as a required Cloudflare public
export with `@example` coverage.
