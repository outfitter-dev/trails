# Goal Prompt: trail-versioning-m3-closeout

Paste this into the goal runtime:

````markdown
/goal Execute the Trail Versioning M3 closeout stack end to end from cwd `/Users/mg/Developer/outfitter/trails`.

Primary source of truth:
`/Users/mg/Developer/outfitter/trails/.agents/plans/2026-05-20-trail-versioning-m3-closeout/PLAN.md`

Read first:
- `AGENTS.md`
- `.agents/plans/PLANNING.md`
- `.agents/plans/2026-05-20-trail-versioning-m3-closeout/PLAN.md`
- `.agents/plans/2026-05-20-trail-versioning-m3-closeout/REFS.md`
- `.agents/plans/2026-05-20-trail-versioning-m3-closeout/RETRO.md`
- `docs/adr/0048-trail-versioning-v3.md`
- `docs/adr/0044-trail-versioning.md`
- Linear project `Trail Versioning`
- Linear issues TRL-740, TRL-117, TRL-731, TRL-732, TRL-730, TRL-118, TRL-119, TRL-120

Important tool constraint:
Do not use the local Trails skill for this goal. It is out of date for current trail-versioning doctrine and confused earlier runs. Use the repo files, ADR-0048, Linear, and this plan packet instead.

Objective:
Build, locally review, submit, mark ready, and remote-review the eight-branch Graphite stack that closes Trail Versioning M3, with TRL-740 at the bottom as cleanup-first public/internal API polish and TRL-120 at the top as the Warden capstone.

Branch order, bottom to top:
1. TRL-740 — `trl-740-chorecore-tighten-trail-versioning-publicinternal-api`
2. TRL-117 — `trl-117-add-status-deprecation-metadata-and-surface-signals`
3. TRL-731 — `trl-731-featcore-add-archive-status-lifecycle-for-version-entries`
4. TRL-732 — `trl-732-feattrails-add-compilevalidate-break-detection-and-force`
5. TRL-730 — `trl-730-feattrails-add-version-and-marker-aware-trails-diff`
6. TRL-118 — `trl-118-project-version-negotiation-across-http-mcp-cli-and`
7. TRL-119 — `trl-119-add-cli-lifecycle-commands-revise-deprecate-and-doctor`
8. TRL-120 — `trl-120-add-warden-rules-for-trail-version-entries-and-markers`

Scope:
- TRL-740: tighten M1/M2 public/internal API cleanup before adding M3.
- TRL-117: deprecation `status` metadata and surface signals.
- TRL-731: archive `status` lifecycle semantics.
- TRL-732: shared break classifier and graph-only `forces:` audit events.
- TRL-730: version- and marker-aware `trails diff`.
- TRL-118: `(trail, version)` negotiation across HTTP, MCP, CLI, and WebSocket.
- TRL-119: `trails revise`, `trails deprecate`, and `trails doctor`.
- TRL-120: Warden rules for version entries, markers, lifecycle, and force events.

Source-control rules:
- Use Graphite for branch and stack operations.
- It is fine to create the local branch chain up front, but do not submit or push empty branches.
- This plan packet has already landed on `main` via PR #539. Do not duplicate it. Commit future `RETRO.md` or report updates on the relevant execution branch as part of normal stack work.
- Main agent owns all `git` and `gt` writes.
- Subagents may edit files, run checks, and write review reports, but must not run `git add`, `git commit`, `git push`, `gt create`, `gt modify`, `gt restack`, `gt submit`, merge commands, or PR mutation commands.
- Do not use `gt absorb`.
- Do not add a merge queue label.
- Do not merge.

Package/release rules:
- Add branch-local changesets for publishable package-content changes unless a PR is truly `release:none`.
- Do not publish packages.
- Do not mutate npm or any package registry.
- Use Trails' Bun-based publish checks only: `bun run publish:check`; do not introduce `npm publish` or `changeset publish` guidance.

Local review:
Before remote submission, run at least three substantive local review passes from the stack tip:
- Lifecycle/surfaces: deprecation, archive, negotiation, archived exclusion, error mapping.
- Diff/gates/Warden: break classifier, force events, diff semantics, Warden rule correctness.
- Docs/CLI/changesets/public API: command grammar, generated guidance, changesets, publish dry-run, public exports.

Write review reports under:
`.agents/plans/2026-05-20-trail-versioning-m3-closeout/reports/`

Fix every P0/P1/P2 finding bottom-up before submitting or marking ready. Continue local review until the latest pass is clean or P3-only.

Remote review:
Submit draft PRs with high-quality descriptions only after local review and local gates are clean. Mark ready only after CI, PR descriptions, and local review are clean. Wait about 15 minutes after marking ready, then check CI, review bot status, unresolved review threads, and PR mergeability. Resolve all P0/P1/P2 feedback bottom-up for a maximum of four post-ready turns. Treat review-bot errors as blockers until rerun or explicitly explained. Do not merge; report status when remote review is P3-only/clean or the four-turn cap is hit.

Verification:
At minimum, surface transcript-visible summaries for:
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

If Warden manifests or generated guidance changed, also run:
```bash
bun run warden:agents:sync
bun run warden:skills:sync
bun run warden:agents:check
bun run warden:skills:check
```

Completion condition:
The goal is complete only when the eight PRs exist in the stated stack order, all in-scope implementation is done, Linear is current, local review is clean or P3-only after at least three passes, PRs are marked ready with high-quality bodies, remote review/CI has no unresolved P0/P1/P2 findings or bot errors, the verification commands above have passed or are explicitly explained if skipped, no publish/registry mutation/merge/merge queue label/`gt absorb` happened, and the final transcript reports branch/PR state, changed artifacts, commands/results, skipped checks, remaining P3s/risks, tracker state, and finalized `RETRO.md` state.

Retro discipline:
Maintain `/Users/mg/Developer/outfitter/trails/.agents/plans/2026-05-20-trail-versioning-m3-closeout/RETRO.md` as the durable execution ledger. For this stack, touch it last before local completion, draft submission, ready-for-review, remote review closeout, merge readiness, archive, or final handoff. Any meaningful local or remote review change must be reflected in `RETRO.md` before claiming that review loop is complete. Do not claim the goal complete until `RETRO.md` has final tracker, PR, review, verification, forbidden-action, remaining-risk, and archive-readiness state, or explicitly explains why that is blocked.

Stop and ask if:
- The plan appears stale against `main`, Linear, or open PR state.
- A public API, artifact layout, or doctrine decision needs to change beyond ADR-0048 and this packet.
- The work requires publish, registry mutation, merge, production credentials, secrets, or other irreversible actions.
- Verification fails for unrelated reasons after a focused retry.
- A review thread or CI result reveals P0/P1/P2 scope that cannot be fixed bottom-up within this stack.
- More than four post-ready remote-review turns have elapsed and P2+ feedback remains unresolved.
````
