# V1 Readiness Closure Stack

Date: 2026-05-13
Status: Ready for goal kickoff

This packet turns the follow-ups discovered by the TopoGraph Query + V1
Closeout stack into one end-to-end execution goal. The prior stack has merged
through PR #500; its completed packet has been moved to
`.agents/plans/archive/2026-05-12-topograph-query-docs-stack/`.

This packet is self-contained. The three source audit reports that created the
new issues are copied into this packet under `reports/source-*.md`, so the
executor does not need ignored scratch docs or archived local notes.

Do not use the Trails skill for this work. It is out of date for the current
artifact-family and release-readiness doctrine and has confused earlier runs.

## Objective

Build the V1 readiness closure stack locally, covering:

- M6 release-process blockers and stable-cutover doctrine (`TRL-713`,
  `TRL-714`, `TRL-712`, `TRL-711`).
- M5 docs/examples installability and verification gates (`TRL-707`,
  `TRL-709`, `TRL-708`, `TRL-710`).
- M3 cross-surface parity implementation (`TRL-704`, `TRL-706`, `TRL-705`).

The executor should build the full local stack before remote submission, run
multiple local review passes, submit high-quality draft PRs, mark ready after CI
and local review are clean, handle remote P2+ feedback from the bottom up, and
stop without merging.

## Source Of Truth

Read these first, in order:

1. `AGENTS.md`
2. `.agents/plans/PLANNING.md`
3. `.agents/plans/2026-05-13-v1-readiness-closure-stack/PLAN.md`
4. `.agents/plans/2026-05-13-v1-readiness-closure-stack/REFS.md`
5. `.agents/plans/2026-05-13-v1-readiness-closure-stack/reports/source-m3-parity-audit.md`
6. `.agents/plans/2026-05-13-v1-readiness-closure-stack/reports/source-m5-docs-audit.md`
7. `.agents/plans/2026-05-13-v1-readiness-closure-stack/reports/source-m6-release-process-audit.md`
8. Linear issues `TRL-704` through `TRL-714`

Relevant live state at packet creation:

- `main` was clean and equal to `origin/main` at `2a754ecd1` / PR #500.
- Linear showed `TRL-704` through `TRL-714` open in `Backlog`, parented to
  their completed audit issues and assigned to `v1 Release Prep` milestones.
- Dependency edges were added:
  - `TRL-705` is blocked by `TRL-704` and `TRL-706`.
  - `TRL-711` is blocked by `TRL-712`, `TRL-713`, and `TRL-714`.
  - `TRL-707` is related to `TRL-714`.
- PR #479 remains an old draft docs-freshness PR that is dirty against current
  `main`; do not build this stack on it.
- PR #447 (`@ontrails/bun`) remains an independent product/design question and
  is out of scope for this stack.

## Preflight

Before creating branches:

1. Run `gt sync`.
2. Check out current `main`.
3. Confirm `git status --short --branch` is clean except for this packet's
   tracked planning changes.
4. Confirm PRs #488 through #500 are merged and their Linear issues are Done.
5. Confirm `TRL-704` through `TRL-714` are still open and in the expected
   project/milestones.
6. Confirm no generated SQLite artifacts or local state files are staged:

   ```bash
   git status --short -- .trails .trails-tmp
   ```

7. Confirm stale draft PRs are not part of the execution base:

   ```bash
   gh pr list --state open --limit 50 --json number,title,headRefName,isDraft,mergeStateStatus,url
   gt log --stack --no-interactive
   ```

8. Commit this packet on the lowest execution branch. This includes the
   archived/removal state for the completed
   `.agents/plans/2026-05-12-topograph-query-docs-stack/` packet and the new
   `.agents/plans/2026-05-13-v1-readiness-closure-stack/` packet.

If the previous stack has not actually landed on `main`, stop and report the
exact unmerged PRs instead of building on stale state.

## Stack Order

Build this as one Graphite stack. It is fine to create the local branch chain up
front, but do not submit or push empty branches.

