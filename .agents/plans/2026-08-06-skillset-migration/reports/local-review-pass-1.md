---
created: "2026-08-06T21:18:00Z"
updated: "2026-08-06T21:18:00Z"
description: First local review and fixed dispositions for the TRL-1271 parity proof.
linear:
  - TRL-1271
impl_status: fixed
references:
  - ../PLAN.md
  - trl-1271-parity.md
---

# TRL-1271 local review pass 1

## Verdict at review time

Not ready, 2/5. No P0 findings. Two P1 and two P2 proof-completeness findings required fixes.

## Findings and dispositions

### P1 — negative capability facts were reported but not reproduced

The initial harness did not itself create a `0755` source, reproduce mixed-root `--adopt all`, prove non-automatic agent adoption, or attempt the exact portable Clark profile.

**Fixed.** Separate temporary fixtures now reproduce mode lowering and chmod-only drift blindness, generated-root-first adoption plus the project-agent survey skip, and Clark's unmanaged `trails` rejection before the lossy island fallback. The ordinary inventory test also compares every canonical source mode against both outputs.

### P2 — provenance was normalized without complete assertions

The initial semantic comparison removed generated metadata without first checking it, and root-lock ownership used substring checks.

**Fixed.** Generated skill and agent metadata are asserted before normalization. Root and per-output locks are parsed and checked for their exact compiler marker, schema/build/source/target fields, item/file inventory, source-to-output ownership, and uniqueness.

### P2 — child environment was filesystem-isolated but not behavior-hermetic

The initial fixture inherited the parent environment and removed only `NODE_ENV`, allowing behavior-changing `SKILLSET_*` variables to leak in.

**Fixed.** Child CLI calls now receive an allowlist containing required PATH/locale values plus temporary HOME, TMPDIR, and XDG roots. Parent `NODE_ENV`, `SKILLSET_*`, and unrelated variables are excluded.

## Reverification

`bun run skillset:parity` passed 9 tests after these fixes. Pass 2 independently confirmed these dispositions and requested one further lock-item ownership refinement.
