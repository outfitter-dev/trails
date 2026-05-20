# Goal Prompt: Trail Versioning M1 + M2 Stack

Paste this into a fresh goal executor session:

````markdown
/goal Execute the Trails Trail Versioning M1 + M2 stack end to end from cwd `/Users/mg/Developer/outfitter/trails`.

Do not use the Trails skill. The active versioning doctrine is newer than the published skill guidance and the skill has confused earlier goal runs.

Primary source of truth:
`/Users/mg/Developer/outfitter/trails/.agents/plans/2026-05-19-trail-versioning-m1-m2/PLAN.md`

Read first:
- `/Users/mg/Developer/outfitter/trails/AGENTS.md`
- `/Users/mg/Developer/outfitter/trails/.agents/plans/PLANNING.md`
- `/Users/mg/Developer/outfitter/trails/.agents/plans/2026-05-19-trail-versioning-m1-m2/PLAN.md`
- `/Users/mg/Developer/outfitter/trails/.agents/plans/2026-05-19-trail-versioning-m1-m2/REFS.md`
- Linear project `Trail Versioning`
- Linear issues `TRL-728`, `TRL-729`, `TRL-113`, `TRL-114`, `TRL-739`, `TRL-115`, and `TRL-116`

Preflight:
1. Run `gt sync`, check out current `main`, and verify `git status --short --branch`.
2. Confirm Linear dependency links match the packet.
3. Confirm PR #531 / branch `trl-738-add-codex-clark-agent-wiring` is unrelated and not required as a base.
4. Confirm the completed HTTP/Bun observability packet can either stay as historical tracked context or be moved to `.agents/plans/archive/` on the lowest branch if still tracked and complete.
5. Commit this tracked plan packet on the lowest execution branch.

Objective:
Build the seven-PR M1 + M2 Trail Versioning stack locally. Promote v3 doctrine into ADR-0048, supersede ADR-0044, settle the top-level CLI namespace, implement the core `version` / `versions` authoring model, add pure `transpose:` revisions, compute projected content-addressed markers, resolve trail versions at runtime, and run examples/`testAll` across live version entries. Run local review loops until no P0/P1/P2 findings remain, submit high-quality draft PRs, mark ready only after CI/local review are clean, resolve remote P2+ feedback bottom-up, and stop without merging or publishing.

Stack order and exact branch names:
1. `TRL-728` — `trl-728-docsadr-supersede-adr-0044-with-trail-versioning-v3-doctrine`
2. `TRL-729` — `trl-729-feattrails-settle-top-level-cli-namespace-before-versioning`
3. `TRL-113` — `trl-113-define-trail-version-versions-authoring-shape`
4. `TRL-114` — `trl-114-add-pure-transpose-transforms-for-revision-entries`
5. `TRL-739` — `trl-739-featcore-compute-content-addressed-version-markers`
6. `TRL-115` — `trl-115-resolve-trail-versions-during-execution`
7. `TRL-116` — `trl-116-run-examples-and-testall-across-live-version-entries`

It is okay to create the complete local branch chain up front, but do not submit or push empty branches. Build 100% of the stack locally before remote submission.

Core doctrine:
- Trail versioning is trail-only for 1.0.
- Authoring uses top-level `version: N` plus sibling `versions: { N: {...} }`.
- Current contract stays top-level: `input`, `output`, and `blaze` always mean current.
- Historical entries require explicit `input` and `output`; there is no inheritance from current.
- Revision entries use pure `transpose: { input, output }` transforms.
- Fork entries use `blaze:` and may own `crosses`, `resources`, and `detours`.
- Source has no `kind:` field; the resolved graph projects `kind: 'revision' | 'fork'`.
- `marker:` is projected, not authored. Store a 16-character SHA-256 prefix; display shortest unambiguous prefixes with minimum length 4.
- `status` lifecycle and graph-only `forces:` are acknowledged but implemented in M3, not this stack, except where M2 types must leave room for them.
- Preserve PR #530 blaze grammar: a `blaze` establishes how a trail runs; the runtime runs blazed trails; surfaces do not call blazes directly.

Per-PR scope:
- `TRL-728`: author ADR-0048, supersede ADR-0044, update ADR map/index, add ADR-0016 forward pointer, update lexicon/language-styleguide guidance, and preserve post-PR #530 blaze language.
- `TRL-729`: promote `trails topo compile` to `trails compile`, add `trails validate`, retire `trails topo verify`, and remove current-facing old versioning commands.
- `TRL-113`: add `version` / `versions` trail-spec shape, version-entry types, unversioned zero-cost behavior, TopoGraph projection, and no `.v*.ts` discovery.
- `TRL-114`: implement pure `transpose:` revision transforms with no ctx/resources/crosses/surface state.
- `TRL-739`: compute projected content-addressed markers, canonicalize resolved contracts, support unambiguous marker-prefix references, and reject authored markers.
- `TRL-115`: resolve current/revision/fork/deprecated/archived/missing/marker-requested versions at runtime and keep `ctx.cross()` current by default.
- `TRL-116`: make examples and `testAll` version-aware across current plus live historical entries.

