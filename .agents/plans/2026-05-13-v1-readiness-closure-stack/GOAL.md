# Goal: V1 Readiness Closure Stack

Paste this into a fresh goal executor session.

````markdown
/goal Execute the Trails V1 Readiness Closure stack end to end from cwd `/Users/mg/Developer/outfitter/trails`.

Do not use the Trails skill. It is out of date for the current release-readiness and artifact-family doctrine and has confused earlier runs.

Primary source of truth:
`/Users/mg/Developer/outfitter/trails/.agents/plans/2026-05-13-v1-readiness-closure-stack/PLAN.md`

Read first:
- `/Users/mg/Developer/outfitter/trails/AGENTS.md`
- `/Users/mg/Developer/outfitter/trails/.agents/plans/PLANNING.md`
- `/Users/mg/Developer/outfitter/trails/.agents/plans/2026-05-13-v1-readiness-closure-stack/PLAN.md`
- `/Users/mg/Developer/outfitter/trails/.agents/plans/2026-05-13-v1-readiness-closure-stack/REFS.md`
- `/Users/mg/Developer/outfitter/trails/.agents/plans/2026-05-13-v1-readiness-closure-stack/reports/source-m3-parity-audit.md`
- `/Users/mg/Developer/outfitter/trails/.agents/plans/2026-05-13-v1-readiness-closure-stack/reports/source-m5-docs-audit.md`
- `/Users/mg/Developer/outfitter/trails/.agents/plans/2026-05-13-v1-readiness-closure-stack/reports/source-m6-release-process-audit.md`
- Linear issues `TRL-704` through `TRL-714`

Preflight:
1. Run `gt sync`, check out current `main`, and verify `git status --short --branch`.
2. Verify PRs #488 through #500 are merged and their Linear issues are Done.
3. Verify `TRL-704` through `TRL-714` are still open in the expected v1 Release Prep milestones.
4. Verify dependency edges: `TRL-705` is blocked by `TRL-704` and `TRL-706`; `TRL-711` is blocked by `TRL-712`, `TRL-713`, and `TRL-714`; `TRL-707` is related to `TRL-714`.
5. Do not build on stale draft PR #479 or independent draft PR #447.
6. Confirm no generated `.trails` or `.trails-tmp` artifacts are staged.
7. Commit this tracked plan packet and the archived/removal state of the completed `2026-05-12-topograph-query-docs-stack` packet on the lowest execution branch.

Objective:
Build the entire 11-PR V1 readiness closure stack locally, run local review loops until no P0/P1/P2 findings remain, submit high-quality draft PRs, mark them ready when CI is green, resolve remote P2+ feedback bottom-up, and stop without merging.

Stack order and exact branch names:
1. `TRL-713` — `trl-713-repair-stale-changesets-references-before-stable-cutover`
2. `TRL-714` — `trl-714-add-registry-availability-and-dist-tag-release-preflights`
3. `TRL-707` — `trl-707-fix-fresh-start-install-blocker-for-generated-cli-projects`
4. `TRL-712` — `trl-712-author-stable-release-doctrine-adr-for-the-1x-line`
5. `TRL-711` — `trl-711-codify-the-beta-to-10-release-runbook`
6. `TRL-709` — `trl-709-add-markdown-link-integrity-check-for-docs-and-readmes`
7. `TRL-708` — `trl-708-expand-readme-typescript-snippet-verification-beyond-tracing`
8. `TRL-710` — `trl-710-create-public-api-example-coverage-inventory-and-gate`
9. `TRL-704` — `trl-704-add-http-surface-harness-and-include-it-in`
10. `TRL-706` — `trl-706-expose-complete-shipped-surface-projection-inventory-for`
11. `TRL-705` — `trl-705-add-example-driven-climcphttp-parity-runner-and-ci-gate`

It is okay to create the local branch chain up front. Do not submit or push empty branches. Build 100% of the stack locally before remote submission.

Scope:
1. `TRL-713`: repair stale Changesets state so `bunx changeset status --verbose` computes. Preserve intended `@ontrails/logtape` release note. Do not run `bunx changeset version`.
2. `TRL-714`: add registry/package/dist-tag preflight coverage for every non-private `@ontrails/*` workspace. Use read-only registry probes. Keep publish guidance Bun-based.
3. `TRL-707`: fix or precisely gate the generated-project CLI install blocker. First determine whether the fix is code-side or requires real registry publication. Do not publish packages without Matt's explicit confirmation.
4. `TRL-712`: author stable 1.x release doctrine ADR covering lockstep policy, dist-tags, breaking changes, package retirements, generated-app installability, changelogs, publication authority, recovery, and governance.
5. `TRL-711`: codify the beta-to-1.0 runbook using the doctrine and new preflights. Do not run stable cutover/version/publish commands.
6. `TRL-709`: add a code-fence-aware Markdown link integrity checker and fix known broken docs/ADR links.
7. `TRL-708`: expand README TypeScript snippet verification beyond `packages/tracing/README.md`, with source path/line diagnostics and enough coverage to make the v1 gate truthful.
8. `TRL-710`: create a public API `@example` inventory/gate and add high-value examples for v1-facing surface entrypoints.
9. `TRL-704`: add first-party HTTP surface harness to `@ontrails/testing` and include HTTP projection validation in `testAllEstablished()`.
10. `TRL-706`: expose complete shipped-surface projection inventory for blind parity audits without making partial `topo_surfaces` SQL rows canonical.
11. `TRL-705`: add example-driven CLI/MCP/HTTP parity runner and CI gate, starting with `trails-demo`, using normalized Result/TrailsError semantics and explicit exclusions.