| Order | Issue | Branch | Role |
| --- | --- | --- | --- |
| 1 | `TRL-713` | `trl-713-repair-stale-changesets-references-before-stable-cutover` | Repair stale Changesets state so release-plan computation can run. |
| 2 | `TRL-714` | `trl-714-add-registry-availability-and-dist-tag-release-preflights` | Add registry/package/dist-tag preflight coverage. |
| 3 | `TRL-707` | `trl-707-fix-fresh-start-install-blocker-for-generated-cli-projects` | Fix or precisely gate the generated-project install blocker. |
| 4 | `TRL-712` | `trl-712-author-stable-release-doctrine-adr-for-the-1x-line` | Set stable 1.x release doctrine. |
| 5 | `TRL-711` | `trl-711-codify-the-beta-to-10-release-runbook` | Codify the stable cutover runbook using the doctrine and new preflights. |
| 6 | `TRL-709` | `trl-709-add-markdown-link-integrity-check-for-docs-and-readmes` | Add code-fence-aware Markdown link integrity checking. |
| 7 | `TRL-708` | `trl-708-expand-readme-typescript-snippet-verification-beyond-tracing` | Expand README TypeScript snippet verification. |
| 8 | `TRL-710` | `trl-710-create-public-api-example-coverage-inventory-and-gate` | Inventory and gate v1 public API `@example` coverage. |
| 9 | `TRL-704` | `trl-704-add-http-surface-harness-and-include-it-in` | Add first-party HTTP harness and `testAllEstablished()` projection validation. |
| 10 | `TRL-706` | `trl-706-expose-complete-shipped-surface-projection-inventory-for` | Expose complete shipped-surface projection inventory for blind parity audits. |
| 11 | `TRL-705` | `trl-705-add-example-driven-climcphttp-parity-runner-and-ci-gate` | Add example-driven CLI/MCP/HTTP parity runner and CI gate. |

This order handles release blockers first, then docs/readiness gates, then the
cross-surface parity implementation that depends on the HTTP harness and
projection inventory.

## PR 1: TRL-713 Changesets Repair

Problem:

- `bunx changeset status --verbose` fails because
  `.changeset/logtape-observe-target.md` still references retired
  `@ontrails/logging`.

Expected targets:

- `.changeset/logtape-observe-target.md`
- Package changelog/versioning docs only if the fix reveals stale release
  wording.

Guidance:

- Repair or remove the stale frontmatter in the smallest truthful way.
- Preserve the intended `@ontrails/logtape` release note.
- Do not run `bunx changeset version` or stable cutover commands.

Verification floor:

```bash
bunx changeset status --verbose
bun run changeset:check
bun run format:check
git diff --check
```

## PR 2: TRL-714 Registry Preflights

Problem:

- `bun run publish:check` proves local packability but not public registry
  availability, package access, or dist-tag posture.

Expected targets:

- `scripts/publish.ts` or a new focused release-preflight script.
- `package.json` scripts if adding a new command.
- Tests under `scripts/__tests__/` if script behavior is testable without live
  registry calls.
- Release docs/runbook notes only if needed before TRL-711.

Guidance:

- Inventory every non-private `@ontrails/*` workspace.
- Check package visibility and dist-tags with read-only registry probes.
- Keep publish posture Bun-based: `bun run publish:check` and
  `bun run publish:packages`.
- Do not introduce `npm publish` or `changeset publish`.
- Separate live-network checks from deterministic unit tests where possible.
- Make missing first-time packages explicit rather than silently treating them
  as failures with no operator guidance.

Verification floor:

```bash
bun test scripts
bun run publish:check
bun run format:check
git diff --check
```

If a live registry probe needs credentials or rate-limited access, record the
exact command/result in `RETRO.md` and keep deterministic tests passing.

## PR 3: TRL-707 Fresh-Start Install Blocker

Problem:

- A generated project with CLI/MCP/HTTP surfaces fails `bun install` because
  `@ontrails/commander@^1.0.0-beta.15` is missing or inaccessible on npm.

Expected targets:

- `apps/trails` scaffold/version generation code.
- `scripts/sync-scaffold-versions.ts` and generated scaffold package metadata.
- `docs/getting-started.md` if docs need to explain a temporary beta caveat.
- Release-preflight integration if TRL-714 exposes reusable helpers.

Guidance:

- First determine whether the blocker has a code-side fix or only a registry
  publish fix.
- Do not run `bun run publish:packages`, `bun publish`, `npm publish`, or any
  externally visible package publish without Matt's explicit confirmation.
- If a real registry publish is the only way to make the fresh-start smoke pass,
  stop this branch after documenting the exact evidence, exact publish command,
  package list, and smallest human action needed.
- If a code-side fix exists, apply it and run the fresh-start smoke from a temp
  directory outside the monorepo.

Verification floor:

```bash
bun run scaffold-versions:check
bun run publish:check
tmp=$(mktemp -d /tmp/trails-docs-smoke.XXXXXX)
bun apps/trails/bin/trails.ts create docs-smoke --dir "$tmp" --surfaces cli mcp http --verify --output json
(cd "$tmp/docs-smoke" && bun install)
bun run format:check
git diff --check
```

The temp workspace should be removed after the smoke. Do not commit generated
temporary project files.

