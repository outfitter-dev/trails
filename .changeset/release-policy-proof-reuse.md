---
"@ontrails/trails": patch
---

Make generated release publish policy gather CI proof only for `publish:auto`, reuse generated release PR head proof when it matches the released tree, tolerate duplicate pending checks after a required check has passed, and log registry readiness separately from publish authorization.
