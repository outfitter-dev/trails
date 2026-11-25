---
"@ontrails/warden": patch
---

Recognize explicit Result-returning class methods on typed core resource clients in both Result provenance rules, including direct relative imports and awaited Promise results. Preserve narrowed Err passthrough, detect redundant rewraps, and decline provenance when a type name is shadowed or a receiver is reassigned.
