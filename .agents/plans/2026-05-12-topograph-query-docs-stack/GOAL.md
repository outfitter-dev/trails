# Goal Prompt: TopoGraph Query + V1 Closeout Stack

Paste this into the goal runtime:

````markdown
/goal Execute the Trails M4b TopoGraph Query + V1 Closeout stack end to end from cwd `/Users/mg/Developer/outfitter/trails`.

Do not use the Trails skill. It is out of date for the current artifact-family doctrine and has confused earlier runs.

Primary source of truth:
`/Users/mg/Developer/outfitter/trails/.agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md`

Read first:
- `/Users/mg/Developer/outfitter/trails/AGENTS.md`
- `/Users/mg/Developer/outfitter/trails/.agents/plans/PLANNING.md`
- `/Users/mg/Developer/outfitter/trails/.agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md`
- `/Users/mg/Developer/outfitter/trails/.agents/plans/2026-05-12-topograph-query-docs-stack/REFS.md`
- `/Users/mg/Developer/outfitter/trails/docs/adr/0046-lock-v3-artifact-family.md`
- Linear issues `TRL-655`, `TRL-656`, `TRL-657`, `TRL-653`, `TRL-702`, `TRL-692`, `TRL-690`, `TRL-691`, `TRL-693`, `TRL-694`, `TRL-634`, `TRL-636`, `TRL-637`, and parent `TRL-659`

Objective:
Build the entire thirteen-PR M4b TopoGraph + Warden polish + v1 audit closeout stack locally, run local review loops until no P0/P1/P2 findings remain, submit high-quality draft PRs, mark them ready in waves when CI is green, run remote review follow-up, and stop without merging.

Preflight:
1. Verify Stack 1 PRs `#480` through `#487` have merged to `main`.
2. Run `gt sync`.
3. Start from current `main`.
4. Confirm generated `.trails/trails.db*` and `.trails/state/trails.db*` files are not staged and never commit them.
5. If legacy root DB sidecars are untracked, remove only `.trails/trails.db`, `.trails/trails.db-shm`, and `.trails/trails.db-wal`.
6. Verify stale pre-M4b `.trails/dev/` and `.trails/generated/` directories are not lingering. If empty and untracked, remove them; if they contain local data, document before deleting.
7. Start or refresh `/Users/mg/Developer/outfitter/trails/.agents/plans/2026-05-12-topograph-query-docs-stack/RETRO.md` before the first implementation commit.

If Stack 1 has not fully landed, stop and report the exact unmerged PRs instead of building on stale state.

Stack order and exact branch names:
1. `TRL-655` — `trl-655-add-typed-topo-store-views-over-topograph-saved-state`
2. `TRL-656` — `trl-656-make-persisted-surface-rows-complete-or-explicitly-partial`
3. `TRL-657` — `trl-657-add-complete-resolved-contract-detail-view-for-blind-agents`
4. `TRL-653` — `trl-653-sweep-docs-api-references-and-agent-guidance-for-topograph`
5. `TRL-702` — `trl-702-add-retired-vocabulary-guard-for-active-topograph-surfaces`
6. `TRL-692` — `trl-692-clarify-warden-guide-manifest-category-naming-before`
7. `TRL-690` — `trl-690-polish-warden-guidance-link-rendering-and-schema-reuse`
8. `TRL-691` — `trl-691-polish-generated-warden-guide-headers-and-generator-tests`
9. `TRL-693` — `trl-693-tighten-cli-value-alias-conflicts-for-non-commander-callers`
10. `TRL-694` — `trl-694-suppress-static-resource-accessor-warnings-when-string`
11. `TRL-634` — `trl-634-audit-cross-surface-parity-coverage-gaps`
12. `TRL-636` — `trl-636-audit-docs-and-examples-for-v1-readiness`
13. `TRL-637` — `trl-637-audit-release-process-and-beta-to-10-cutover-requirements`

It is okay to create the local branch chain up front. Do not submit or push empty branches. Build 100% of the stack locally before remote submission.

Key scope:
- Implement PRs 1-5 as the M4b TopoGraph query/docs closeout exactly as described in `PLAN.md`.
- Implement PRs 6-10 as Warden/CLI polish without reopening already-merged decisions.
- Implement PRs 11-13 as evidence-backed v1 audits. Write canonical audit reports under `/Users/mg/Developer/outfitter/trails/.agents/plans/2026-05-12-topograph-query-docs-stack/reports/` and file focused Linear follow-up issues for real gaps.
- Use Bun publish language (`bun run publish:check`, `bun run publish:packages`), not npm publish or changeset publish.
- Any PR touching publishable `@ontrails/*` package contents needs a branch-local `.changeset/*.md` entry unless it is explicitly and truthfully `release:none`.
- Do not add the merge queue label.

