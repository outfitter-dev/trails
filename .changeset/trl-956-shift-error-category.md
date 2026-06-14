---
"@ontrails/core": patch
"@ontrails/warden": patch
---

Reserve the `shift` error category and `WorkspaceShiftError` before the stable
cutover so surface mappings can distinguish moved-workspace retry verdicts.
Update Warden's error-mapping completeness examples to cover the reserved
category.
