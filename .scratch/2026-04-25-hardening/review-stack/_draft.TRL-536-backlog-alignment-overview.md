# TRL-536 Backlog Alignment Overview

**Issue:** TRL-536
**Branch:** `trl-536-align-existing-backlog-rule-issues-after-doctrine-docs-land`
**Purpose:** Align existing backlog rule issues with current Warden-first, owner-first, source-tier doctrine.

## Doctrine Baseline

- Warden is the durable correctness surface for Trails framework semantics.
- Repo-local Oxlint remains private hygiene and migration pressure.
- Owner modules should export framework facts that projections and rules consume.
- Source-tier rules should use source evidence and avoid invented runtime registries.
- Advisory skills should guide agents through evidence, not become public framework contracts.

## Alignment Children

| Child | Target | Alignment decision |
| --- | --- | --- |
| TRL-532 | TRL-446 | Duplicate primitive ID scope should be Warden/project-aware or topo construction validation, not signal-only coaching or a public parser package. |
| TRL-533 | TRL-454 | Static activation-cycle detection and runtime depth/suppression behavior should split. |
| TRL-535 | TRL-489 | Source vocabulary enforcement can become Warden work only with precise source-code terms and diagnostics; Markdown prose remains editorial/advisory. |
| TRL-551 | repo-local nested barrels | Keep `maxDepth: 2` unless the repo chooses to intentionally flag first-level subpath barrels. |
| TRL-552 | repo-local Bun API hints | Keep mappings narrow; no production imports currently prove added mappings are needed. |
| TRL-550 | repo-local file length | Treat max-file-lines as private hygiene/advisory pressure, not public Warden doctrine. |

## Issue Maintenance Rule

If an old backlog issue still references rejected framing such as public `@ontrails/oxlint`, broad TSDoc registries, or `canonicalSource()` indirection, update or close it rather than preserving stale context for continuity.

## Decision

Close TRL-536 once the child alignment notes are recorded. Future work should happen on the aligned target issues or the new Warden/advisory follow-ups.
