# Local Review Round 6: Post-Fix Testing / Public API / Changesets

Date: 2026-05-19
Stack tip reviewed: `trl-116-run-examples-and-testall-across-live-version-entries`

## Result

No P0/P1/P2 findings.

No P3 findings.

The prior round-3 P2 is resolved: `trails guide` and survey counts now include live historical version-entry examples and exclude archived entries.

## Scope Reviewed

- Examples and `testAll` across current plus live historical version entries.
- Public API exports for versioning helpers and projected graph types.
- Branch-local changesets for publishable `@ontrails/*` package changes.
- Publish guidance wording around Bun publish scripts and forbidden publish paths.

## Evidence

### Examples and `testAll`

- `packages/testing/src/effective-examples.ts:370` builds example targets from current trail examples, and `packages/testing/src/effective-examples.ts:387` iterates `trail.versions`; `packages/testing/src/effective-examples.ts:390` skips archived entries, while non-archived entries are targeted with `version` at `packages/testing/src/effective-examples.ts:398`.
- `packages/testing/src/examples.ts:187` executes the owning trail and passes the target version into `executeTrail` at `packages/testing/src/examples.ts:190`.
- `packages/testing/src/contracts.ts:63` derives contract entries with `deriveTrailExampleTargets`, and `packages/testing/src/contracts.ts:91` executes with the target version passed at `packages/testing/src/contracts.ts:95`.
- `packages/testing/src/all.ts:87` wires `testExamples`, and `packages/testing/src/all.ts:89` wires `testContracts`, so `testAll` inherits the version-aware target selection.
- `packages/testing/src/__tests__/examples.test.ts:499` defines a versioned example trail with current, revision, deprecated fork, and archived entries; the archived entry is marked at `packages/testing/src/__tests__/examples.test.ts:552`. The assertions at `packages/testing/src/__tests__/examples.test.ts:565` verify the current blaze ran twice and the fork blaze once, which covers current plus live historical entries while excluding archived.
- `packages/testing/src/__tests__/all.test.ts:161` defines the `testAll` versioned trail; the archived invalid entry at `packages/testing/src/__tests__/all.test.ts:204` would fail if executed. The assertions at `packages/testing/src/__tests__/all.test.ts:362` verify only current plus live non-archived entries ran through examples and contracts.
- `packages/testing/src/__tests__/contracts.test.ts:215` defines versioned contract coverage; the archived entry starts at `packages/testing/src/__tests__/contracts.test.ts:258`, and the assertions at `packages/testing/src/__tests__/contracts.test.ts:413` verify current plus live historical contract outputs only.

### Guide, Survey, and Archived/Deprecated Behavior

- `apps/trails/src/trails/topo-reports.ts:239` counts live version-entry examples and skips archived entries at `apps/trails/src/trails/topo-reports.ts:242`; `apps/trails/src/trails/topo-reports.ts:250` adds that live historical count to current examples.
- `apps/trails/src/trails/topo-read-support.ts:120` builds guide entries, and `apps/trails/src/trails/topo-read-support.ts:133` now uses the shared `countTrailExamples` helper.
- `apps/trails/src/__tests__/guide.test.ts:88` covers the prior P2 directly: deprecated version-entry examples count, archived version-entry examples do not, and the expected guide count is `1` at `apps/trails/src/__tests__/guide.test.ts:123`.
- `apps/trails/src/__tests__/survey.test.ts:345` covers survey list/brief counting with deprecated plus archived historical entries; the expected survey count is `1` at `apps/trails/src/__tests__/survey.test.ts:381`.
- `apps/trails/src/__tests__/survey.test.ts:501` covers detail projection for version-entry examples, including provenance `trail.versions.examples` at `apps/trails/src/__tests__/survey.test.ts:510`.
- `packages/core/src/trail.ts:209` defines archived entries as `status.state === 'archived'`; `packages/core/src/trail.ts:213` derives supported versions and excludes archived entries at `packages/core/src/trail.ts:222`.
- `packages/core/src/version-resolution.ts:277` rejects archived version resolution with an unsupported-version error, while `packages/core/src/version-resolution.ts:284` marks deprecated live entries as deprecated without skipping them.
- `packages/topographer/src/versioning.ts:87` projects version-entry examples with provenance, `packages/topographer/src/versioning.ts:96` records per-entry example counts, and `packages/topographer/src/versioning.ts:244` projects `supports` from `deriveSupportedTrailVersions`, so archived entries remain visible history in `versions` while excluded from live `supports`.
- `packages/topographer/src/__tests__/derive.test.ts:287` verifies historical projection, with `supports: [2, 3]` at `packages/topographer/src/__tests__/derive.test.ts:291`, archived version `1` retained as archived history at `packages/topographer/src/__tests__/derive.test.ts:295`, and deprecated version-entry example provenance verified at `packages/topographer/src/__tests__/derive.test.ts:304`.

