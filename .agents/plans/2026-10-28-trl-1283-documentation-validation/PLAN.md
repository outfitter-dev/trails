---
description: Implement the first documentation validation slice with owner-composed commands and committed path migration accounting while keeping remaining foundation gates open.
linear: [TRL-1283]
---

# Documentation validation first slice

## Outcome and authority

The coordinator authorized Lane F to implement repository-owned TRL-1283 foundations using accepted local architecture commit `206dfef144aec70efb5925868cc9cf368ca1a19c` as a usable dependency. This packet's horizon is a locally verified and independently reviewed first slice, then normal-hook commit and operator-serialized delivery as a draft PR. It does not represent complete TRL-1283 acceptance.

The current worktree is `/Users/mg/.codex/worktrees/trl-1283-docs-validation/trails`, on `trl-1283-establish-documentation-validation-and-migration-accounting`, based on the architecture commit above. Physical ancestry preserves that dependency; stack registration, restacking and full pushes wait for the campaign operator. Reviewers have read-only source authority. F984 and F1281 delivery refs remain frozen. Tracker status and landing belong to the coordinator/operator.

## Source boundary

Allowed files are `scripts/docs.ts`, `scripts/docs/{git,migrations}.ts`, their focused migration and executable CI fixture tests, documentation command keys in `package.json`, documentation steps in `.github/workflows/ci.yml`, the contributor guide and its index link, and this four-file packet. The four canonical ADR artifacts may change only through their existing owner when derived inbound facts require it. No runtime/package API, root dependency, Bun lock, Skillset source/projection or external repository changes are authorized here.

## Written acceptance for this slice

1. `docs:generate` calls existing error-taxonomy, root Warden-guide and canonical ADR owners. It derives no framework contract facts. Repeated generation is byte-identical and preserves authored regions.
2. `docs:check -- --base-ref <ref>` checks a committed candidate before running existing documentation owner checks. Base, merge base and head are resolved and reported; missing refs/history fail closed without an implicit fetch or fallback. Relevant dirty/untracked inputs fail explicitly.
3. Git history preserves filenames and old rename paths. Removed regular public Markdown sources require an authored normalized migration entry. Regular-to-symlink replacement also counts as removal. Fixed root README and docs index cannot be removed through an entry.
4. Entries distinguish moved, split, merged, archived and deleted intent. Surviving destinations must be regular public sources in the same bounded population; deletion needs a reason. Duplicate source records, invalid shapes and stale destinations fail. New entries require an actual removal, including intermediate paths retired within the comparison history. Prior source entries remain cumulative. Workspace README ownership is read at both committed comparison trees, so deleting a workspace or its declaration cannot hide its former README; dirty nested workspace manifests also fail.
5. CI explicitly fetches/pins canonical main for PR, merge-group and manual runs. Main pushes compare the event's previous head. Local immediate-layer comparisons are diagnostics only. Real stacked Git fixtures demonstrate why missing lower-layer accounting fails against main even when a focused comparison passes.
6. The guide states current scan scopes and all unfinished controls. The issue remains open until those controls and integration evidence exist. Existing Changeset base selection is unchanged.
7. Focused fixtures, formatting/lint, scoped typecheck, guide checks, canonical generation and independent local review pass. Full aggregate/push gates run only in the operator's named quiet slot; hosted checks and current integration proof remain delivery gates.

## Population and open acceptance

This slice accounts for root README, Markdown/MDX under docs outside ADR lifecycle ownership, and direct READMEs of manifest-declared workspaces. Historical release names are not a blanket exclusion. This bounded migration population does not claim to classify the future public evergreen graph.

Remaining TRL-1283 work includes independent public population discovery, `## Pages` ownership/reachability, cycles/orphans/duplicates, description/page contracts, general generated-marker integrity, terminology/projection coverage, anchor migration and a measured shrink-only baseline that cannot absorb changed/new pages. No broad moves or corpus rewrite are authorized by this slice. TRL-1282 upstream skill mutation remains outside this repository lease.

## Script graduation and distribution

History and authored repository documentation migration intent are repo facts, so the small Git/accounting modules stay in root tooling under Script Graduation Q1. The CLI is a thin caller of existing owners for durable error, Warden and ADR facts. It does not parse trails, derive topos or create an alternate fact owner. Review must recheck this boundary.

Release intent is `release:none`: contributor tooling/CI only, with no publishable package changes. Changeset, package publication checks, Wayfinder smoke and lock round-trip are not applicable to this source scope. Generator no-op proof and normal hooks remain required. No merge, archive, publication, deployment, positioning decision or tracker mutation is included.
