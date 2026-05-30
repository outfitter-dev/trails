---
"@ontrails/warden": patch
---

Attach term-rewrite fix metadata to the `no-legacy-layer-imports` rule, marking it review-required with no mechanical edits (the legacy layers were removed, not renamed) so `warden --fix` reports but never auto-applies the migration.
