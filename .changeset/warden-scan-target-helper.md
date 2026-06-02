---
"@ontrails/warden": patch
---

Expose shared Warden source scan-target predicates so downstream consumers can
preserve the CLI runner's test and declaration-file filtering before invoking
Warden-owned rules directly.
