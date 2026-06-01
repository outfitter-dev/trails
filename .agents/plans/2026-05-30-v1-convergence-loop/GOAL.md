# Pasteable Goal

Build and submit a large Trails v1 convergence Graphite stack from the linked
worktree at `/Users/mg/.config/codex/worktrees/trails-v1-convergence`.

Use `lewis/v1-convergence-lane` as the zero-diff worktree lane and start the
real stack at `trl-834-draft-warden-fix-metadata-adr`. Primary checkout stays
clean on `main`.

Objective: make a meaningful v1 step forward by landing Warden fix metadata
doctrine, Warden trail output parity for fix metadata, adapter authoring as a
paved path, and Regrade dogfood that consumes Warden-owned migration facts.
TRL-834 must be first. Adapter package payloads such as Cloudflare/Vercel are
out of scope.

Stack:

1. TRL-834 - Warden fix metadata ADR.
2. TRL-866 - Warden diagnostic fix metadata through rule trail outputs.
3. TRL-853 - Adapter ADR snippet import truth.
4. TRL-861 - Adapter target metadata and catalog derivation.
5. TRL-862 - HTTP adapter-support/testing conformance factory.
6. TRL-863 - Shared adapter check engine.
7. TRL-864 - Warden adapter checks plus `trails adapter check`.
8. TRL-865 - Dogfood one first-party HTTP adapter.
9. TRL-805 - `create.adapter` scaffolding against proven catalog/checking.
10. TRL-836 - Regrade consumes Warden-backed `term-rewrite` metadata.
11. TRL-850 - ADR map check only if live verification shows real drift/gap.
12. TRL-826 - Package-source modes only if this stack proves the need.
13. TRL-829 - Regrade ADR after evidence, not before.

Rules:

- Use Graphite for source-control writes. No vanilla Git commits/pushes.
- Do not submit empty branches.
- Do not ship `create.adapter` before the dogfood branch proves the paved path.
- Subagents may inspect, edit assigned files, run checks, and write reports,
  but must not run git/gt write commands or mutate Linear/PRs.
- For review fixes, land changes on the lowest owning branch, `gt modify`,
  restack upward, and re-run focused checks.
- Keep PRs draft until CI and local review are clean.
- Treat Greptile/code-review errors as blockers.
- Add new Linear issues for real discoveries that become part of the goal.
- Record tracker mutations, branch state, validation, reviews, and fixes in
  `RETRO.md`.

Completion condition:

The stack is submitted as draft PRs, CI is checked, P0/P1/P2 local findings are
fixed or explicitly rejected with evidence, PR bodies are useful, Linear issues
are current, and `RETRO.md` records the final state and remaining risks.
