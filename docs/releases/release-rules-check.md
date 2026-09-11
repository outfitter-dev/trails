# Release Rules Check

Release rules make branch-local release intent explicit before a PR leaves draft. The check is deliberately narrow today: it evaluates publishable package content and the first public trail contract facts, then asks whether matching rules have positive intent.

## Surfaces

Use the built-in Trails operator surface:

```bash
trails release check --json
```

In this repo, CI and local scripts call the same trail through:

```bash
bun run changeset:check
```

That package script remains named `changeset:check` for compatibility with the existing workflow, but it now runs `bun apps/trails/bin/trails.ts release check`.

The release check is also exposed as the `release.check` trail, so agent-facing surfaces such as MCP can inspect the same report without a parallel script.

Release confidence smokes use the neighboring `release.smoke` trail:

```bash
trails release smoke --check packed-artifacts
trails release smoke --check wayfinder-dogfood
trails release smoke --check all
```

In this repo, `bun run dogfood:packed` and `bun run wayfinder:dogfood` remain package-script wrappers around those trail commands. The Wayfinder smoke is intentionally semantic: it exercises saved operator and demo topo artifacts, resources, signals, errors, relation views, invalid grammar, and artifact provenance around rejected compiles.

## Facts

The current default rules inspect three fact families:

- `package-content`: changed shipping files inside non-private publishable `@ontrails/*` workspaces.
- `public-package-route`: a non-private publishable package present at the base ref but absent now. The release check requires an exact governed Regrade transition. Its single target must be a current publishable package; a classified transition is the explicit non-migratable reason for a truthful multi-owner fold.
- `public-trail-contract`: changed public trail additions/removals, visibility transitions, input schemas, output schemas, or surface exposure.

The public contract detector is intentionally source-static for this first slice. It reports trail id, changed aspect, source path, affected package, and base/current source hashes when available. Future release facts can graduate to Topography or Wayfinder graph diffs once baseline/current artifact handling is settled.

## Rules

`trails.config.ts` owns project policy:

```ts
import { defineConfig } from '@ontrails/config';
import { releaseConfigSchema } from '@ontrails/trails/release';
import { z } from 'zod';

export default defineConfig({
  schema: z.object({
    release: releaseConfigSchema,
  }),
});
```

The default config includes three error rules:

- `package-content-requires-intent`
- `public-package-route-requires-regrade`
- `public-trail-contract-requires-intent`

Rules are project policy, not branch paperwork. A branch satisfies package-content and public-trail-contract rules by carrying positive release intent. A public-package-route fact additionally requires the exact governed route and a branch-local changeset covering its surviving single target or one current classified owner; this keeps a package retirement from degrading into a module-not-found error plus prose. The transition registry is the Regrade owner, while `release.check` owns the before/after package-inventory verdict.

## Intent

A branch-local `.changeset/*.md` entry is the normal intent source. It says the branch changes user-visible package content and should flow into Changesets, package changelogs, and the next version plan.

`release:none` remains a compatibility no-release override. It is a claim, not the primitive. Use it only when the branch touches package files but does not ship user-visible package content, and record the reason in the PR, issue, or handoff. It never bypasses a public-package-route requirement: package retirement is user-visible even when no other package-content fact remains. A branch with both `release:none` and changed changeset files fails.

An active package changeset is also release intent. If a branch adds or modifies `.changeset/*.md` without any matching package-content, public-package-route, generated version release, or public trail contract fact, the check fails. Deleted changesets are ignored for this inverse guard so cleanup branches can remove mistaken release intent without adding package noise.

Generated stable version releases do not need a new changeset after consuming their release intent. Without a prerelease-state change, the check verifies each changed public package version against the base ref: a stable version increase, otherwise unchanged manifest content, and a changed changelog containing the new version heading. Missing base evidence or unrelated package content changes still require branch-local intent. Prerelease version releases retain their existing prerelease-state path.

