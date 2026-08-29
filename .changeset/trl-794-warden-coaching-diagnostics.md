---
'@ontrails/warden': patch
---

Upgrade the second wave of Warden diagnostics — the audit's "partial" set — to coaching diagnostics that teach the canonical fix instead of only naming the violation: `context-no-surface-types`, `static-resource-accessor-preference` (inline dependency construction), `example-valid`, `valid-detour-contract` (`on:` constructor), `intent-propagation`, `error-mapping-completeness`, `unreachable-detour-shadowing`, `draft-visible-debt`, `version-pinned-compose`, `orphaned-signal`, `scheduled-destroy-intent`, `resource-id-grammar`, `incomplete-crud`, and `webhook-route-collision`. Rule firing logic is unchanged; only diagnostic text and the matching test/example expectations moved.
