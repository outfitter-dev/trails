# Release Disposition Check

This note records the first substrate audit for release provenance. It is scoped to the current branch-local release disposition check and the first enforceable wedge from the release provenance ADR draft: public trail contract movement needs a release disposition before a PR leaves draft.

## Substrate Survey

### Existing release check

`scripts/check-release-disposition.ts` owns the release-disposition check for package-affecting PRs. It receives changed-file metadata, discovers non-private publishable `@ontrails/*` workspaces, ignores non-shipping paths such as tests and build artifacts, parses changed `.changeset/*.md` files, and lets `release:none` bypass package coverage only when no changeset files are present and the PR body carries a reason.

The CI job in `.github/workflows/ci.yml` collects the GitHub PR file metadata for the current PR and passes it into `bun run release:disposition:check`. In a Graphite stack, that PR file metadata is branch-local because GitHub compares the branch against its immediate base PR/branch. That shape is exactly what release provenance needs: the owning branch must carry its own disposition.

### Topographer diff helpers

`packages/topographer/src/diff.ts` already performs semantic topo graph diffing. It can classify input field additions/removals, output field changes, surface changes, resource/compose changes, permit changes, and version-entry movement. That is the right long-term substrate for high-fidelity release facts because it operates over resolved contract data rather than source text.

The first CI wedge should not depend on materializing two full topo graphs for every PR. Doing that safely would need a baseline app selection story, write permits for temporary artifacts, stale artifact handling, and clear behavior when a PR changes loader or compile behavior. Those are valuable future release facts, but too broad for the branch-local check upgrade.

### Saved topo artifacts and topo-store types

Topographer already persists snapshots and graph detail through `packages/topographer/src/internal/topo-store.ts`, `packages/topographer/src/internal/topo-store-read.ts`, `packages/topographer/src/topo-store.ts`, and `packages/topographer/src/types.ts`. These paths carry trail contracts, surfaces, facets, resources, signals, examples, and versions.

Saved artifacts are the correct evidence shape for release packets and future Wayfinder-backed review. They are not the cheapest first check substrate because the existing release disposition job only has PR file metadata and should not write repo artifacts while deciding whether a changeset is required.

### Wayfinder diff and impact queries

`packages/wayfinder/src/queries.ts` exposes `wayfind.diff`, `wayfind.contract`, `wayfind.impact`, typed list queries, and artifact freshness envelopes. This is the right agent-facing read layer once baseline and current topo artifacts are available. It should become the release-review surface for richer questions such as "what downstream surfaces or examples does this contract change touch?".

The first check can point future agents toward Wayfinder without making CI depend on fresh saved artifacts for every PR.

### Graphite base helpers and branch locality

The existing check uses GitHub PR file metadata in CI and `origin/main...HEAD` for local ad hoc runs without `--changed-files`. The CI path is the important one for branch locality. Local reproduction should pass explicit PR file metadata and the immediate PR base:

```bash
base=$(gh pr view <pr-number> --repo outfitter-dev/trails --json baseRefOid --jq .baseRefOid)
git fetch --no-tags --depth=1 origin "$base"
bun run release:disposition:check -- --changed-files /tmp/pr-files.txt --base-ref "$base"
```

`--base-ref` lets the source-static detector read before/after trail source with `git show` while keeping the branch-local PR file metadata as the source of truth. Rename metadata lets pure source moves compare the previous file's base content with the new file's current content instead of reporting a false public trail removal/addition. Focused tests still pass before/after source snapshots directly into the detector so the contract fact behavior stays deterministic without a full repo app compile.

## Chosen First Slice

The first implementation uses a source-static contract fact detector adjacent to the existing release disposition check.

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

`release:none` remains the explicit no-release disposition. It is valid only when the branch has no changed changeset files and the PR body includes a reason that mentions `release:none`. Reviewers should treat a contract-affecting branch with `release:none` as a claim that the contract fact is not user-visible and should look for a concrete reason in the PR. If the original reason lives in an issue or handoff, mirror the sentence into the PR body so CI and reviewers see the same evidence.

## Review Rule

For local reviews, a missing release disposition for a public trail contract fact is a P2. It can block downstream release quality even when code, tests, and package-file checks are green.

Use this checklist when reviewing a stack:

1. Identify the owning branch for each public contract fact. In Graphite, that is the lowest branch whose PR file list contains the source change.
2. Check that the owning branch carries a matching changeset for the affected package, or an explicit `release:none` reason that explains why the fact is not user-visible.
3. Treat `release:none` without a reason as incomplete. It is a disposition label without the authored disposition.
4. Do not paper over a lower branch's missing reason in a top-stack cleanup branch. Fix the owning branch, restack, then re-run the check upward.
5. If the review finds release ideas outside slice one, such as imported schema tracing, error-taxonomy facts, permit facts, or release targets, log them as follow-up P3s unless they create a concrete user-visible release gap in the current branch.

## Local Reproduction

The release disposition job validates the branch-local PR file metadata. To reproduce a hosted failure locally, save the PR file metadata and pass the branch base explicitly:

```bash
gh api --paginate repos/outfitter-dev/trails/pulls/<pr-number>/files \
  --jq '.[] | {filename, status, previousFilename: .previous_filename} | @json' \
  > /tmp/trails-pr-files.txt
base=$(gh pr view <pr-number> --repo outfitter-dev/trails --json baseRefOid --jq .baseRefOid)
git fetch --no-tags --depth=1 origin "$base"
bun run release:disposition:check -- --changed-files /tmp/trails-pr-files.txt --base-ref "$base"
```

For ad hoc local branch checks without a PR file list, the script keeps the existing fallback and compares `origin/main...HEAD`:

```bash
bun run release:disposition:check
```

That fallback is useful while developing, but the PR metadata path is the branch-local source of truth for stacked Graphite branches. The legacy `bun run changeset:check` command remains as a compatibility alias. If a missing disposition appears on a stacked PR, fix the changeset or `release:none` rationale on the owning branch, restack, and rerun the check upward.

## Fixture Coverage

The focused tests avoid compiling a full repo app:

- `scripts/__tests__/contract-release-facts.test.ts` models public and internal trail source snapshots directly. It proves public input schema changes, public output schema changes, surface exposure changes, public trail addition/removal, visibility transitions, same-file schema constant changes, internal-only trail changes, non-contract source edits, and pure source renames with GitHub `previousFilename` metadata.
- `scripts/__tests__/check-release-disposition.test.ts` keeps the existing package-file check coverage and adds contract-aware check coverage. It proves uncovered public contract facts fail with trail id and aspect evidence, matching changesets pass, `release:none` remains an explicit disposition path with required rationale, and the check can derive public contract facts from a changed package source file.

The fixtures intentionally do not cover imported schema tracing or full before/after topo graph materialization. Those are future Topographer or Wayfinder release facts, not requirements for the first branch-local CI check.