The check also validates package names in every current Changesets-readable file, including files unchanged by the PR. Every frontmatter package name must exist in the discovered workspace inventory, or name the root package in a repository without workspace configuration; a failure names both the changeset file and the unknown package. This check includes private and unscoped workspace names and cannot be bypassed with `release:none`. README and hidden metadata files are excluded, as they are by Changesets. Retained v1 changeset directories are checked through their `changes.json` release rows, which the pinned Changesets reader still consumes.

Retained prerelease changesets are validated too: Changesets validates workspace package names before it filters consumed prerelease IDs. Valid consumed history stays untouched. When removing or renaming a package, remove its stale frontmatter rows through the existing retirement cleanup; do not hide them behind `.changeset/pre.json`. Deleted changesets have no remaining package references to validate.

When release-check discovery returns no workspaces, changeset-name validation uses the pinned Changesets package reader to distinguish root-only repositories from pnpm, Bolt, and Lerna workspaces and collect their package names. This fallback only supplies names for changeset validation; release-fact discovery is unchanged. Malformed workspace configuration produces a package-inventory validation error instead of a root-package fallback.

## Graphite Stacks

The GitHub workflow validates the PR file list for the current branch. In a Graphite stack, that file list is branch-local because GitHub compares the branch against its immediate base PR or branch. Fix missing release intent on the owning branch, then restack upward. Do not hide lower-branch release gaps with a top-stack cleanup changeset.

To reproduce a hosted failure locally:

```bash
gh api --paginate repos/outfitter-dev/trails/pulls/<pr-number>/files --jq '.[].filename' > /tmp/trails-pr-files.txt
base=$(gh pr view <pr-number> --repo outfitter-dev/trails --json baseRefOid --jq .baseRefOid)
git fetch --no-tags --depth=1 origin "$base"
bun run changeset:check -- --changed-files /tmp/trails-pr-files.txt --base-ref "$base"
```

For ad hoc local branch checks without a PR file list:

```bash
bun run changeset:check
```

That fallback compares `origin/main...HEAD`. It is useful while developing, but the PR file-list path is the branch-local source of truth for stacked branches.

## Release Pack Coherence

`release.check` asks whether a branch has release intent. It does not prove the generated version plan can publish clean packages. The neighboring release-pack guard covers that packaging invariant:

```bash
bun run release-pack:check
```

The guard runs only when the branch is `changeset-release/main` or when changed files include package release metadata: `package.json`, workspace `package.json`, `CHANGELOG.md`, `.changeset/pre.json`, or `bun.lock`. Source-only branches skip the pack check.

This catches the stale lockfile class where Changesets bumps workspace package versions but `bun.lock` still carries older workspace metadata. In that state, `bun pm pack` can resolve `workspace:^` to the previous beta range even though the source `package.json` files are already on the new version. The failure is a release-pack coherence bug, not a general lockfile freshness rule.

`bun run version:packages` runs Changesets, then `bun run release-pack:check -- --lockfile-only --fix-lockfile`, then `bun run plugin:metadata:sync`. Generated release PRs and local release operators therefore use the same deterministic repair path before the PR is updated. The lock repair only rewrites existing `bun.lock.workspaces` version fields that already correspond to source workspace package paths; missing or contradictory lockfile entries still fail the check instead of being invented. Plugin metadata sync derives the skill's framework version from `@ontrails/core` while preserving the independent plugin version.

CI exposes this as the **Release Pack** check on pull requests and runs the full `bun run publish:check` packaging validation. Local pre-push runs `bun run release-pack:check -- --lockfile-only` inside the tree-guard bracket, so human release branches catch stale `bun.lock` workspace metadata before push without running the pack dry-run while the hook is watching the working tree.

## Review Rule

For local reviews, missing branch-local release intent for package content or a public trail contract fact is a P2 release-quality blocker. Identify the owning branch, add the changeset or explicit no-release reason there, restack, and rerun the check upward.

Log broader release ideas, such as imported schema tracing, error-taxonomy facts, permit facts, Warden joins, Wayfinder implications, or release targets, as follow-up P3s unless they expose a concrete user-visible release gap in the current branch.

## Generated Release PR Policy

