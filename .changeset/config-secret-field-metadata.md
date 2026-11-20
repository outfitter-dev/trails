---
"@ontrails/config": patch
---

Add a names-only secret-field metadata derivation for explicitly selected resource config branches. Preserve declared requiredness and ancestor wrapper facts, and report unsupported or unresolved shapes without evaluating defaults or exposing values.

Object inspection is capability-gated: it is qualified on Zod 4.6.7 and safely reports incomplete metadata on exact 4.3.5. The existing Zod peer range is unchanged.
