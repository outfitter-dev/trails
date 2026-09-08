---
'@ontrails/trails': patch
---

Validate every current changeset's package names against the workspace during release checks, including unchanged files and retained prerelease changesets. Report the changeset path and unknown package before stale references can break version calculation on main.
