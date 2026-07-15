---
slug: verdicts-run-on-stable-ground
title: Verdicts Run on Stable Ground
status: draft
created: 2026-06-12
updated: 2026-06-12
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 26]
---

# ADR: Verdicts Run on Stable Ground

## Context

### The incident

On 2026-06-12, a pre-push hook run in this repo failed two tests in `apps/trails/src/__tests__/create.test.ts`. The tests passed in isolation and on every clean re-run. The investigation found the real cause in the reflog: a concurrent agent ran `git checkout` in the same checkout roughly eight seconds into the hook's test phase. The flipped branch range contained one commit that changes `create-scaffold.ts` and its test expectations in lockstep. `git checkout` rewrites files non-atomically, so the running test process read the two files from opposite sides of that commit. The only two tests that assert that lockstep content are exactly the two that failed.

The failure was reproduced deterministically by mixing the two file versions. The tests were correct. The hook's unstated assumption — that the working tree is stable while checks run — was what failed.

### The unstated input

A check like `trails warden`, `bun test`, or `trails release check` renders a verdict: pass or fail. That verdict is only meaningful relative to a stable, identified input. Today the input is implicit — whatever the working tree happens to contain while each file is read. Nothing records what was checked, and nothing detects when the input changes mid-read.

CI solved this years ago by checking out an immutable SHA. Content-addressed build systems solved it with hermetic inputs.[^hermeticity] Local hook and check runs are the un-hermetic holdout, and the gap went unnoticed because the implicit assumption — one human, one editor, sequential operations — held for decades.

### Why this is Trails' problem

Trails drops that assumption deliberately. The framework is agent-native: multiple agents working a checkout concurrently is the normal operating environment, not an edge case. In that environment, concurrent substrate mutation is weather, and a framework that scaffolds verification hooks into adopting projects (`trails create` writes a `lefthook.yml` that runs `bunx trails warden`) ships the hazard to every adopter.

The blame dynamics make it worse. When an adopter's verification hook fails with phantom test output because two of their agents raced, the failure is illegible — and the framework whose name is on the hook eats the blame. Legibility of failure is part of the contract. That is the error-taxonomy principle ([ADR-0026][adr-0026]) applied to the development substrate instead of the trail.

