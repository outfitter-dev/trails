---
'@ontrails/trails': patch
---

Make Regrade history hashes stable across report serialization and preserve
pre-apply occurrence evidence alongside truthful completion counts and a
freshly scanned post-apply completion report for replay detection. Existing
plans and history stamped with the earlier hash serializer remain valid.
