# Goal Prompt: plugin-skills-refresh-stack

Paste this into the goal runtime:

`````markdown
/goal Execute the Trails Plugin & Skills One-Stop Shop refresh stack end to end from the Trails repo root.

Primary source of truth:
`.agents/plans/2026-05-21-plugin-skills-refresh-stack/PLAN.md`

Read first:
- `AGENTS.md`
- `.agents/plans/PLANNING.md`
- `.agents/plans/2026-05-21-plugin-skills-refresh-stack/PLAN.md`
- `.agents/plans/2026-05-21-plugin-skills-refresh-stack/REFS.md`
- `.agents/plans/2026-05-21-plugin-skills-refresh-stack/RETRO.md`
- M1 audit packet at `.agents/plans/2026-05-21-plugin-skills-m1-audit/` before archive, then `.agents/plans/archive/2026-05-21-plugin-skills-m1-audit/` after the lowest branch archives it.
- PatchOS upstream retro if accessible in the operator's PatchOS checkout; otherwise use the summarized PatchOS findings in this packet's `RETRO.md`.
- Linear project `Trails Plugin & Skills One-Stop Shop`
- Linear issues `TRL-755`, `TRL-746`, `TRL-747`, `TRL-748`, `TRL-749`, `TRL-750`, `TRL-751`, `TRL-752`, `TRL-753`
- Adjacent PatchOS-derived Linear follow-ups `TRL-757`, `TRL-758`, `TRL-759`, `TRL-760`

Objective:
Build, locally review, submit, mark ready, and remote-review the nine-branch plugin refresh stack that turns the M1 audit into an updated Trails plugin/skills one-stop shop. Do not merge. Do not publish or mutate registries/marketplace/global skill paths without explicit operator approval.

Start condition:
Run `gt sync` first, check out `main`, and verify `main` includes PR #558 or later. Stop if the M1 audit stack has not landed.

Branch order, bottom to top:
1. TRL-755 - `trl-755-refresh-public-docs-drift-found-during-plugin-skills-audit`
2. TRL-746 - `trl-746-refresh-the-main-trails-skill-into-the-canonical-one-stop`
3. TRL-747 - `trl-747-refresh-trails-skill-references-templates-and-examples`
4. TRL-748 - `trl-748-refresh-plugin-agent-rules-advisory-skills-and-hook`
5. TRL-749 - `trl-749-add-plugin-metadata-sync-and-drift-checks`
6. TRL-750 - `trl-750-add-local-installed-trails-skill-synccheck-path`
7. TRL-751 - `trl-751-improve-trails-plugin-hooks-for-project-detection-and`
8. TRL-752 - `trl-752-dogfood-refreshed-trails-plugin-with-a-fresh-consumer-smoke`
9. TRL-753 - `trl-753-republish-trails-plugin-and-document-the-release-path`

Lowest-branch cleanup:
On `TRL-755`, move the completed M1 packet from `.agents/plans/2026-05-21-plugin-skills-m1-audit/` to `.agents/plans/archive/2026-05-21-plugin-skills-m1-audit/`. Update Linear descriptions or comments for issues that reference the M1 reports so future agents use the archived path. This refresh-stack packet is pre-seeded on `main`; only commit branch-local archive/path-reference updates on `TRL-755`.

Scope:
- TRL-755: fix public README/API docs drift from M1, including Topographer `TopoGraph`/lock wording, package-table completeness/intentional incompleteness, and `VersionNotSupportedError`.
- TRL-746: refresh `plugin/skills/trails/SKILL.md` as the concise first-load briefing.
- TRL-747: refresh skill references, templates, examples, and add HTTP/Bun guidance.
- TRL-748: refresh plugin agent, rules, advisory skills, Clark calibration, and hook message copy.
- TRL-749: define plugin metadata policy and add read-only check/sync tooling with tests.
- TRL-750: add local installed skill drift checker with tests; no global mutation by default.
- TRL-751: improve Claude hook detection/guidance with tests; document Codex parity as unknown unless verified.
- TRL-752: dogfood the refreshed bundle in a disposable consumer project and commit a report at `.agents/plans/2026-05-21-plugin-skills-refresh-stack/reports/trl-752-dogfood.md`.
- TRL-753: document and dry-run the release path, final project status, and operator-only publish blockers.
- PatchOS retro: use it as downstream dogfood evidence. Record whether `TRL-757` testing subpath boundaries, `TRL-758` Topographer CLI/docs ergonomics, `TRL-759` beta channel policy, or `TRL-760` migration guide block plugin release or remain deferred follow-ups. Do not silently implement those adjacent issues unless I explicitly expand scope.

Important constraints:
- Do not use the installed/global `trails` skill as doctrine. It is a drift-check target only.
- Do not publish, mutate npm/registry/marketplace state, run `npx skills outfitter-dev/trails` against a real global install target, or mutate global installed skill paths without explicit operator approval.
- Do not use `gt absorb`.
- Do not add merge queue labels.
- Do not merge.

Local review:
Before remote submission, run at least three local review passes from the stack tip:
1. Skill/docs doctrine: public docs, main skill, references, examples, package taxonomy, error/resource/testing/composition guidance.
2. Tooling/hooks safety: metadata policy/checks, installed-skill checker, hook detection, no global mutation, no noisy non-Trails behavior.
3. Dogfood/release readiness: smoke report, release runbook, stop rules, local/global install guidance, operator-only actions.

Reviewer output must include:
- Overall score: n/5
- Summary
- Findings with P0/P1/P2/P3 severity and evidence
- Prompt To Fix With AI for each actionable finding

Fix all P0/P1/P2 findings bottom-up before remote submission or ready-for-review. Documentation correctness is P2 by default; P3 is style-only.

Verification:
Run branch-appropriate targeted checks, then at the stack tip surface transcript-visible summaries for:

```bash
bun run warden:skills:check
bun run warden:agents:check
bun run clark:check
bun test scripts/__tests__/sync-plugin-metadata.test.ts
bun test scripts/__tests__/check-installed-trails-skill.test.ts
bun test scripts/__tests__/detect-trails-hook.test.ts
bun run typecheck
bun run test
bun run lint
bun run build
bun run check
bun run format:check
git diff --check
```

If generated Warden/agent content changes, run the corresponding sync commands before check commands:

```bash
bun run warden:skills:sync
bun run warden:agents:sync
```

Release/dogfood rules:
- Use `.trails-tmp/plugin-dogfood/` or a disposable tempdir for dogfood; do not commit the generated consumer project.
- Record exact dogfood commands, versions, typecheck/test/Warden results, installed-skill check result, cleanup state, and skipped commands in `reports/trl-752-dogfood.md`.
- Include PatchOS-style smoke coverage: explicit MCP include-list safety, output schemas, resource mocks or `unmockable`, error taxonomy normalization, opt-in observe/tracing without stdout pollution, `trails compile` / `trails validate`, and package install guidance for `@beta` or explicit beta.N versus accidental `latest`.
- `bun run publish:check` is allowed as a dry/read-only packaging check if useful.
- `bun run publish:packages`, marketplace publish, registry mutation, `npx skills` mutation, and global skill mutation are forbidden without explicit operator approval.

Remote review:
Submit draft PRs only after implementation, local verification, and local review are clean/P3-only. Mark ready only after CI and local review are clean. After ready, check CI, unresolved review threads, and code-review bot/agent summaries. Record numeric review scores, prose summaries, prompt-to-fix text, and fixes in `RETRO.md`. Resolve all P0/P1/P2 feedback from the owning lower branch upward. Treat pending Graphite mergeability by itself as service lag when GitHub checks/review are otherwise clean.

Completion condition:
The goal is complete only when all nine branches/PRs exist in the stated order, M1 packet cleanup is done, Linear is current, implementation is complete, dogfood/release reports exist, local review is clean or P3-only after at least three passes, PRs are marked ready with high-quality bodies, remote review/CI has no unresolved P0/P1/P2 findings or bot errors, required verification has passed or skipped checks are explained, no publish/registry/marketplace/global-skill mutation/merge/merge queue label/`gt absorb` happened, and the final transcript reports branch/PR state, changed artifacts, commands/results, skipped checks, remaining P3s/risks, tracker state, and finalized `RETRO.md` state.

Retro discipline:
Maintain `.agents/plans/2026-05-21-plugin-skills-refresh-stack/RETRO.md` as the durable execution ledger. Touch it last before local completion, draft submission, ready-for-review, remote review closeout, release handoff, merge readiness, archive, or final handoff. Any meaningful local or remote review change must be reflected in `RETRO.md` before claiming that review loop is complete.

Stop and ask if:
- The M1 audit stack is not present on `main`.
- A public API or doctrine decision is required beyond M1 findings and issue bodies.
- The work requires publish, registry mutation, marketplace mutation, `npx skills` mutation, global installed skill mutation, secrets, or credentials without explicit approval.
- A hook would need to mutate files or run noisy checks by default.
- Linear writes are unavailable and tracker references cannot be corrected after archiving M1.
- Verification fails for unrelated reasons after one focused retry.
- More than four post-ready remote-review turns pass and P2+ feedback remains unresolved.
`````
