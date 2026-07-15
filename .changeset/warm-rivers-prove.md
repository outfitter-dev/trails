---
'@ontrails/regrade': minor
'@ontrails/trails': minor
'@ontrails/warden': minor
---

Require committed Regrade provenance for governed vocabulary transitions.

Applied governed plans now expose deterministic transition, plan, source,
safe-apply, and review-follow-up evidence through history results. Warden loads
committed history into project context, cites it for reintroduced symbols, and
rejects invalid or missing provenance for transitions that require Regrade in
the workspace that owns the governed registry, without making downstream apps
prove the framework's own migrations.
Portable validation accepts the authoritative numeric file-rename counters
persisted by Regrade history.
