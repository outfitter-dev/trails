---
'@ontrails/trails': patch
---

Derive generated release PR label baselines from the release PR base ref instead of the already-versioned checkout, so a beta.N → beta.N+1 generated release PR receives its `release:*` label automatically and workflow reruns preserve all three generated label families.
