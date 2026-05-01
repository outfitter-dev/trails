---
name: trails-dogfood-check
description: Use when reviewing Trails-owned framework code for Result-shaped failures, resource and cwd boundaries, app loading, and documented host construction exceptions.
---

# Trails Dogfood Check

Use this skill when framework-owned trails, CLI helpers, loaders, or generators drift from the rules consumer trails must follow.

## Workflow

1. Locate the trail blaze, helper, loader, or materializer under review.
2. Decide which boundary it lives on:
   - Trail runtime behavior should return `Result` and specific `TrailsError` values.
   - Host construction, parser setup, and programmer-error boundaries may throw when documented.
   - CLI presentation may handle process output and exits at the surface edge.
3. Check ambient state access. Prefer explicit `rootDir`, `workspaceRoot`, config, or resource inputs over `process.cwd()` in reusable framework logic.
4. Check app-loading and materialization paths for Result-shaped errors unless they are intentionally outside trail execution.
5. Verify tests cover the boundary decision, especially the error shape agents or surfaces will see.

## Authoritative Sources

- `docs/testing.md`
- The nearest package `AGENTS.md` or package tests.

## Advisory Context

- Prior hardening audit theme: framework-owned trails should follow the same Result and boundary doctrine they ask consumer trails to follow.
- PR #300 / TRL-564 changes and tests on queryable-contract hardening are useful precedent for distinguishing runtime Results from documented host-construction exceptions.

## Must Not

- Do not call every throw a bug. Construction and programmer-error seams can stay throws when documented and tested.
- Do not move surface concerns into trail blaze logic.
- Do not replace explicit config or resource inputs with ambient `process.cwd()` or `process.env` reads.
- Do not hide native `Error` values inside `Result.err` where a specific `TrailsError` exists.

## Output

Report:

- Boundary classification.
- Runtime Result or host exception decision.
- Any ambient cwd/config/resource drift.
- Expected error class and projection behavior.
- Tests or follow-ups needed before accepting the change.
