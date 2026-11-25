---
"@ontrails/topography": minor
---

Preserve authored trail metadata during graph derivation and generated-lock serialization, so duplicate-contract coaching can use those annotations. Report metadata-only changes as informational in graph diffs.

Upgrade CLI, CI, and library readers together before recompiling. Existing unmarked locks remain readable; older readers cannot open newly generated locks containing authored trail metadata.
