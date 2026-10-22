---
'@ontrails/trails': patch
---

Accept GitHub stacked-PR merge evidence for `publish:auto`. A merged changeset source PR now earns trusted source evidence when its REST resource carries a GitHub `stack` object and required CI passed on its head SHA or merge SHA, recorded as `GitHub stack #N and required CI passed on <sha>`. Graphite merge-queue evidence and the `stack:boundary` label work as before. Standalone PRs and any unreadable or unrecognized response still fail closed to `publish:manual`.