The generated `changeset-release/main` PR uses a separate publish policy from branch-local `release.check`. Branch-local checks decide whether source PRs carry release facts. The generated release PR policy decides whether the already versioned package state can publish automatically, needs protected manual approval, intentionally publishes nothing, or must block.

Managed release PR labels:

| Family | Labels | Meaning |
| --- | --- | --- |
| Source evidence | `stack:boundary` | Applied to source PRs whose consumed changesets are complete enough for automatic publication. Trusted Graphite merge-queue proof may satisfy the same source-evidence requirement without the label. |
| Publish intent | `publish:auto`, `publish:manual`, `publish:none`, `publish:block` | Select automatic publish, protected manual publish, intentional no-publish, or hard block. |
| Channel intent | `channel:beta`, `channel:stable` | Declares the intended npm dist-tag family. `beta` maps to prerelease beta publication; `stable` maps to `latest`. |
| Release size | `release:patch`, `release:minor`, `release:major` | Declares the semver movement expected on the generated release PR. |

The approved initial `1.0.0` to `0.2.0` source reset is a one-time exception: it requires `channel:stable` and `publish:manual`, with no release-size label because the version decreases. Only the public Trails family's `latest` tag may move from `1.0.0-beta.N` to `0.2.0`; ordinary downgrades and other tag families remain blocked. See [ADR-0047](../adr/0047-stable-release-line-discipline.md#the-initial-version-reset-is-a-single-approved-transition).

`publish:none` is only for generated release PRs. It is distinct from branch-local `release:none` and requires an audit reason in the release PR body or comments because it intentionally leaves generated package-version state unpublished.

The release PR labeler fills missing publish/channel/release labels without overriding human-provided labels:

```bash
bun run publish:label-release-pr
```

After the labeler updates `changeset-release/main`, the Release workflow checks out that generated branch and validates it with `trails release check`, `release-pack:check --lockfile-only`, and `publish:check`. The workflow also dispatches normal CI for the generated branch because pull request workflows created by `GITHUB_TOKEN` updates do not reliably run from the generated PR event; the version job therefore needs `actions: write` permission in addition to content and pull request permissions.

The policy gate emits machine-readable GitHub Actions outputs and chooses `auto`, `manual`, `none`, or `block`:

```bash
bun run publish:policy
```

`publish:auto` is available only for the expected generated release PR shape: `changeset-release/main` into `main`, generated package version and changelog diffs plus the canonical command's modified `bun.lock` and `plugin/skills/trails/SKILL.md` outputs, CI proof green, coherent registry/dist-tag state, no unknown or conflicting managed labels, and source evidence on every source PR that introduced a consumed changeset. The generated-file policy checks exact paths and statuses under the existing bot and PR provenance gates; it does not replace review of file contents. Other plugin files and added or deleted metadata artifacts still require manual review. Source evidence can come from an explicit `stack:boundary` label, or from trusted Graphite merge-queue evidence: the source PR was merged by the Graphite merge queue and the required GitHub Actions checks passed on the source PR merge/head SHA. Missing source PR evidence routes to `publish:manual`; contradictory labels, unknown managed labels, registry contradictions, or `publish:block` block the workflow.

CI proof is gathered only when a generated release PR requests `publish:auto`. Manual, no-label, `publish:none`, and blocked paths do not wait on CI checks before routing to their decision. When auto proof is needed, the policy first reuses the generated release PR head checks if the current release commit and PR head commit resolve to the same Git tree. If that proof cannot be established, it falls back to exact-SHA checks on the current commit. Both paths read the required GitHub Actions checks (`Build`, `Lint & Format`, `Dead Code`, `Typecheck`, `Test`, and `Governance`). Duplicate pending checks do not mask an already-completed success for the same required check, but any completed failure still blocks automation.

The policy log separates three facts:

- **Publish authorization:** whether labels and generated-release evidence permit `auto`, require `manual`, select `none`, or `block`.
- **Package readiness:** whether registry state already matches the generated package version and dist-tag.
- **Publish necessity:** whether npm publication still needs to run after authorization.

