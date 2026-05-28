---
created: 2026-05-08T18:14:37Z
updated: 2026-05-08T18:14:37Z
description: Decision record for TRL-638 concluding that @ontrails/commander does not need custom descriptor discovery at split time. Defines the Commander adapter package split shape, expected public API, package metadata requirements, and a two-issue implementation order (TRL-639 + TRL-640).
references:
  - adapters/commander
  - packages/cli
linear:
  - TRL-638
  - TRL-639
  - TRL-640
impl_status: implemented
---

# Commander Descriptor Readiness

- **Date:** 2026-05-08
- **Issue:** TRL-638
- **Branch:** `trl-638-confirm-adapter-descriptor-readiness-for-ontrailscommander`

## Decision

`@ontrails/commander` does not need new package descriptor discovery machinery in its first PR. The Commander split can proceed as a direct adapter package extraction with ordinary package metadata, a package-local README, package exports, and the existing workspace/package scripts.

Descriptor discovery can be deferred until Trails has a broader adapter descriptor contract that applies consistently across adapter packages. Commander should not invent a one-off descriptor shape during the split.

## Split Shape

- Package location: `adapters/commander`.
- Package name: `@ontrails/commander`.
- Public API expected at split time:
  - `surface`
  - `createProgram`
  - `toCommander`
  - `ToCommanderOptions`
- `@ontrails/cli` remains the framework-agnostic command model owner: `CliCommand`, flag/arg derivation, validation, and output/prompt helpers stay there.
- `@ontrails/commander` owns the Commander runtime adapter: importing `commander`, translating `CliCommand[]` into a `Command`, and parsing argv through `surface`.
- No `@ontrails/cli/commander` compatibility subpath should be kept. The branch that moves the runtime code must also remove the old package export.

## Package Metadata

At split time, `@ontrails/commander` should carry normal publishable package metadata only:

- `package.json` `name`, `version`, `type`, `files`, `exports`, scripts, and dependency fields aligned with the existing adapter packages.
- dependency on `@ontrails/cli` via `workspace:^`.
- peer dependency on `@ontrails/core` only if required by exported surface option types.
- dependency or peer dependency on `commander` chosen by the code shape and publish check behavior during TRL-639; do not rely on downstream consumers accidentally bringing it through `@ontrails/cli`.
- no package-level `trails` descriptor metadata yet.

## Implementation Order

Treat the split as a clean package move plus a follow-up sweep:

1. TRL-639 creates `@ontrails/commander`, moves the Commander runtime code, removes `@ontrails/cli/commander`, and updates the compiled consumers and tests needed for the branch to stay green.
2. TRL-640 finishes the direct cutover for current-facing docs, scaffolds, package READMEs, plugin guidance, and any residual active references found by the sweep.

That keeps the package-boundary move reviewable while still honoring the pre-v1 clean-cut rule. The temporary review split is not a compatibility bridge.

## Verification

- `bun run format:check`
