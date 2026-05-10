---
"@ontrails/core": patch
"@ontrails/warden": patch
---

Fix Codex review findings on type-utils and cross-declarations.

**core**: `inputOf()`/`outputOf()` now preserve the exact Zod schema subtype instead of widening to `z.ZodType`.

**warden**: `cross-declarations` rule now recognizes single-object trail overload, detects any context parameter name (not just `ctx`), matches destructured `cross()` calls, resolves const identifiers in `crosses` arrays, and restricts blaze body extraction to top-level config properties.
