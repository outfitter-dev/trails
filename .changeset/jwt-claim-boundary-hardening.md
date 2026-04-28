---
"@ontrails/permits": patch
---

Harden JWT permit validation by requiring `exp` by default, validating the
header algorithm allowlist before signature verification, and enforcing finite
clock skew for `exp` and `nbf` checks.