## PR 4: TRL-712 Stable 1.x Release Doctrine ADR

Problem:

- Stable 1.x release doctrine is not captured in an ADR.

Expected targets:

- A new accepted ADR under `docs/adr/`.
- `docs/adr/README.md` and decision map updates.
- Possibly `docs/releases/` references if the ADR needs a durable pointer.

Doctrine questions to answer:

- Whether `@ontrails/*` remains fixed/lockstep for the 1.x line.
- Dist-tag policy: stable on `latest`, prerelease channels explicit.
- Breaking-change posture after 1.0.
- Package retirement/rename/deprecation posture.
- Generated-app installability requirement.
- Changelog and release-note expectations.
- Publication authority: Changesets for version/changelog computation,
  `bun run publish:packages` for publication.
- Partial-publish recovery expectations.
- Release PR governance and preflight evidence.

Verification floor:

```bash
bun scripts/adr.ts map
bun scripts/adr.ts check
bun run format:check
git diff --check
```

## PR 5: TRL-711 Stable Cutover Runbook

Problem:

- The beta-to-1.0 cutover is captured in an audit report, not a durable runbook.

Expected targets:

- `docs/releases/` runbook, or another repo-consistent durable release doc.
- `AGENTS.md` only if the operator quick-reference needs a narrow pointer.
- `docs/index.md` or docs release index if needed for discoverability.

Guidance:

- Build on TRL-712, TRL-713, and TRL-714.
- Include preconditions, branch posture, command order, version PR review,
  post-merge publish, dist-tag/registry verification, and partial-publish
  recovery.
- Use `bun run publish:check` and `bun run publish:packages`.
- Do not tell operators to use `npm publish` or `changeset publish`.
- Do not actually run `bunx changeset pre exit`, `bunx changeset version`, or
  publish commands as part of this docs branch.

Verification floor:

```bash
bun run publish:check
bun scripts/adr.ts check
bun run format:check
git diff --check
```

## PR 6: TRL-709 Markdown Link Integrity

Problem:

- Docs and READMEs have no code-fence-aware relative-link integrity gate, and
  the audit found real broken links.

Expected targets:

- A new script under `scripts/` or an extension of an existing docs checker.
- `package.json` scripts and `bun run check` integration if mature enough.
- Tests under `scripts/__tests__/`.
- Fix the broken links found in the source M5 audit.

Required behavior:

- Scan consumer-facing Markdown in `docs/`, `packages/`, `apps/`, and
  `adapters/`.
- Exclude `CHANGELOG.md` unless the implementation deliberately supports it.
- Skip fenced code blocks.
- Handle relative paths, anchors, and external URLs correctly.
- Report actionable source path, line, link text, and target.

Known broken links from source audit:

- `docs/adr/0025-composition-testing.md` -> `../../testing.md`.
- Several draft ADR links to accepted ADRs resolve inside `docs/adr/drafts/`.
- Missing draft target `20260409-derivetrail-and-trail-factories.md`.

Verification floor:

```bash
bun test scripts
bun run format:check
git diff --check
```

If the checker is added to `bun run check`, run `bun run check` on this branch
after fixing the known links.

## PR 7: TRL-708 README Snippet Verification

Problem:

- `bun run docs:snippets` currently verifies only
  `packages/tracing/README.md`.

Expected targets:

- `scripts/check-readme-snippets.ts`
- Tests for snippet extraction/config behavior.
- README snippets or per-file preludes for publishable package/app/adapter
  READMEs.

Guidance:

- Expand from a single allowlist entry toward the 21 README files inventoried in
  `reports/source-m5-docs-audit.md`.
- Prefer per-README config/prelude entries over weakening typechecking.
- Keep TypeScript/TSX fence extraction code-fence-aware.
- Make failures actionable with source path and line number.
- It is acceptable to phase coverage if the PR introduces a clear inventory and
  v1-minimum gate, but do not leave the checker pretending it covers all READMEs
  when it does not.

Verification floor:

```bash
bun run docs:snippets
bun test scripts
bun run format:check
git diff --check
```

## PR 8: TRL-710 Public API Example Coverage

Problem:

- Public API `@example` coverage is sparse and ungated, especially on shipped
  surface package entrypoints.

Expected targets:

- A new inventory/check script or Warden-adjacent doc gate.
- Public export barrels in `packages/cli`, `packages/http`, `packages/mcp`,
  `adapters/commander`, and `adapters/hono`.
- Targeted TSDoc additions for high-value exports.

Guidance:

- Build an inventory before adding examples blindly.
- Establish a v1-minimum bar for public exports.
- Prefer copyable, compile-credible examples over decorative snippets.
- If full coverage is too large, gate critical v1 entrypoints and record the
  remaining inventory in `RETRO.md` or a follow-up issue.

