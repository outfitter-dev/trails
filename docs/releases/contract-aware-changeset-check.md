# Contract-Aware Changeset Check

This note records the first substrate audit for release provenance. It is scoped to the current branch-local Changeset check and the first enforceable wedge from the release provenance ADR draft: public trail contract movement needs a release disposition before a PR leaves draft.

## Substrate Survey

### Existing Changeset check

`scripts/check-changeset-gate.ts` already owns the release-disposition check for package-affecting PRs. It receives a changed-file list, discovers non-private publishable `@ontrails/*` workspaces, ignores non-shipping paths such as tests and build artifacts, parses changed `.changeset/*.md` files, and lets `release:none` bypass package coverage only when no changeset files are present.

The CI job in `.github/workflows/ci.yml` collects the GitHub PR file list for the current PR and passes it into `bun run changeset:check`. In a Graphite stack, that PR file list is branch-local because GitHub compares the branch against its immediate base PR/branch. That shape is exactly what release provenance needs: the owning branch must carry its own disposition.

### Topographer diff helpers

`packages/topographer/src/diff.ts` already performs semantic topo graph diffing. It can classify input field additions/removals, output field changes, surface changes, resource/compose changes, permit changes, and version-entry movement. That is the right long-term substrate for high-fidelity release facts because it operates over resolved contract data rather than source text.

The first CI wedge should not depend on materializing two full topo graphs for every PR. Doing that safely would need a baseline app selection story, write permits for temporary artifacts, stale artifact handling, and clear behavior when a PR changes loader or compile behavior. Those are valuable future release facts, but too broad for the branch-local check upgrade.

### Saved topo artifacts and topo-store types

Topographer already persists snapshots and graph detail through `packages/topographer/src/internal/topo-store.ts`, `packages/topographer/src/internal/topo-store-read.ts`, `packages/topographer/src/topo-store.ts`, and `packages/topographer/src/types.ts`. These paths carry trail contracts, surfaces, facets, resources, signals, examples, and versions.

Saved artifacts are the correct evidence shape for release packets and future Wayfinder-backed review. They are not the cheapest first check substrate because the existing Changeset job only has a PR file list and should not write repo artifacts while deciding whether a changeset is required.

### Wayfinder diff and impact queries

`packages/wayfinder/src/queries.ts` exposes `wayfind.diff`, `wayfind.contract`, `wayfind.impact`, typed list queries, and artifact freshness envelopes. This is the right agent-facing read layer once baseline and current topo artifacts are available. It should become the release-review surface for richer questions such as "what downstream surfaces or examples does this contract change touch?".

The first check can point future agents toward Wayfinder without making CI depend on fresh saved artifacts for every PR.

### Graphite base helpers and branch locality

The existing check uses the GitHub PR file list in CI and `origin/main...HEAD` for local ad hoc runs without `--changed-files`. The CI path is the important one for branch locality. Local reproduction should keep accepting an explicit PR file list:

```bash
bun run changeset:check -- --changed-files /tmp/pr-files.txt
```

Future local helpers may add a `--base-ref` option for source snapshots. The first implementation can remain deterministic in tests by passing before/after source content directly into a helper, then use best-effort `git show` only for CLI evidence enrichment when a base ref is available.

## Chosen First Slice

The first implementation uses a source-static contract fact detector adjacent to the existing Changeset check.

Slice-one public trail contract movement means a changed TypeScript source file contains a trail definition that is not explicitly `visibility: 'internal'` on both sides of the branch-local diff, and the branch changes at least one of these contract-bearing aspects:

- public trail addition or removal;
- `visibility` movement between internal and public;
- `input` schema text;
- `output` schema text;
- `surfaces` declaration text.

The detector should report evidence with:

- trail id;
- changed aspect;
- source path;
- affected publishable workspace package when the source file lives under one;
- base/current source hash or snapshot hint when available;
- changed PR files that caused the fact to be considered.

This is intentionally lower fidelity than a Topographer diff. It catches the highest-value release gap using the CI shape the repo already trusts, while preserving room for graph-diff release facts later.

## Explicit Boundaries

Out of scope for this first check:

- examples-only movement;
- internal-only trails;
- stack-cumulative release plans;
- release-target taxonomy;
- generated changelog prose;
- inferred error-taxonomy, permit, resource, or signal release facts;
- requiring a graph compile during the Changeset job.

## `release:none`

`release:none` remains the explicit no-release disposition. It is valid only when the branch has no changed changeset files. Reviewers should treat a contract-affecting branch with `release:none` as a claim that the contract fact is not user-visible and should look for a reason in the PR, issue, or handoff.

## Review Rule

For local reviews, a missing release disposition for a public trail contract fact is a P2. It can block downstream release quality even when code, tests, and package-file checks are green.
