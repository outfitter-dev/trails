---
'@ontrails/trails': patch
---

Wait up to two minutes for npm metadata and dist-tags to converge during post-publish verification. Retain confirmed package proofs, bound in-flight npm probes by the same deadline, and fail immediately on registry access errors or newer tags without retrying publication.
