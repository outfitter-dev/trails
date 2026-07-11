---
"@ontrails/warden": patch
"@ontrails/source": patch
---

Add the advisory captured-kernel Warden rule for ownership review when a public
subpath re-exports package internals and multiple production workspaces consume
that subpath, including import-then-export barrels that preserve the internal
binding through a local alias or default export.

Expose typed import-kind inspection from `@ontrails/source` so project rules
can keep erased type bindings separate from runtime exports.
