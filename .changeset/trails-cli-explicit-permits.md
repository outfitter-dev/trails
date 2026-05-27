---
'@ontrails/trails': patch
'@ontrails/cli': patch
---

Declare explicit permit scopes on mutating built-in CLI trails and scaffolded entity starter trails.

Preserve the resolved CLI permit on result callbacks so run-collision recovery can re-execute protected trails without losing authorization context.
