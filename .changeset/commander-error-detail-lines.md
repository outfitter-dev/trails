---
'@ontrails/commander': patch
---

Render operator-actionable detail lines after CLI execution errors: validation failures list their topo issues (message plus trail id) and permission failures name the required permit scopes with a copyable `--permit` form. Non-internal Trails error context only, passed through the shared redactor; internal errors keep the redacted generic message.