Changesets and publishing:
- Any PR touching publishable `@ontrails/*` package contents needs a branch-local `.changeset/*.md` entry unless it is truthfully release-neutral.
- Publishing guidance must use `bun run publish:check` and `bun run publish:packages`.
- Do not add `npm publish` or `changeset publish` guidance.
- Do not run any real publish command or registry mutation.
- Use `bun run publish:check` as a required stack gate.
- Do not add the merge queue label.

Local review loop:
Before submitting remote PRs, run at least three local review rounds from the stack tip. Suggested lanes: ADR/doctrine/lexicon/blaze language, CLI namespace/stale-command sweep, core type/TopoGraph authoring shape, transpose/runtime/marker correctness, and testing/examples/public API/changesets. Write reports under `.agents/plans/2026-05-19-trail-versioning-m1-m2/reports/`. If the latest pass finds any P0/P1/P2, fix it on the lowest owning branch and run another pass. Stop local review only when the latest pass is P3-only or clean.

Subagents may edit files, run checks, and write reports, but must not run `git add`, `git commit`, `git push`, `gt create`, `gt modify`, `gt submit`, `gt restack`, merge commands, or PR mutation commands. Main agent owns all source-control writes.

Owning-branch fix loop:
1. Triage findings by lowest owning branch.
2. `gt checkout <owning-branch>`.
3. Run `git branch --show-current` before any `gt modify`.
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
bun run publish:check
git diff --check
```

If Warden or generated agent guidance changes, also run:

```bash
bun run warden:agents:sync
bun run warden:skills:sync
bun run warden:agents:check
bun run warden:skills:check
```

Ready and remote review:
- Keep PRs draft until CI and local review are clean.
- Submit high-quality PR bodies with context, changes, verification, risks/rollout notes, and Linear links.
- Mark ready only when CI and local review are clean.
- Wait about 15 minutes after marking ready, then check unresolved review threads and bot comments.
- Resolve all P2 and above feedback from the bottom of the stack upward.
- Treat review-bot errors as blockers until rerun or explicitly explained.
- After at most four post-ready remote-review turns, stop and report current status.

Linear:
- Move issues to In Progress when starting their branches.
- Move issues to In Review when PRs are marked ready.
- Do not mark issues Done until after merge.
- If implementation diverges from an issue or plan, leave a Linear comment explaining what changed and why.
- Record out-of-goal discoveries in `RETRO.md` and create focused Linear follow-up issues when the discovery is real.

Retro discipline:
Maintain `/Users/mg/Developer/outfitter/trails/.agents/plans/2026-05-19-trail-versioning-m1-m2/RETRO.md` as the durable execution ledger. For a stack, touch it last before local completion, draft submission, ready-for-review, remote review closeout, merge readiness, archive, or final handoff. Any meaningful local or remote review change must be reflected in `RETRO.md` before claiming that review loop is complete. Do not claim the goal complete until `RETRO.md` has final tracker, PR, review, verification, forbidden-action, remaining-risk, and archive-readiness state, or explicitly explains why that is blocked.

Stop rules:
- Stop if ADR-0048 needs to change a doctrine choice in the plan rather than just refine wording.
- Stop if runtime resolution requires implementing M3 lifecycle/surface/gate work early.
- Stop if marker canonicalization requires unsupported Zod semantics that should be deferred to M3's bounded-Zod rule.
- Stop if CLI namespace work would require aliases or a compatibility period.
- Stop if PR #531 or another open branch becomes a required base.
- Stop if verification fails for unrelated reasons after a focused retry.
- Stop if a public API, artifact layout, or doctrine decision needs Matt's judgment beyond the issue/ADR scope.
- Stop before any real package publish, package ownership change, token/secret use, registry mutation, merge, or merge queue label.
- Stop after four post-ready remote-review turns if P2+ feedback remains.

Completion condition:
The goal is complete when all seven planned PRs are built, locally reviewed to P3-only/clean, submitted, CI-clean, marked ready, remote P2+ feedback has been handled bottom-up or explicitly reported after the turn limit, Linear statuses are current, package publish readiness is proven by Bun-based checks without any real publish, no forbidden merge/publish/merge-queue action occurred, and the final transcript reports branch/PR status, verification results, local review reports, remote review status, remaining P3s/risks, skipped checks, blocker status, and the finalized `RETRO.md` state.

Do not merge.
````
