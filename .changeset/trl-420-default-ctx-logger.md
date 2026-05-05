---
'@ontrails/core': minor
---

Default `ctx.logger` to a structured stdout console sink when `topo()` is called without an `observe:` option. Apps now get observability for free with zero configuration, per ADR-0041. Explicit `observe:` values (including `combine()` with no sinks, an explicit `Logger`, or an explicit `{ log }` config) are preserved untouched — the default is only injected when no `observe:` is supplied.
