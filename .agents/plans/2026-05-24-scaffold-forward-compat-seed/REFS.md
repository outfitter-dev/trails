# References: scaffold forward-compat seed

## Tracked / Portable Sources

- `AGENTS.md` - repo commands, Graphite workflow, Trail rules, Warden guide,
  changeset policy, and subagent constraints.
- `.agents/plans/PLANNING.md` - goal-packet, review, source-control, tracker,
  validation, and archive preferences.
- `apps/trails/src/versions.ts` - owner of `trailsPackageVersion` and
  `ontrailsPackageRange`; current line emits `^${trailsPackageVersion}`.
- `apps/trails/src/scaffold-versions.generated.ts` - generated dependency
  version table and regeneration command note.
- `apps/trails/src/trails/create-scaffold.ts` - owns base generated files,
  package JSON generation, `.trails/.gitignore`, and scaffold write operations.
- `apps/trails/src/trails/create.ts` - outer create trail that composes
  scaffold, surfaces, verify, and README generation.
- `apps/trails/src/__tests__/create.test.ts` - scaffold assertions for package
  ranges, generated files, dry-run operations, surfaces, verify mode, and
  README/AGENTS output.
- `scripts/sync-scaffold-versions.ts` - current internal scaffold dependency
  version sync/check script; likely owner or sibling for TRL-797 helper work.
- `package.json` - root script surface for scaffold-version sync/check and the
  full `bun run check` gate.
- `docs/releases/beta-channel-policy.md` - active beta install policy:
  deliberate `@beta` or exact `1.0.0-beta.N`, no accidental latest.
- `docs/releases/stable-cutover.md` - stable release runbook; TRL-796 must add
  exact scaffold pins as a stable-cutover prerequisite.
- `docs/adr/drafts/README.md` - generated draft ADR map; use ADR tooling rather
  than hand-maintaining generated sections.
- `docs/getting-started.md` - candidate current-facing doc for the provenance
  breadcrumb contract if the executor needs a small user-visible placement.
- `.agents/plans/2026-05-23-scaffold-runway-overnight-stack/RETRO.md` -
  completed prior scaffold stack context for TRL-788/777/779/792.

## Untracked / Local-Only Sources

- `/Users/mg/Developer/outfitter/trailblazing/inbox/2026-05-24-lewis-clark-turnaround.md`
  - shared Lewis/Clark note; used to capture Matt's widened-slice preference
    and latest issue ordering context. Load-bearing details are copied into
    `PLAN.md` and this `REFS.md`.
- `/Users/mg/Developer/outfitter/trailblazing/plans/fieldwork-loop/README.md`
  - canonical planning doc for fieldwork/Forge; background only. This packet
    does not depend on that file at execution time.

## Copied Or Summarized Sources

- `PLAN.md` - summarizes the Linear issue state, candidate ranking, branch
  order, non-goals, and validation ladder.
- `RETRO.md` - records planning discoveries, including the current detached
  worktree caveat, TRL-801 supersession judgment, and Matt's widened-slice
  correction.

## Tracker Records

- TRL-796 - in-goal first branch. Exact beta package pin; stable-cutover
  prerequisite.
- TRL-798 - in-goal second branch. Minimal scaffold provenance breadcrumb.
- TRL-797 - in-goal third branch. Internal helper/check for clean scaffold
  version bumps after exact pins.
- TRL-799 - in-goal fourth branch. Draft ADR for post-1.0 scaffold
  forward-compatibility and upgrade path.
- TRL-801 - related decision issue; treat as covered/superseded by TRL-796
  unless Matt says otherwise.
- TRL-803 - separate bootstrap/worktree hook tooling lane.
- TRL-794 - separate Warden partial diagnostics lane.
- TRL-782 / TRL-783 - separate type-safety lane.
- TRL-759 - beta install policy antecedent for TRL-796.
- ADR-0047 / `docs/releases/stable-cutover.md` - stable release doctrine and
  runbook target.

## PRs / Branches

- Main baseline at planning: `2df73cc30 fix(trails): allow fieldwork lint markers (#587)`.
- Merged prerequisite stack visible in `git log`: #581, #588, #582, #583,
  #584, #585, #586, #587.
- Planned branch 1:
  `trl-796-scaffold-emits-caret-range-that-floats-past-the-beta-channel`.
- Planned branch 2:
  `trl-798-stamp-scaffold-provenance-into-generated-projects-minimal`.
- Planned branch 3:
  `trl-797-internal-helper-for-clean-ontrails-version-bumps-in-scaffold`.
- Planned branch 4:
  `trl-799-draft-adr-scaffold-forward-compatibility-upgrade-path-system`.

## Prior Plans

- `.agents/plans/2026-05-23-scaffold-runway-overnight-stack/` - current
  historical reference; prior scaffold stack is merged into main.
- `.agents/plans/2026-05-24-warden-as-coach-overnight-stack/` - current
  historical reference; Warden stack is merged into main.

## Validation Commands

- `git status --short --branch` - branch cleanliness and detached/branch state.
- `git log --oneline -8` - baseline confirmation.
- `bun test apps/trails/src/__tests__/create.test.ts` - targeted scaffold
  behavior and generated output assertions.
- `bun --cwd apps/trails test` - app package regression check.
- `bun run scaffold-versions:check` - generated scaffold version table drift.
- Targeted helper tests if TRL-797 adds a testable helper.
- `bun scripts/adr.ts map` - ADR map regeneration/check support.
- `bun scripts/adr.ts check` - ADR metadata and link validation.
- `bun run docs:links` - documentation link validation when ADR/docs change.
- `bun run format:check` - repo formatter/lint wrapper.
- `git diff --check` - whitespace/patch hygiene.
- `bun run typecheck` - TypeScript contract check.
- `bun run check` - final full repo gate before draft submission/final handoff.
