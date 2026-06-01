---
created: "2026-05-30T12:28:00Z"
updated: "2026-05-30T12:28:00Z"
status: active
owner: Lewis
linear:
  - TRL-834
  - TRL-866
  - TRL-853
  - TRL-861
  - TRL-862
  - TRL-863
  - TRL-864
  - TRL-865
  - TRL-805
  - TRL-836
  - TRL-850
  - TRL-826
  - TRL-829
---

# V1 Convergence Loop

## Objective

Build one reviewable Graphite stack that moves Trails toward a stronger v1
state by connecting three compounding lanes:

1. Warden fix metadata doctrine.
2. Warden's trail-shaped diagnostic outputs preserving the same fix facts.
3. Adapter authoring as a paved path.
4. Regrade consuming Warden-owned migration facts once the Warden projection is
   true.

This is a build loop, not just a checklist. Each branch should improve the
next branch's footing, and each review pass should feed fixes back into the
lowest owning branch.

## Stack Lane

- Primary checkout stays clean on `main`.
- Execution worktree:
  `/Users/mg/.config/codex/worktrees/trails-v1-convergence`
- Zero-diff lane branch:
  `lewis/v1-convergence-lane`
- First stack branch:
  `trl-834-draft-warden-fix-metadata-adr`

The lane branch exists only so the linked worktree has a real Graphite branch.
Do not submit the zero-diff lane branch unless we intentionally add work to it.

## Branch Order

| Order | Issue | Branch | Purpose |
| --- | --- | --- | --- |
| 1 | TRL-834 | `trl-834-draft-warden-fix-metadata-adr` | ADR for Warden fix metadata before Regrade consumes it. |
| 2 | TRL-866 | `trl-866-project-warden-diagnostic-fix-metadata-through-rule-trail` | Preserve diagnostic `fix` metadata through Warden rule trail outputs. |
| 3 | TRL-853 | `trl-853-draft-adr-conformance-snippet-calls-runconformance-without` | Stabilize adapter ADR snippet truth before implementation relies on it. |
| 4 | TRL-861 | `trl-861-define-adapter-target-metadata-and-catalog-derivation` | Adapter target metadata and read-only catalog derivation. |
| 5 | TRL-862 | `trl-862-add-http-adapter-authoring-support-and-conformance-factory` | HTTP owner authoring bundle and conformance factory. |
| 6 | TRL-863 | `trl-863-build-shared-adapter-check-engine` | One shared adapter check engine. |
| 7 | TRL-864 | `trl-864-expose-adapter-checks-through-warden-and-trails-adapter` | Warden and `trails adapter check` projections over the same engine. |
| 8 | TRL-865 | `trl-865-dogfood-adapter-authoring-path-on-a-first-party-http-adapter` | First-party HTTP adapter dogfood. |
| 9 | TRL-805 | `trl-805-trails-create-adapter-scaffold-adapter-packages-against-the` | `create.adapter` scaffolding after dogfood proves the path. |
| 10 | TRL-836 | `trl-836-integrate-warden-backed-term-rewrite-regrades` | Regrade consumes Warden-backed `term-rewrite` metadata. |
| 11 | TRL-850 | `trl-850-regenerate-stale-adr-decision-map-and-enforce-consistency-in` | Conditional: only if a real map drift/check gap remains. |
| 12 | TRL-826 | `trl-826-prove-regrade-package-source-modes` | Conditional: package-source modes only if this stack proves the need. |
| 13 | TRL-829 | `trl-829-draft-regrade-adr-from-tracer-evidence` | Conditional: Regrade ADR after evidence, not before. |

The bottom ten are expected. TRL-850, TRL-826, and TRL-829 are conditional:
keep them in scope only if live verification says they are still justified;
otherwise update Linear and defer with a clear note.

## Non-Goals

- Do not build Cloudflare, Vercel, webhook, scheduler, or provider adapters in
  this stack.
- Do not make adapter tooling public before dogfood evidence supports the
  shape.
- Do not duplicate Warden-owned migration facts inside Regrade.
- Do not ship `create.adapter` before a real adapter dogfood pass proves the
  catalog, conformance, and check loop.
- Do not submit empty branches.
- Do not use `gt absorb`.
- Do not merge or queue merge without Matt explicitly asking.

## Source-Control Rules

- Use Graphite for source-control writes:
  `gt create`, `gt modify`, `gt restack`, `gt submit`.
- Use read-only Git commands freely for inspection.
- Before every `gt modify`, run `git branch --show-current`.
- For review fixes, check out the lowest owning branch, apply the fix there,
  `gt modify`, `gt restack`, then walk upward with focused checks.
- Subagents must not run git/gt write commands or mutate PRs/Linear.
- Keep PRs draft until CI and local review are clean.

## Linear Rules

- Keep every in-scope issue current.
- If a bug is discovered and it belongs in the stack, create or update a
  focused Linear issue immediately and add it to this packet.
- If implementation diverges from an issue description, leave a Linear comment
  explaining the divergence.
- Do not mark issues Done until their PRs merge.

## Review Loop

Run local review from the stack tip before submission, and repeat until the
latest pass is clean or P3-only.

Minimum review lanes:

- Doctrine and ADR fit: tenets, lexicon, decision map, doc truth.
- Adapter authoring: metadata/catalog, package boundaries, conformance shape,
  CLI/Warden projection consistency.
- Regrade/Warden integration: no parallel mapping database, `NeedsReview`
  routing, provenance and validation.
- Test and release hygiene: changesets, export maps, docs examples, generated
  guides, package boundaries.

Review output must use:

```markdown
Overall score: n/5

Summary:
<one short prose judgment>

Findings:
- P0/P1/P2/P3 - <file:line> - <finding>
  Prompt To Fix With AI:
  <concise fix prompt>

No-findings statement:
<what was inspected and what residual risk remains>
```

Fix all P0/P1/P2. P3 can be fixed if cheap or recorded with a reason.

## Validation Ladder

Use the smallest relevant checks per branch, then broaden at the tip.

Likely focused checks:

- `bun scripts/adr.ts map`
- `bun scripts/adr.ts check`
- `bun test packages/warden/src/__tests__/fix.test.ts`
- `bun test packages/warden/src/__tests__/guide.test.ts`
- `bun test packages/regrade/src/downstream/__tests__/report.test.ts`
- `bun test apps/trails/src/__tests__/*.test.ts`
- package-local `bun run typecheck`

Tip checks before submission:

- `bun run lint`
- `bun run lint:ast-grep`
- `bun run format:check`
- `bun run typecheck`
- `bun run test`
- `bun run build`
- `bun run check`
- `bun run publish:check`
- `git diff --check`

If Warden guides or skill/agent projections change:

- `bun run warden:agents:sync`
- `bun run warden:skills:sync`
- `bun run warden:agents:check`
- `bun run warden:skills:check`

## Submission Plan

1. Submit the full stack as draft with `gt submit --stack --draft`.
2. Patch PR bodies with context, changes, verification, risks, and Linear links.
3. Wait for CI.
4. Keep PRs draft until CI and local review are clean.
5. Mark ready only after no P0/P1/P2 local findings remain and CI is green.
6. Capture CI and bot-review state in `RETRO.md`.
