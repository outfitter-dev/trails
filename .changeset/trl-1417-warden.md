---
"@ontrails/warden": patch
---

Recognize explicit Result-returning class methods on typed core resource clients in both Result provenance rules, including configured resources, direct named relative imports, and awaited Promise results. Preserve narrowed Err passthrough, detect redundant rewraps, and decline provenance for shadowed or reassignable bindings and containers that merely contain a Result.