Changesets:
- Any PR touching publishable `@ontrails/*` package contents needs a branch-local `.changeset/*.md` entry unless it is explicitly and truthfully `release:none`.
- Publishing guidance must use `bun run publish:check` and `bun run publish:packages`.
- Do not add `npm publish` or `changeset publish` guidance.
- Do not run any real publish command.
- Do not add the merge queue label.

Local review loop:
Before submitting remote PRs, run at least three local review rounds from the stack tip. Suggested lanes: release, fresh-start/docs, parity/testing, source-control/changeset. If the latest pass finds any P0/P1/P2, fix it on the lowest owning branch and run another pass. Stop local review only when the latest pass is P3-only or clean.

Subagents may edit files, run checks, and write reports, but must not run `git add`, `git commit`, `git push`, `gt create`, `gt modify`, `gt submit`, `gt restack`, merge commands, or PR mutation commands. Main agent owns all source-control writes.

Owning-branch fix loop:
1. Triage findings by lowest owning branch.
2. `gt checkout <owning-branch>`.
3. Run `git branch --show-current` before any `gt modify -c`.
4. Apply the minimal branch-owned fix.
5. Run focused validation.
6. Commit with `gt modify` using a Conventional Commit message.
7. `gt restack`.
8. Walk upward through affected descendants with targeted checks.

Do not use `gt absorb` as the normal review-fix workflow. Do not use `gt modify --into` from another branch.

Tip verification:

```bash
bun scripts/adr.ts map
bun scripts/adr.ts check
bun run typecheck
bun run test
bun run lint
bun run lint:ast-grep
bun run build
bun run format:check
bun run check
bun run dead-code
bun run publish:check
git diff --check
```

If Warden/agent generated guidance changes, also run:

```bash
bun run warden:agents:sync
bun run warden:skills:sync
bun run warden:agents:check
bun run warden:skills:check
```

If `TRL-707` reaches a code-side fix, run a fresh-start smoke from a temp directory outside the monorepo:

```bash
tmp=$(mktemp -d /tmp/trails-docs-smoke.XXXXXX)
bun apps/trails/bin/trails.ts create docs-smoke --dir "$tmp" --surfaces cli mcp http --verify --output json
(cd "$tmp/docs-smoke" && bun install && bun run typecheck && bun test)
rm -rf "$tmp"
```

If this smoke requires real package publication, do not publish. Stop and report exact evidence, exact publish command, package list, and smallest human action needed.

Ready and remote review:
- Keep PRs draft until CI and local review are clean.
- Mark ready in waves: Wave 1 `TRL-713/714/707/712/711`, Wave 2 `TRL-709/708/710`, Wave 3 `TRL-704/706/705`.
- Wait about 15 minutes after marking ready, then check unresolved review threads and bot comments.
- Resolve all P2 and above feedback from the bottom of the stack upward.
- After at most four post-ready remote-review turns, stop and report current status to Matt.

Linear:
- Move issues to In Progress when starting their branches.
- Move issues to In Review when PRs are marked ready.
- Do not mark issues Done until after merge.
- If implementation diverges from an issue or plan, leave a Linear comment explaining what changed and why.

Stop rules:
- Stop before any real package publish, package ownership change, token/secret use, or registry mutation.
- Stop if `TRL-707` cannot be fixed without real registry publication.
- Stop if PR #479 or PR #447 turns out to be required for this stack.
- Stop if a public API or stable release doctrine decision needs Matt's judgment beyond the issue/ADR scope.
- Stop after four post-ready remote-review turns if P2+ feedback remains.

Completion condition:
The goal is complete when all 11 planned PRs are built, locally reviewed to P3-only/clean, submitted, CI-clean, marked ready in waves, remote P2+ feedback has been handled bottom-up or explicitly reported, Linear statuses are current, no forbidden publish/merge/merge-queue action occurred, and the final transcript reports branch/PR status, verification results, local review reports, remote review status, remaining P3s/risks, and whether `TRL-707` required human registry publication.

Do not merge.
````