Representative missing examples from the audit:

- `packages/cli/src/index.ts`: `deriveCliCommands`, `deriveFlags`, `output`,
  discovery helpers.
- `packages/http/src/index.ts`: `deriveHttpRoutes`, `deriveHttpMethod`,
  `deriveOpenApiSpec`.
- `packages/mcp/src/index.ts`: `deriveMcpTools`, `surface`, `createServer`,
  `connectStdio`.
- `adapters/commander/src/index.ts`: `surface`, `createProgram`,
  `toCommander`.
- `adapters/hono/src/index.ts`: `surface`, `createApp`.

Verification floor:

```bash
bun run typecheck
bun run format:check
git diff --check
```

Run any new example-coverage check directly and add it to `bun run check` only
when the signal is stable.

## PR 9: TRL-704 HTTP Surface Harness

Problem:

- `@ontrails/testing` exports CLI and MCP harnesses but no HTTP harness, and
  `testAllEstablished()` validates only CLI/MCP projection builds.

Expected targets:

- `packages/testing/src/harness-http.ts` or equivalent.
- `packages/testing/src/all.ts`
- `packages/testing/src/index.ts`
- `packages/testing/src/types.ts`
- Tests for the new harness and established surface suite.
- `packages/testing/README.md` and docs testing references if public API changes.

Guidance:

- Use `@ontrails/http` route derivation rather than Hono/adapter-specific
  behavior.
- Keep the harness Result/error envelope normalized and test-friendly.
- Add an `http` options slot to `TestAllEstablishedOptions`.
- Preserve existing CLI/MCP harness behavior.
- Add a changeset for `@ontrails/testing` if public package contents change.

Verification floor:

```bash
bun test packages/testing
bun run typecheck
bun run format:check
git diff --check
```

## PR 10: TRL-706 Shipped Surface Projection Inventory

Problem:

- Blind agents cannot query a complete shipped-surface projection inventory from
  one artifact-backed view.

Expected targets:

- `packages/topographer` query/view helpers if the inventory belongs in stored
  artifact APIs.
- `apps/trails/src/trails/survey.ts` and output schemas if the app should expose
  the view.
- Tests in `packages/topographer` and/or `apps/trails`.
- Docs for the chosen public shape.

Guidance:

- Build on the TopoGraph/topo-store detail APIs from the merged M4b stack.
- Do not make `topo_surfaces` SQL rows pretend to be the canonical complete
  graph; TRL-656 deliberately documented them as operational projections.
- The inventory should answer: for each eligible public trail, which shipped
  surfaces project it, and what surface-specific name/path/method/tool command
  is derived.
- Preserve WebSocket as planned/not shipped.
- Keep the view suitable for blind agents and future parity gates.

Verification floor:

```bash
bun test packages/topographer
bun test apps/trails/src/__tests__/survey.test.ts
bun run typecheck
bun run format:check
git diff --check
```

## PR 11: TRL-705 Example-Driven Parity Runner

Problem:

- Projection parity is structurally true, but no single gate executes the same
  trail example through CLI, MCP, and HTTP and compares normalized semantics.

Expected targets:

- `packages/testing` parity helper(s).
- `apps/trails-demo` or another representative app test that opts in first.
- Docs/tests for exclusions and intentional surface differences.
- `bun run check` integration only if the runner is stable and not too slow.

Guidance:

- Build on TRL-704's HTTP harness and TRL-706's projection inventory.
- Start with `trails-demo` before requiring every app topo.
- Normalize each surface envelope into:
  - `ok` / `err`
  - success JSON payload
  - TrailsError category/code/retryability for failure
- Preserve intentional differences: CLI command names, MCP tool names, HTTP
  method/path, envelope shape, internal trails, activation consumers, and
  WebSocket not shipped.
- Add scoped exclusions with explicit reasons rather than silent skips.
- Add changesets for changed public testing APIs.

Verification floor:

```bash
bun test packages/testing
bun test apps/trails-demo
bun run typecheck
bun run format:check
git diff --check
```

## Changesets

Every PR touching publishable `@ontrails/*` package contents needs a
branch-local `.changeset/*.md` entry unless it is explicitly and truthfully
`release:none`.

Use Trails' Bun publish language:

- `bun run publish:check`
- `bun run publish:packages`

Do not add `npm publish` or `changeset publish` guidance.

## Local Review Loop

Before remote submission, run at least three local review rounds from the stack
tip. Continue until the latest pass is P3-only or clean.

Suggested review lanes:

