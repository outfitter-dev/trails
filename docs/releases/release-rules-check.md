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

In this repo, `bun run dogfood:packed` and `bun run wayfinder:dogfood` remain package-script wrappers around those trail commands.

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

## Review Rule

For local reviews, missing branch-local release intent for package content or a public trail contract fact is a P2 release-quality blocker. Identify the owning branch, add the changeset or explicit no-release reason there, restack, and rerun the check upward.

Log broader release ideas, such as imported schema tracing, error-taxonomy facts, permit facts, Warden joins, Wayfinder implications, or release targets, as follow-up P3s unless they expose a concrete user-visible release gap in the current branch.

## Fixture Coverage

Focused tests avoid compiling a full repo app:

- `apps/trails/src/__tests__/release-contract-facts.test.ts` models public and internal trail source snapshots directly.
- `apps/trails/src/__tests__/release-check.test.ts` keeps package-file coverage and contract-aware rule coverage.
- `apps/trails/src/__tests__/release-check-trail.test.ts` proves the `release.check` trail, `trails release check --json`, config loading, and non-zero failure exit behavior.
