---
"@ontrails/core": patch
"@ontrails/warden": patch
---

Fix Codex review findings on type-utils and follow-declarations.

**core**: `inputOf()`/`outputOf()` now preserve the exact Zod schema subtype instead of widening to `z.ZodType`.

**warden**: `follow-declarations` rule now recognizes single-object trail overload, detects any context parameter name (not just `ctx`), matches destructured `follow()` calls, resolves const identifiers in `follow` arrays, and restricts run body extraction to top-level config properties.