### Public API Exports

- `packages/core/src/index.ts:162` exports version support helpers, marker helpers, and version-resolution helpers; associated version types are exported at `packages/core/src/index.ts:189` and `packages/core/src/index.ts:210`.
- `packages/topographer/src/index.ts:10` exports version marker collection/resolution helpers, `packages/topographer/src/index.ts:15` exports their public types, and `packages/topographer/src/index.ts:59` exports `TopoGraphVersionEntry`.
- `packages/testing/src/index.ts:1` continues to export the public testing surface (`testAll`, `testExamples`, `testContracts`, etc.); the new version-target derivation remains internal to the testing package.

### Changesets and Publish Guidance

- Publishable package changes were present under `apps/trails`, `packages/core`, `packages/testing`, `packages/topographer`, and `packages/warden`. Branch-local changesets cover those publishable package changes:
  - `.changeset/pure-transpose-revisions.md:2` covers `@ontrails/core`.
  - `.changeset/trail-cli-namespace.md:2` covers `@ontrails/trails`, `.changeset/trail-cli-namespace.md:3` covers `@ontrails/topographer`, and `.changeset/trail-cli-namespace.md:4` covers `@ontrails/warden`.
  - `.changeset/trail-version-authoring-shape.md:2` covers `@ontrails/core`, and `.changeset/trail-version-authoring-shape.md:3` covers `@ontrails/topographer`.
  - `.changeset/trail-version-live-examples.md:2` covers `@ontrails/core`, `.changeset/trail-version-live-examples.md:3` covers `@ontrails/testing`, `.changeset/trail-version-live-examples.md:4` covers `@ontrails/topographer`, and `.changeset/trail-version-live-examples.md:5` covers `@ontrails/trails`.
  - `.changeset/trail-version-markers.md:2` covers `@ontrails/core`, and `.changeset/trail-version-markers.md:3` covers `@ontrails/topographer`.
  - `.changeset/trail-version-runtime.md:2` covers `@ontrails/core`.
- `AGENTS.md:270` says Changesets are for versioning/changelogs, not `changeset publish`, and explains Bun-based publishing. `AGENTS.md:282` uses `bun run publish:check`, and `AGENTS.md:283` uses `bun run publish:packages`.
- The goal packet keeps the same rule: `.agents/plans/2026-05-19-trail-versioning-m1-m2/GOAL.md:65` requires `bun run publish:check` / `bun run publish:packages`, and `.agents/plans/2026-05-19-trail-versioning-m1-m2/GOAL.md:66` forbids `npm publish` / `changeset publish` guidance.
- `git grep -n "npm publish\\|changeset publish" HEAD -- ':*.md' ':*.ts' ':*.json'` only found explicit prohibition or "do not use" wording, not new positive guidance to publish with npm or Changesets.

## Commands Run

- `git diff --check main...HEAD` - passed with no output.
- `bun test apps/trails/src/__tests__/guide.test.ts apps/trails/src/__tests__/survey.test.ts packages/testing/src/__tests__/examples.test.ts packages/testing/src/__tests__/contracts.test.ts packages/testing/src/__tests__/all.test.ts packages/topographer/src/__tests__/derive.test.ts` - passed, 154 tests, 0 failures.
- `git diff --name-only main...HEAD -- .changeset` - confirmed six branch-local changesets listed above.
- `jq -r 'select(.private != true) | .name' packages/*/package.json apps/trails/package.json apps/trails-demo/package.json` - confirmed publishable `@ontrails/*` workspace package names.

## Notes

- I did not run publish or registry mutation commands.
- I did not mutate source files or run git/gt write operations.
- Final `git status --short --branch` showed pre-existing/report-lane dirt outside this report path; I did not modify those files.
