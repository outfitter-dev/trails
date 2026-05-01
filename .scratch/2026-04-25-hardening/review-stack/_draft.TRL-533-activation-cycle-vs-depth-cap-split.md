# TRL-533 Activation Cycle Vs Runtime Depth-Cap Split

**Issue:** TRL-533
**Target:** TRL-454
**Branch:** `trl-533-split-trl-454-activation-cycle-rule-from-runtime-depth-cap`

## Problem

TRL-454 carried two related but different concerns:

- Static activation-cycle detection.
- Runtime depth-cap and suppression behavior.

They share conceptual context but should not remain one overloaded issue.

## Static Activation Cycles

Correct home:

- Warden project-tier or topo-aware rule.
- Graph correctness framing.
- Diagnostics should name the cycle path and involved primitive IDs.
- Tests should include acyclic and cyclic activation graphs.

This work answers: "Can this project graph contain a cycle before execution?"

## Runtime Depth Cap And Suppression

Correct home:

- Runtime execution behavior in `packages/core/src/fire.ts` or adjacent runtime docs/tests.
- Safety framing for deep or unexpected runtime activation behavior.
- Diagnostics should explain depth/suppression decisions at runtime.

This work answers: "What should execution do when runtime activation goes too deep?"

## Split Recommendation

Update TRL-454 or create replacement issues so:

- Static graph cycle detection becomes a Warden/topo correctness issue.
- Runtime depth-cap behavior becomes a core runtime safety issue.
- Shared context is cross-linked, not merged into one acceptance checklist.

## Decision

Do not implement activation-cycle detection and runtime depth caps as one rule. Split by static correctness versus runtime safety.