`publish:manual` never publishes from the push event that merges the generated release PR. After the generated PR is merged and the Release workflow policy resolves to `manual`, an operator must dispatch the Release workflow from `main` with `publish=true`. Protected npm environment approval may add another gate, but the workflow does not rely on environment protection as the only manual-publish guard.

## Warden And Wayfinder

`trails release check` owns branch-local release-rule evaluation. It reads the GitHub or local changed-file list, release config, Changesets intent, and first source-static public trail contract facts. Warden should not duplicate PR file-list logic or own Graphite and GitHub comparison state.

Current recommendation:

- **No Warden error rule yet.** Release-rule gaps already fail in CI through `release.check`, and Warden does not have the branch-local PR metadata needed to evaluate the same fact without a parallel adapter.
- **Advisory Warden is a later option.** A future advisory rule may report repo-local release hygiene that Warden can answer from source, topo, or owner data alone, such as a missing release config, stale generated release guide output, or package docs that contradict declared release rules. It should cite `release.check` as the rule owner instead of reimplementing the check.
- **Wayfinder is useful evidence now, not a required substrate.** Use `trails wayfind <id> --impact`, `trails wayfind <id>`, and `trails wayfind <id> --contract` during review when a release fact needs graph context. Do not make the first release check depend on Wayfinder artifacts.
- **Rule joins are deferred.** Future `wayfind.implications` can join graph facts with named Warden diagnostics, release-check output, or Distribution-Ready Done checklist facts. That query must cite those sources rather than hand-roll release advice.

## Fixture Coverage

Focused tests avoid compiling a full repo app:

- `apps/trails/src/__tests__/release-contract-facts.test.ts` models public and internal trail source snapshots directly.
- `apps/trails/src/__tests__/release-check.test.ts` keeps package-file coverage and contract-aware rule coverage.
- `apps/trails/src/__tests__/release-check-trail.test.ts` proves the `release.check` trail, `trails release check --json`, config loading, and non-zero failure exit behavior.
- `apps/trails/src/__tests__/release-pack-coherence.test.ts` proves the changed-file predicate that decides when the local/CI release-pack guard runs, plus the local `bun.lock` workspace metadata comparison.

## Lock round-trip isolation

`bun run lock:roundtrip` calls `trails release smoke --check lock-roundtrip`. It discovers committed lock paths, copies current working files into a temporary workspace, and runs the existing compile and validate commands there with a separate cold state home for each lock. The compiled bytes must match the copied input lock exactly. A failure names the command to run in the original checkout to refresh the lock.

The copy includes dirty and untracked source and configuration; it does not check out an older Git revision. Workspace dependency links resolve within the copy, while Bun's installed `.bun` dependency store remains shared. Git metadata, fresh-import mirrors (`.trails-tmp`), Turbo scratch (`.turbo`), agent notes (`.agents/notes`), sibling agent checkouts (`.claude/worktrees`), and unrelated `.tmp-tests` fixtures are excluded so their concurrent cleanup cannot disrupt copying. Tracked files are preserved even inside those disposable paths. An explicitly selected lock fixture is retained, as are compiled `dist` inputs. Missing authored source fails the copy/check rather than being silently skipped. Source symlinks are materialized in the copy; dependency symlinks retain their installed targets. Keep installed dependencies stable during checks.

This isolates generated output, not concurrent input changes. Keep tree-guard around pre-push checks: it detects real edits while files are copied or checks run. A concurrent edit may invalidate the check, but cleanup removes only temporary files and never restores caller lock bytes. The smoke processes locks sequentially and may overlap the guarded checks without generating lock writes in the caller checkout.

The overlap incident came from compile writing live `trails.lock` files followed by unconditional byte restoration. Even writing identical bytes triggers filesystem watchers, so the guard correctly rejected the run although the final Git status was clean. Avoiding the writes fixes that conflict without weakening the guard.

The workspace copier uses explicit byte reads and writes for files. On macOS, the tested Bun `fs.cp` path emitted source watcher events for a 256 KiB file despite unchanged bytes; explicit byte I/O avoids that additional conflict.
