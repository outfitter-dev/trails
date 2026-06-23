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

The current default rules inspect two fact families:

- `package-content`: changed shipping files inside non-private publishable `@ontrails/*` workspaces.
- `public-trail-contract`: changed public trail additions/removals, visibility transitions, input schemas, output schemas, or surface exposure.

The public contract detector is intentionally source-static for this first slice. It reports trail id, changed aspect, source path, affected package, and base/current source hashes when available. Future release facts can graduate to Topographer or Wayfinder graph diffs once baseline/current artifact handling is settled.

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

The default config includes two error rules:

- `package-content-requires-intent`
- `public-trail-contract-requires-intent`

Rules are project policy, not branch paperwork. A branch satisfies a matching rule by carrying positive release intent.

## Intent

A branch-local `.changeset/*.md` entry is the normal intent source. It says the branch changes user-visible package content and should flow into Changesets, package changelogs, and the next version plan.

`release:none` remains a compatibility no-release override. It is a claim, not the primitive. Use it only when the branch touches package files but does not ship user-visible package content, and record the reason in the PR, issue, or handoff. A branch with both `release:none` and changed changeset files fails.

An active package changeset is also release intent. If a branch adds or modifies `.changeset/*.md` without any matching package-content, generated version release, or public trail contract fact, the check fails. Deleted changesets are ignored for this inverse guard so cleanup branches can remove mistaken release intent without adding package noise.

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

`bun run version:packages` runs Changesets and then executes `bun run release-pack:check -- --lockfile-only --fix-lockfile`. Generated release PRs and local release operators therefore use the same deterministic repair path before the PR is updated. The fix only rewrites existing `bun.lock.workspaces` version fields that already correspond to source workspace package paths; missing or contradictory lockfile entries still fail the check instead of being invented.

CI exposes this as the **Release Pack** check on pull requests and runs the full `bun run publish:check` packaging validation. Local pre-push runs `bun run release-pack:check -- --lockfile-only` inside the tree-guard bracket, so human release branches catch stale `bun.lock` workspace metadata before push without running the pack dry-run while the hook is watching the working tree.

## Review Rule

For local reviews, missing branch-local release intent for package content or a public trail contract fact is a P2 release-quality blocker. Identify the owning branch, add the changeset or explicit no-release reason there, restack, and rerun the check upward.

Log broader release ideas, such as imported schema tracing, error-taxonomy facts, permit facts, Warden joins, Wayfinder implications, or release targets, as follow-up P3s unless they expose a concrete user-visible release gap in the current branch.

## Generated Release PR Policy

The generated `changeset-release/main` PR uses a separate publish policy from branch-local `release.check`. Branch-local checks decide whether source PRs carry release facts. The generated release PR policy decides whether the already versioned package state can publish automatically, needs protected manual approval, intentionally publishes nothing, or must block.

Managed release PR labels:

| Family | Labels | Meaning |
| --- | --- | --- |
| Source evidence | `stack:boundary` | Applied to source PRs whose consumed changesets are complete enough for automatic publication. |
| Publish intent | `publish:auto`, `publish:manual`, `publish:none`, `publish:block` | Select automatic publish, protected manual publish, intentional no-publish, or hard block. |
| Channel intent | `channel:beta`, `channel:stable` | Declares the intended npm dist-tag family. `beta` maps to prerelease beta publication; `stable` maps to `latest`. |
| Release size | `release:patch`, `release:minor`, `release:major` | Declares the semver movement expected on the generated release PR. |

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

`publish:auto` is available only for the expected generated release PR shape: `changeset-release/main` into `main`, generated-only package version and changelog diffs, exact-SHA CI green, coherent registry/dist-tag state, no unknown or conflicting managed labels, and `stack:boundary` on every source PR that introduced a consumed changeset. Missing source PR evidence or missing `stack:boundary` routes to `publish:manual`; contradictory labels, unknown managed labels, registry contradictions, or `publish:block` block the workflow.

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
