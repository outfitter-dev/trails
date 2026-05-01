# TRL-532 Duplicate Primitive ID Scope

**Issue:** TRL-532
**Target:** TRL-446
**Branch:** `trl-532-align-trl-446-duplicate-primitive-id-rule-scope`

## Current Reality

Topo construction already rejects duplicate primitive IDs across the established primitive graph. That runtime/construction guard is the first line of defense.

The remaining valuable work is preflight visibility:

- Detect duplicate primitive IDs before runtime construction when source/project evidence is available.
- Explain which owners define the conflicting IDs.
- Avoid presenting duplicate ID checks as signal-only or trail-only coaching.

## Correct Rule Home

Preferred shape:

- Warden project-tier rule when the check needs the whole project graph.
- Source-tier helper if individual source owners can be scanned independently.
- Topo/runtime validation remains the backstop for constructed apps.

Rejected shape:

- A public parser package just to power duplicate ID checks.
- A signal-only lint rule.
- A shadow registry that duplicates topo owner data.

## Acceptance Criteria For TRL-446

- Scope says duplicate primitive IDs across trails/resources/signals/contours where applicable.
- Diagnostics identify both conflicting definitions when source evidence supports it.
- Runtime/topo validation remains mentioned as the backstop.
- Any Warden implementation consumes owner/topo facts instead of inventing a parallel source of truth.

## Decision

TRL-446 should be tightened around durable duplicate primitive ID prevention, not broadened into public parser infrastructure.
