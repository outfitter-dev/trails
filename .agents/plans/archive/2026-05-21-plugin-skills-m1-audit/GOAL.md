---
created: 2026-05-21T21:29:29Z
updated: 2026-05-22T20:49:43Z
description: Machine-local execution packet for the M1 plugin/skills audit goal. Contains the full /goal prompt to paste into the goal runtime, covering objective, branch order, required report outputs, scope per issue, evidence rules, local and remote review contracts, verification commands, and completion/stop conditions.
impl_status: implemented
linear:
  - TRL-742
  - TRL-743
  - TRL-744
  - TRL-745
  - TRL-746
  - TRL-747
  - TRL-748
  - TRL-749
  - TRL-750
  - TRL-751
  - TRL-752
  - TRL-753
  - TRL-754
references:
  - .agents/plans/archive/2026-05-21-plugin-skills-m1-audit/PLAN.md
  - .agents/plans/archive/2026-05-21-plugin-skills-m1-audit/REFS.md
  - .agents/plans/archive/2026-05-21-plugin-skills-m1-audit/RETRO.md
  - AGENTS.md
  - .agents/plans/PLANNING.md
---

# Goal Prompt: plugin-skills-m1-audit

> Note: this goal prompt is a machine-local execution packet for Matt's Trails checkout. Absolute `/Users/mg/...` paths are preserved as point-in-time audit coordinates, especially for TRL-743 installed-skill inspection; downstream implementation guidance should use repo-relative paths or `$HOME`-relative skill roots instead.

Paste this into the goal runtime:

