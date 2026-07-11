---
"@ontrails/warden": patch
"@ontrails/regrade": patch
"@ontrails/trails": patch
---

Govern the exact `@ontrails/warden/ast` to `@ontrails/source` package route
transition for Regrade string-literal and module-specifier rewrites exposed
through the Trails CLI and MCP tools. Safe rewrites now require the owning
manifest to already declare the target package; otherwise Regrade preserves the
occurrence with dependency repair guidance. Invalid manifests remain unchanged
and produce structured repair guidance that names the owning manifest. Explicit
preserve rules remain no-ops before dependency validation, and dotted or
subpath-like near routes remain deferred instead of becoming invented imports.
