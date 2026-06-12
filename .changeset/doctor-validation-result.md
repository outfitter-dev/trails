---
'@ontrails/trails': patch
---

`trails doctor` now returns the underlying validation error when the app topo is invalid, instead of crashing with a redacted "Internal server error". The diagnostic command reports the diagnosis: validation failures surface with their category, message, and (with the commander detail rendering) the issue list.