- Release lane: `TRL-713`, `TRL-714`, `TRL-712`, `TRL-711`, Bun publish posture,
  no real publish, stable cutover clarity.
- Fresh-start/docs lane: `TRL-707`, `TRL-709`, `TRL-708`, `TRL-710`, generated
  project smoke, docs gates, example coverage signal.
- Parity/testing lane: `TRL-704`, `TRL-706`, `TRL-705`, harness design, surface
  eligibility, normalized semantics, examples.
- Source-control/changeset lane: branch ownership, changesets, generated files,
  old packet archive/removal, no merge queue label.

Reports should live in:

```text
.agents/plans/2026-05-13-v1-readiness-closure-stack/reports/
```

Fix all P0/P1/P2 findings before remote submission. P3 findings may remain if
documented and non-blocking.

## Owning-Branch Fix Loop

1. Triage findings into a bottom-up list by lowest owning branch.
2. `gt checkout <owning-branch>`.
3. Run `git branch --show-current` before any `gt modify -c`.
4. Apply the minimal branch-owned fix.
5. Run focused validation for that branch.
6. Commit with `gt modify` using a Conventional Commit message.
7. `gt restack`.
8. Walk upward through affected descendants, resolving conflicts and running
   targeted checks as needed.

Do not use `gt absorb` as the normal review-fix workflow. Do not use
`gt modify --into` from another branch.

## Tip Verification

Run focused tests per branch. At the stack tip, run:

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

If generated Warden guidance or agent guidance changes, also run:

```bash
bun run warden:agents:sync
bun run warden:skills:sync
bun run warden:agents:check
bun run warden:skills:check
```

Run a final fresh-start smoke if TRL-707 reaches a code-side fix:

```bash
tmp=$(mktemp -d /tmp/trails-docs-smoke.XXXXXX)
bun apps/trails/bin/trails.ts create docs-smoke --dir "$tmp" --surfaces cli mcp http --verify --output json
(cd "$tmp/docs-smoke" && bun install && bun run typecheck && bun test)
rm -rf "$tmp"
```

If this smoke requires real registry publication, do not publish. Stop and
report exact evidence plus the smallest human publish action.

## PR Requirements

- Use Graphite for branch/stack operations.
- Main agent owns all `git`/`gt` writes, commits, restacks, submits, and PR
  updates.
- Subagents must not run `git add`, `git commit`, `git push`, `gt create`,
  `gt modify`, `gt submit`, `gt restack`, merge commands, or PR mutation
  commands.
- PR titles use Conventional Commit style.
- PR bodies include context, changes, verification, risks/rollout notes, and
  `Closes: TRL-...`.
- Keep PRs draft until CI and local review are clean.
- Do not add the merge queue label.
- Do not merge.

Ready waves:

- Wave 1: PRs 1-5 (`TRL-713`, `TRL-714`, `TRL-707`, `TRL-712`, `TRL-711`).
- Wave 2: PRs 6-8 (`TRL-709`, `TRL-708`, `TRL-710`).
- Wave 3: PRs 9-11 (`TRL-704`, `TRL-706`, `TRL-705`).

After marking ready, wait about 15 minutes, then check unresolved review
threads and bot comments. Resolve all P2 and above feedback from the bottom of
the stack upward. After at most four post-ready remote-review turns, stop and
report current status to Matt.

## Linear

- Move issues to `In Progress` when starting their branches.
- Move issues to `In Review` when PRs are marked ready.
- Do not mark issues Done until after merge.
- If implementation diverges from an issue or this plan, leave a Linear comment
  explaining what changed and why.

Dependency edges expected:

- `TRL-705` is blocked by `TRL-704` and `TRL-706`.
- `TRL-711` is blocked by `TRL-712`, `TRL-713`, and `TRL-714`.
- `TRL-707` is related to `TRL-714`.

## Stop Rules

Stop and report instead of continuing if:

- A real package publish, package ownership change, token, secret, or registry
  mutation is required.
- `TRL-707` cannot be fixed without real registry publication.
- The current stack cannot be based on clean `main`.
- PR #479 or PR #447 turns out to be required for this work.
- A public API or stable release doctrine decision needs Matt's judgment beyond
  the issue/ADR scope.
- More than four post-ready remote-review turns have elapsed and P2+ feedback
  remains unresolved.

## Final Report

Report:

- Branch/PR status for all 11 issues.
- Linear status changes and dependency/link changes.
- Verification commands and summarized results.
- Local review report paths and whether the latest pass is P3-only/clean.
- Remote review status and unresolved comments.
- Whether any package publish was required or intentionally skipped.
- Confirmation that no merge queue label was added and nothing was merged.