Local review loop:
- Before submitting remote PRs, run multiple local review rounds with subagents.
- Default to at least three local passes for this stack.
- If the latest pass still finds any P0/P1/P2 issue, fix it and run another pass.
- Stop the local review loop only when the latest pass is P3-only or clean.
- Reviews start from the stack tip so reviewers see the cumulative implementation.
- Reviewers collect evidence, severity, owning branch, and recommended action.
- Subagents may edit files, run checks, and write reports, but must not run any source-control write command.
- Reports should be written under `/Users/mg/Developer/outfitter/trails/.agents/plans/2026-05-12-topograph-query-docs-stack/reports/`.

Owning-branch fix loop:
1. Triage findings into a bottom-up list by lowest owning branch.
2. `gt checkout <owning-branch>`.
3. Run `git branch --show-current` before any `gt modify -c`.
4. Apply the minimal branch-owned fix.
5. Run focused validation for that branch.
6. Commit with `gt modify` using a Conventional Commit message.
7. `gt restack`.
8. Walk upward through affected descendants, resolving conflicts and running targeted checks as needed.

Do not use `gt absorb` for this stack. Do not use `gt modify --into` from another branch. If the tip gate reveals a downstack problem, check out the branch that owns the concept and repair it there.

Post-execution verification:
- After local implementation and before marking the first wave ready, run a doctrine-verification pass distinct from CI and bot review.
- Brief the verifier to check actual code/docs against ADR-0046 and `PLAN.md`: workspace layout, lock/topo artifact shape, lexicon entries, retired vocabulary, generated guide source of truth, and audit methodology.
- Record the report at `/Users/mg/Developer/outfitter/trails/.agents/plans/2026-05-12-topograph-query-docs-stack/reports/post-execution-verification.md`.
- Fix P0/P1/P2 doctrine mismatches before remote ready, even if ordinary tests and review bots are green.

Verification:
Run focused tests per branch as described in `PLAN.md`. At the stack tip run:

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
git diff --check
```

If Warden rule or generated agent-guide content changes, also run:

```bash
bun run warden:agents:sync
bun run warden:skills:sync
bun run warden:agents:check
bun run warden:skills:check
```

PR requirements:
- Use Graphite for branch/stack operations.
- Main agent owns all `git`/`gt` writes, commits, restacks, submits, and PR updates.
- Subagents must not run `git add`, `git commit`, `git push`, `gt create`, `gt modify`, `gt submit`, `gt restack`, or any merge command.
- PR titles use Conventional Commit style.
- PR bodies include context, changes, verification, risks/rollout notes, and `Closes: TRL-...`.
- Do not add the merge queue label.
- Do not merge.

Ready and remote review loop:
- Keep PRs draft until CI is green and local review has no P0/P1/P2 findings.
- Once ready criteria are met, mark PRs ready in waves:
  - Wave 1: PRs 1-5 (M4b closeout).
  - Wave 2: PRs 6-10 (Warden/CLI polish).
  - Wave 3: PRs 11-13 (v1 audits).
- Wait about 15 minutes after each wave is marked ready, then check unresolved review threads and bot comments.
- Resolve all P2 and above feedback from the bottom of the stack upward.
- If one branch needs more than one substantial revision round, keep the rest of the already-verified stack moving where possible instead of letting one late branch stall all remaining review.
- After at most four post-ready remote-review turns, stop and report current status to Matt.

Linear:
- Move issues to In Progress when starting their branches.
- Move issues to In Review when their PRs are marked ready.
- Do not mark issues Done until after merge.
- If implementation diverges from the issue or plan, leave a Linear comment explaining the divergence and why.

Completion condition:
The goal is complete only when all thirteen PRs have been built, locally reviewed until P3-only/clean, submitted with high-quality bodies, marked ready in waves after CI is green, P2+ remote feedback has been resolved or reported after the allowed review turns, the plan `RETRO.md` is current, no merge queue label was added, nothing was merged, and the final transcript reports branch/PR status, checks run, results, skipped checks, remaining P3s/risks, and blocker status.

Stop and ask if:
- Stack 1 PRs `#480` through `#487` are not fully merged to `main`.
- Linear branch names, issue status, or dependencies materially disagree with `PLAN.md`.
- A public API, artifact layout, or doctrinal decision must change beyond this packet.
- Verification fails for unrelated reasons after focused retry.
- Secrets, credentials, production systems, or irreversible actions are needed.
- More than four post-ready remote-review turns have elapsed and P2+ feedback remains unresolved.
````