[ADR-0000's information architecture][adr-0000-ia] gives the evaluation frame: the substrate state during a guarded run is **observed** information the framework can capture mechanically. Requiring developers to diagnose it from raw test noise means the framework is carrying too little structure — the same judgment the "Regressions harden the trail" pattern encodes (added to the [tenets](../../tenets.md) in [PR #727][pr-727]; this reference gains its anchor when that lands).

## Decision

### Shift, named

**A shift is a discrete movement of the workspace substrate during a single observation.** It joins drift as a precise vocabulary pair:

| Term | Shape | Detected by | Domain | Recovery |
| --- | --- | --- | --- | --- |
| **Drift** | Gradual divergence between a declared contract and reality, accumulating silently *between* runs | Warden, graph diffs | The contract | Re-align contract and reality |
| **Shift** | Discrete substrate mutation *during* one run, invalidating that run's verdict | The warden's guard | The ground | Reach stable ground, re-run |

The boundary is strict in both directions. A contract change is never a "shift." A shift implies nothing about contracts. The language styleguide gains one guard rule: `drift` for contract-vs-reality divergence, `shift` for substrate movement during observation.

### The warden's guard

**The warden's guard is an invocation wrapper for runs whose verdict an external decision consumes** — a git hook, a CI job, a merge queue, an agent deciding whether to proceed. It detects workspace shift during the guarded observation and voids the verdict, rather than letting mixed-ground results pass or fail misleadingly. The bracket is the primitive; individual commands are participants inside it, not owners of it. And the mechanism guards *any* verdict-producing command, not only Trails-owned ones: tests, builds, release checks, wayfinder dogfood, custom scripts. The name is warden-branded; the protection is universal.

The guard lives in the warden family, and that placement is a claim, not a convenience. **Warden is the authority on whether a verdict can be trusted.** Drift rules say the *contract* cannot be trusted — caught between runs. The guard says the *run itself* cannot be trusted — caught during one. Two arms, one guardian. This is the evaluation hierarchy's first rung — strengthen the existing capability — applied to naming: no new top-level vocabulary at all.

One precision keeps the family claim honest: this is a CLI-and-concept family, not a packaging mandate. The bracket has no dependency on the rules engine and should not be force-moved into `@ontrails/warden` for naming's sake. The warden *command* owns it; where the code lives is an implementation choice.

`trails warden guard` owns the bracket, in two forms:

```bash
# Single wrapper — brackets any command, Trails-owned or not
trails warden guard -- bun test

# Bracket pair — for hook managers that run commands as separate stanzas
trails warden guard start
# ... warden, tests, release checks, custom steps ...
trails warden guard verify
```

The wrapper form arms Tier 1 detection for the child command's duration, owns the child process, and can terminate the guarded command as soon as `HEAD` or the index shifts. `guard start` / `guard verify` bracket multi-command hook configurations: `start` records the fingerprint and may arm a detached watcher; `verify` collects any shift events, applies the close fingerprint, and consumes the bracket state. Pair mode only provides the same fast-abort guarantee when the hook integration gives the watcher authority to terminate the hook manager or its process group. Without that authority, pair mode is still useful stable-ground detection, but intervening commands keep running until `verify` voids the bracket.

One shell footgun, named so docs and scaffolds can refuse it: in `trails warden guard -- bun run check && bun test`, the `&&` belongs to the *outer shell* — only `bun run check` is guarded, and `bun test` runs on unprotected ground while looking bracketed. The wrapper form guards exactly one command. Anything multi-step uses the `start`/`verify` pair or wraps a single script; scaffolds choose the wrapper when fast abort matters and choose pair mode only when the hook manager can supply process-group termination or the delayed `verify` verdict is acceptable.

Guard context propagates by environment only when the guard owns the child process. The wrapper form injects `TRAILS_WARDEN_GUARD=1` into its child, so Trails commands running inside know they are guarded — they can tighten reporting and annotate output — without owning the lifecycle. The `start` / `verify` pair cannot mutate the environment of sibling hook commands after `start` exits. Pair form is still valid for stable-ground detection, but guarded commands that need context awareness must either run through the wrapper, receive an explicit hook-manager environment export, or read shared bracket state.

There is no per-command flag. A flag on `trails warden` cannot protect the `bun test` that runs after it; putting the lifecycle on individual commands would pretend otherwise. The scaffold authors the bracket once in `lefthook.yml`, choosing the wrapper where command context matters and the pair where the hook manager needs a multi-command bracket.

Severity follows the bracket:

- **Inside the guard:** a shift hard-fails the run. A verdict over a mixed tree is worse than no verdict, because passes may be false.
- **Outside the guard:** no shift detection. The bracket is the declaration; an exploratory `trails warden` run while the developer keeps editing pays no overhead and produces no noise.

A naming note for the record: `gate` was considered for this primitive and rejected. It is a retired term — locked in at [ADR-0001][adr-0001] Cutover 1, then deliberately renamed to `layer` at Cutover 2 ([ADR-0023][adr-0023]) — and `gating` remains active vocabulary for Warden's CI role. Retired words get a Reserved-Terms tombstone in the lexicon, not a second life; implementing this ADR adds that tombstone.

### `WorkspaceShiftError` and the `shift` category

The failure earns a taxonomy entry. The error names the event, not an ambient condition — consistent with `NotFoundError` and `TimeoutError`, which name what happened:

```typescript
export class WorkspaceShiftError extends TrailsError {
  readonly category = 'shift' as const;
  readonly retryable = true as const;
}
```

The category extends the [ADR-0026 behavior contract][adr-0026] with one row:

| Category | Retryable | HTTP | CLI exit | JSON-RPC | Meaning |
| --- | --- | --- | --- | --- | --- |
| `shift` | Yes | 503 | 10 | -32603 | Verdict void; substrate moved mid-run; re-run on stable ground |

The mapping choices follow the existing table's logic. HTTP 503 carries "temporarily unable to produce a valid answer, retry later" semantics — distinct from 409 (`conflict`), which means the *request* conflicts with current state and the caller must change something. A shift requires no change from the caller, only stable ground. The dedicated exit code 10 lets scripts and agents mechanically distinguish "your code is wrong" from "the ground moved, re-run" without parsing output.

**Timing constraint:** `ErrorCategory` is a closed union, and the `error-mapping-completeness` Warden rule forces registered surface mappers to cover every category — by design. Adding a category after 1.0 breaks downstream exhaustive switches. The category reservation (name, codes, `retryable`) therefore lands **before the stable cutover**, even though the detection machinery ships at its own pace. The error contract is part of the frozen surface; the behavior is not.

### Tiered detection, failing fast

The repo-local prototype ([PR 733][pr-733]) verifies at close only. That is the weak form: the incident run burned 75 seconds producing misleading assertion noise before any guard could speak. The framework mechanism is tiered:

- **Tier 1 — instant.** For a wrapper-owned child command, watch the
  repository's `HEAD` and index via fs events. A checkout or stage operation
  mid-run — the catastrophic class, and the observed incident — aborts within
  milliseconds, before downstream checks emit a single misleading failure. Pair
  mode can collect the same events, but it earns the instant-abort claim only
  when the hook integration can terminate the hook manager or process group;
  otherwise the event is reported by `verify`. Watch paths resolve through
  `git rev-parse --git-path HEAD` and `--git-path index`, never a hardcoded
  `.git/` layout — **working correctly in linked worktrees is day-one acceptance
  criteria**, because agent workflows (including this repo's) lean on worktrees
  heavily.
- **Tier 2 — at close.** Compare a start/end substrate fingerprint. Status output alone cannot carry this: a tracked file that is already modified at snapshot time and changes *again* mid-run produces an identical `git status --porcelain` string — and re-editing a dirty file is the common case in agent workflows, not the rare one. The fingerprint is therefore content-sensitive: `HEAD`, per-file content digests of the tracked working-tree delta, and an inventory of untracked files (path, size, mtime). This catches persistent tracked-file movement at close; it does not prove no tracked file changed and restored itself during the guarded command.
- **Tier 3 — horizon.** Input-scoped fingerprints: a verdict voids only if files the guarded run actually read shifted. The resolved topo artifact family already verifies content by hash ([ADR-0046][adr-0046]), so the machinery has kin. Deferred until Tiers 1–2 prove insufficient.

Known limits, stated honestly:

- A tracked file can change during the guarded run, be read by a test or build, and then restore to the opening contents before close. Tier 1 as scoped above does not watch tracked working-tree writes, and Tier 2 sees the same closing fingerprint. Closing that gap requires a tracked-file event journal or Tier 3 input-scoped read fingerprints.
- A same-size, mtime-preserving edit to an untracked file evades Tier 2's inventory. That requires deliberate evasion, not an accident — adversarial actors inside your own checkout are out of scope.

The v1 guarantee is therefore narrower: `HEAD` movement, staging, persistent tracked-file movement at close, and ordinary untracked churn are caught. Transient edit-and-restore windows are named false negatives until the watch set or input-scoped machinery expands.

### The error is a briefing, not a complaint

`WorkspaceShiftError` carries a recovery path, not just a refusal:

- What moved: `HEAD abc123 → def456`, or the file delta.
- When: the detection timestamp relative to guard start.
- Who, best-effort: the trailing reflog entries, which usually identify the concurrent operation (`checkout: moving from X to Y`).
- The void semantics, stated plainly: **discard every result from this run, including passes.**
- The instruction: wait for the concurrent operation to finish, then re-run.

No automatic retry. Silent retry would mask the coordination bug the error exists to surface. A `warden guard --retry-on-shift` affordance can be considered later if real usage shows stable-ground waits are common and short.

### Rendering to adopters

One write, many reads:

- **Scaffold.** `trails create` / `add.verify` emit `lefthook.yml` with the guard bracket built in: `trails warden guard start` / `trails warden guard verify` around the hook's commands (or a single `trails warden guard --` wrapper when the hook is exactly one command — the wrapper form guards one command only; see the shell footgun above). Every step inside — warden, `bun test`, custom checks — is protected, replacing the copied-script approach with a built-in.
- **Agent guidance.** Scaffolded `AGENTS.md` gains the operating rule: guarded runs own the checkout for their duration; a shift verdict voids the run — re-run on stable ground.
- **Doctor.** `trails doctor` learns a substrate diagnostic: frequent recent `HEAD` movement suggests concurrent agents sharing a checkout, with the coordination guidance to match.

### The prototype graduates

`scripts/tree-guard.ts` ([PR 733][pr-733]) is fieldwork, not a destination. When the built-in lands, the repo deletes the script and consumes the framework mechanism — per the [script graduation](../../contributing/script-graduation.md) rule, the prototype must not linger as a parallel system.

## Non-goals

- **Preventing concurrency.** Trails does not arbitrate which process may touch a checkout. Coordination between agents is the operator's domain; the framework's job is making violations legible, not impossible.
- **A lock manager.** No advisory locks, no daemon, no checkout ownership protocol. Detection over prevention.
- **Hermetic guarded execution.** Exporting the pushed ref to an isolated snapshot and running checks there is the CI-grade answer, but it drags dependency installation with it. Named as the horizon, deliberately not attempted now.

## Consequences

### Positive

- A verdict invalidated by substrate movement is named, diagnosable, and mechanically distinguishable from a genuine check failure — for humans, scripts, and agents, on every surface.
- Adopters get protection derived from the scaffold without authoring anything or learning the vocabulary first.
- The drift/shift pair gives reviews and incident write-ups precise language for two failure families that were previously conflated.
- Tier 1 converts the worst case — minutes of misleading output — into a millisecond-scale abort with a correct explanation.

### Tradeoffs

- One more category that every surface mapper must handle. This is the cost of the closed-union design, accepted deliberately; the Warden rule that makes it mandatory is the same rule that makes it safe.
- Guarded runs carry a small detection overhead (an fs watcher and two fingerprint captures). Measured against multi-second check suites, this is noise — but it is not zero.
- The bracket is opt-in at the hook level. Adopters who hand-roll hooks without the guard get no shift detection at all — the scaffold and doctor carry the teaching burden for that gap.

### Risks

- **False positives in legitimate workflows.** Tools that touch the index benignly (status refreshers, IDE git integrations) could trip Tier 1. Mitigation: Tier 1 triggers only on `HEAD` and index *content* change, and the v1 rollout watches for noise before tightening defaults.
- **"Shift" overloading.** The word is common English and appears in ordinary prose. Mitigation: the styleguide rule scopes the reserved meaning to substrate movement; API names always carry the context (`WorkspaceShiftError`, not `ShiftError`).

## Non-decisions

- **Whether `guard` enters the module-export grammar.** This ADR establishes `trails warden guard` as a CLI subcommand; whether the concept earns surface area as exported vocabulary (a `guard()` helper, guard-aware execution APIs) is deferred until the bracket proves its shape in the field.
- **Exact Tier 1 watch set.** `HEAD` and the index (resolved per-worktree) are the starting point; packed-refs and ref-storage edge cases get resolved at implementation. Linked-worktree support itself is not deferred — it is day-one acceptance criteria ([see Tiered detection, failing fast](#tiered-detection-failing-fast)).
- **Input-scoped fingerprints (Tier 3).** Deferred until Tier 1–2 false-positive or false-negative rates justify the complexity.
- **`warden guard --retry-on-shift`.** Deferred until usage shows it would help more than it hides.

## References

- [ADR-0000: Core Premise — the information architecture][adr-0000-ia] — shifts are observed information the framework captures mechanically.
- [ADR-0001: Naming Conventions][adr-0001] and [ADR-0023: Simplifying the Trails Lexicon][adr-0023] — the vocabulary record that retired `gate` (renamed to `layer` at Cutover 2) and disqualified its reuse here.
- [ADR-0026: Error Taxonomy as Transport-Independent Behavior Contract][adr-0026] — this ADR extends the behavior contract with the `shift` category row.
- [ADR-0046: Lock v3 Artifact Family][adr-0046] — existing content-hash machinery, kin to Tier 3 input-scoped fingerprints.
- [Tenets](../../tenets.md): "Regressions harden the trail" ([PR #727][pr-727], pending) — the doctrine this ADR applies; the incident is the regression, this is the second repair.
- [PR 733: repo-local tree-guard prototype][pr-733] — the fieldwork this ADR graduates.

[^hermeticity]: Bazel's hermeticity model requires builds to be insensitive to local environment state for exactly this reason: <https://bazel.build/basics/hermeticity>. Nix derivations are content-addressed toward the same goal: <https://nixos.org/guides/how-nix-works/>.

[adr-0000-ia]: ../0000-core-premise.md#the-information-architecture
[adr-0001]: ../0001-naming-conventions.md
[adr-0023]: ../0023-simplifying-the-trails-lexicon.md
[adr-0026]: ../0026-error-taxonomy-as-transport-independent-behavior-contract.md
[adr-0046]: ../0046-lock-v3-artifact-family.md
[pr-727]: https://github.com/outfitter-dev/trails/pull/727
[pr-733]: https://github.com/outfitter-dev/trails/pull/733
