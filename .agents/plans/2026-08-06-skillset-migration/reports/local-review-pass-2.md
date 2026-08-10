---
created: "2026-08-06T21:25:00Z"
updated: "2026-08-06T21:25:00Z"
description: Second local review and fixed provenance disposition for TRL-1271.
linear:
  - TRL-1271
impl_status: fixed
references:
  - ../PLAN.md
  - local-review-pass-1.md
  - trl-1271-parity.md
---

# TRL-1271 local review pass 2

## Verdict at review time

Not ready, 4/5. No P0 or P1 findings. Pass 1's behavioral and hermeticity findings were confirmed fixed. One P2 provenance assertion remained incomplete.

## Finding and disposition

### P2 — lock ownership was parsed but per-item ownership was not exact

Per-output locks asserted the complete flattened inventory but allowed files to be reassigned among `.skillset` source items. Root ownership did not yet assert item kind/output path or root build mode.

**Fixed.** Each per-output lock now compares the full ordered 16-item ownership shape: exact `standalone-skill` kind, skill name, `.skillset/skills/<name>/SKILL.md` source, `<name>/SKILL.md` output, and the complete companion list belonging to that skill. Root lock assertions now include `buildMode: all` and the exact kind/source/output/files tuple for all five agent/native-island outputs, with unique output ownership.

## Reverification

`bun run skillset:parity` passes 9 tests with 412 assertions after the fix. A third pass must provide the final clean local-review verdict.
