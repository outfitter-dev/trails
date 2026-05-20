# Local Review Round 3: Testing / Public API / Changesets

Date: 2026-05-19
Stack tip reviewed: `trl-116-run-examples-and-testall-across-live-version-entries`

## Scope

- Version-aware examples and `testAll`.
- Survey and guide version-entry example counts.
- Public exports for versioning helpers.
- Branch-local changeset coverage for publishable packages.

## Initial Finding

### P2: `trails guide` undercounted live version-entry examples

`buildCurrentGuideEntries()` counted only current `trail.examples`, while survey/test paths counted current examples plus live non-archived version-entry examples.

Resolution: fixed on `trl-116-run-examples-and-testall-across-live-version-entries` by exporting and reusing `countTrailExamples()` and adding a guide regression test for deprecated examples plus archived-entry exclusion.

## Verification

- `bun test apps/trails/src/__tests__/guide.test.ts` passed after the guide fix.
- `bun run --cwd apps/trails typecheck` passed after the guide fix.
- Tip focused tests passed for guide, survey-adjacent projection, core validation, version execution, topographer marker projection, `testExamples`, and `testAll`.

## Changesets

Publishable package-touching branches have branch-local changesets:

- `.changeset/trail-cli-namespace.md`
- `.changeset/trail-version-authoring-shape.md`
- `.changeset/pure-transpose-revisions.md`
- `.changeset/trail-version-markers.md`
- `.changeset/trail-version-runtime.md`
- `.changeset/trail-version-live-examples.md`

## Result

Round 3 initially found one P2. It was fixed on the tip owning branch. Latest state is clean for this lane.