`````markdown
/goal Execute M1 of the Trails Plugin & Skills One-Stop Shop project end to end from cwd `/Users/mg/Developer/outfitter/trails`.

Primary source of truth:
`/Users/mg/Developer/outfitter/trails/.agents/plans/2026-05-21-plugin-skills-m1-audit/PLAN.md`

Read first:
- `AGENTS.md`
- `.agents/plans/PLANNING.md`
- `.agents/plans/2026-05-21-plugin-skills-m1-audit/PLAN.md`
- `.agents/plans/2026-05-21-plugin-skills-m1-audit/REFS.md`
- `.agents/plans/2026-05-21-plugin-skills-m1-audit/RETRO.md`
- Linear project `Trails Plugin & Skills One-Stop Shop`
- Linear issues `TRL-741`, `TRL-742`, `TRL-743`, `TRL-744`, `TRL-745`, `TRL-754`
- Downstream issues `TRL-746`, `TRL-747`, `TRL-748`, `TRL-749`, `TRL-750`, `TRL-751`, `TRL-752`, `TRL-753`

Important tool constraint:
Do not use the installed/global `trails` skill as doctrine for this goal. It is known to be stale and is itself an audited artifact. Use repo files, Linear, package exports, CLI help, Warden output, and this plan packet instead. Inspect `/Users/mg/.agents/skills/trails` and `/Users/mg/.config/claude/skills/trails` read-only only for TRL-743.

Objective:
Build, locally review, submit, and tracker-update the five-branch Graphite M1 audit stack. The end state is a source-backed truth map for the Trails plugin/skills ecosystem plus an exact downstream M2/M3 implementation stack, not plugin implementation.

Branch order, bottom to top:
1. TRL-745 - `trl-745-audit-plugin-coverage-for-current-packages-adapters-and`
2. TRL-742 - `trl-742-audit-repo-plugin-and-skills-against-current-trails-doctrine`
3. TRL-743 - `trl-743-audit-installed-and-distributed-trails-skill-surfaces`
4. TRL-744 - `trl-744-audit-trails-plugin-hook-opportunities-and-integration`
5. TRL-754 - `trl-754-synthesize-plugin-audits-into-an-executable-refresh-stack`

Required outputs:
- `.agents/plans/2026-05-21-plugin-skills-m1-audit/reports/trl-745-package-coverage.md`
- `.agents/plans/2026-05-21-plugin-skills-m1-audit/reports/trl-742-repo-plugin-doctrine.md`
- `.agents/plans/2026-05-21-plugin-skills-m1-audit/reports/trl-743-distribution-surfaces.md`
- `.agents/plans/2026-05-21-plugin-skills-m1-audit/reports/trl-744-hook-opportunities.md`
- `.agents/plans/2026-05-21-plugin-skills-m1-audit/reports/trl-754-synthesis.md`

Source-control rules:
- Run `gt sync` first and start from current `main`.
- Use Graphite for branch and stack operations.
- It is fine to create the local branch chain up front, but do not submit or push empty branches.
- Commit this plan packet on the lowest branch in the stack.
- Main agent owns all `git` and `gt` writes.
- Subagents may inspect files, write report drafts, run checks, and provide local review, but they must not run `git add`, `git commit`, `git push`, `gt create`, `gt modify`, `gt restack`, `gt submit`, merge commands, or PR mutation commands.
- Do not use `gt absorb`.
- Do not add a merge queue label.
- Do not merge.

Scope:
- TRL-745: package/subpath truth map and plugin coverage matrix for current `@ontrails/*` packages, adapters, and key exports, including `@ontrails/http/bun`, `@ontrails/pino`, and `@ontrails/wayfinder`.
- TRL-742: repo plugin and skill doctrine audit against current lexicon, docs, ADRs, CLI help, Warden manifest, package exports, and generated guidance.
- TRL-743: installed and distributed skill/plugin surface audit across repo plugin source, manifests, local installed skill paths, Codex/Claude-visible paths, and version metadata.
- TRL-744: hook and integration audit for project detection, version drift warnings, Warden nudges, command suggestions, and Claude/Codex differences.
- TRL-754: synthesis report, Linear issue refresh for TRL-746 through TRL-753, M2/M3 stack recommendation, and focused follow-up issue creation for real discoveries.

Evidence rules:
- Every report finding needs a path, line where practical, quoted text or command summary, and a recommended owner issue.
- Use `qmd` for local documentation search when semantic docs lookup helps, and `rg` for exact stale vocabulary or file sweeps.
- `unable to verify` is acceptable. Invented references are not.
- Keep out-of-goal discoveries in `RETRO.md` first; create Linear follow-up issues only when the discovery is concrete and scoped.

Local review:
Before remote submission or final handoff, run local review over the reports and synthesis. Use subagents if useful. Require each reviewer to provide:

```markdown
Overall score: n/5

Summary:
<concise judgment>

Findings:
- P0/P1/P2/P3 - <artifact/path/line> - <finding>
  Prompt To Fix With AI:
  <concise fix prompt>
```

Review lanes:
- Evidence integrity: report claims have support and unknowns are explicit.
- Tracker alignment: every M1 finding routes to the correct issue, new issue, or deferral.
- Implementation readiness: M2/M3 issues and stack order are precise enough for execution without redoing the audit.

Fix every P0/P1/P2 finding before marking PRs ready or claiming final handoff. Documentation correctness is P2 by default; P3 is style-only.

Verification:
At minimum, surface transcript-visible summaries for:

```bash
git status --short --branch
gt log --stack --reverse --no-interactive
bun run warden:skills:check
bun run warden:agents:check
bun run clark:check
bun run format:check
git diff --check
```

If the work touches source, plugin hooks, generated guidance, package files, or scripts beyond reports/Linear updates, also run:

```bash
bun run check
```

Remote review:
Submit PRs as draft after report completion, Linear updates, and local verification. Mark ready only after local review is clean or P3-only and checks pass. After ready, check CI, unresolved review threads, and code-review bot/agent summaries. Record numeric review scores, prose summaries, and prompt-to-fix text in `RETRO.md`; resolve all P0/P1/P2 findings. Treat a pending Graphite mergeability check by itself as external service lag when GitHub checks and review are otherwise clean, per `.agents/plans/PLANNING.md` and goal-planning source-control guidance.

Completion condition:
The goal is complete only when all five reports exist, M1 Linear issues and downstream M2/M3 issues are current, local review is clean or P3-only, PRs are submitted with high-quality bodies, required checks pass or skipped checks are explained, no implementation/publish/registry mutation/merge/merge queue label/global skill mutation occurred, and the final transcript reports branch/PR state, report paths, Linear mutations, verification commands/results, review state, remaining P3s/risks, and finalized `RETRO.md` state.

Retro discipline:
Maintain `/Users/mg/Developer/outfitter/trails/.agents/plans/2026-05-21-plugin-skills-m1-audit/RETRO.md` as the durable execution ledger. Touch it last before local completion, draft submission, ready-for-review, remote review closeout, merge readiness, archive, or final handoff. Any meaningful local or remote review change must be reflected in `RETRO.md` before claiming the review loop is complete.

Stop and ask if:
- The M1 Linear graph or branch names differ from this plan in a way that changes stack order.
- A doctrine/API decision must be settled before downstream issues can be made executable.
- The work requires mutating global installed skill paths, publishing the plugin, changing package releases, registry mutation, merge, or merge queue entry.
- The goal would turn into implementing plugin refresh changes rather than auditing and routing them.
- Linear writes are unavailable and tracker truth cannot be updated.
- Verification fails for unrelated repo reasons after one focused retry.
`````
