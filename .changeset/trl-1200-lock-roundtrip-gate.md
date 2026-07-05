---
"@ontrails/trails": patch
---

Add the lock round-trip invariant gate (TRL-1200): `trails release smoke --check lock-roundtrip` discovers every committed `trails.lock`, recompiles each against a cold per-user store in a temporary state home, and asserts `validate` is green and the recompiled lock is byte-identical to the committed one. Failure output names the diverging section and the `trails compile` command that fixes it — hand-editing a lock is never the remediation. Wired into `bun run check` and the CI Governance job via `bun run lock:roundtrip`.
