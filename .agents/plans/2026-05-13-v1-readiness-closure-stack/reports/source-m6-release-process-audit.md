# M6 Release Process And Beta-To-1.0 Cutover Audit

Date: 2026-05-12
Issue: TRL-637
Branch: `trl-637-audit-release-process-and-beta-to-10-cutover-requirements`

## Summary

The repo has a workable beta release mechanism, but it is not yet a complete
stable-cutover process.

What is solid:

- `@ontrails/*` packages are configured as a fixed Changesets group.
- Publishing is intentionally done with `bun run publish:packages`, not
  `changeset publish` or `npm publish`.
- `bun run publish:check` packs every non-private workspace in dependency order
  and verifies packed manifests do not leak `workspace:` or `catalog:` ranges.
- The publish script uses the Changesets prerelease tag while
  `.changeset/pre.json` is in prerelease mode, then falls back to `latest`
  after prerelease mode exits.

The stable cutover has four concrete gaps:

- No durable beta-to-1.0 runbook exists yet.
- No stable 1.x release doctrine ADR exists yet.
- `bunx changeset status --verbose` currently fails on stale changeset
  frontmatter for retired `@ontrails/logging`.
- The local pack check passes even though registry visibility is incomplete for
  several non-private packages.

Follow-ups filed: TRL-711, TRL-712, TRL-713, and TRL-714.

## Inventory

Primary release guidance checked:

- `AGENTS.md:271-296` documents lockstep `@ontrails/*` prerelease versioning,
  forbids `changeset publish`/`npm publish`, names `bun run publish:check` and
  `bun run publish:packages`, and says stable release starts with
  `bunx changeset pre exit`.
- `.changeset/config.json:3-10` keeps Changesets unmanaged by commits, fixes
  `@ontrails/*` together, sets public access, uses `main` as base branch, and
  updates internal dependencies at patch level.
- `.changeset/pre.json:2-3` is still in prerelease mode with tag `beta`.
- `scripts/publish.ts:4-9` states the script publishes public `@ontrails/*`
  workspaces through `bun publish`, topo-sorts workspace dependency edges, and
  enforces packed-manifest range cleanliness.
- `scripts/publish.ts:153-170` resolves the default dist-tag from
  `.changeset/pre.json` while in prerelease mode and falls back to `latest`
  outside prerelease mode.
- `scripts/publish.ts:360-445` runs `bun pm pack --dry-run`, extracts the
  packed manifest, and rejects unresolved `workspace:` or `catalog:` ranges.
- `scripts/publish.ts:448-483` publishes sequentially with
  `bun publish --access public --tag <tag>` and aborts on the first package
  failure.
- `.github/workflows/ci.yml:103-133` gates PRs with the repo-local changeset
  checker based on the immediate PR file list.
- `scripts/check-changeset-gate.ts:147-266` detects package-affecting changes
  under non-private `@ontrails/*` workspaces and requires changed changesets
  unless `release:none` is explicitly present.
- `docs/releases/beta15.md:236-250` says all `@ontrails/*` packages remain
  lockstep at `1.0.0-beta.15` and lists newly publishable packages.

Publishable workspace inventory from live package manifests:

| Package | Local version | Registry probe |
| --- | --- | --- |
| `@ontrails/cli` | `1.0.0-beta.15` | `1.0.0-beta.15` |
| `@ontrails/commander` | `1.0.0-beta.15` | Missing or inaccessible |
| `@ontrails/config` | `1.0.0-beta.15` | `1.0.0-beta.15` |
| `@ontrails/core` | `1.0.0-beta.15` | `1.0.0-beta.15` |
| `@ontrails/drizzle` | `1.0.0-beta.15` | `1.0.0-beta.15` |
| `@ontrails/hono` | `1.0.0-beta.15` | `1.0.0-beta.15` |
| `@ontrails/http` | `1.0.0-beta.15` | `1.0.0-beta.15` |
| `@ontrails/logtape` | `1.0.0-beta.15` | `1.0.0-beta.15` |
| `@ontrails/mcp` | `1.0.0-beta.15` | `1.0.0-beta.15` |
| `@ontrails/observe` | `1.0.0-beta.15` | Missing or inaccessible |
| `@ontrails/permits` | `1.0.0-beta.15` | `1.0.0-beta.15` |
| `@ontrails/store` | `1.0.0-beta.15` | `1.0.0-beta.15` |
| `@ontrails/testing` | `1.0.0-beta.15` | `1.0.0-beta.15` |
| `@ontrails/topographer` | `1.0.0-beta.15` | Missing or inaccessible |
| `@ontrails/tracing` | `1.0.0-beta.15` | `1.0.0-beta.15` |
| `@ontrails/trails` | `1.0.0-beta.15` | `1.0.0-beta.15` |
| `@ontrails/vite` | `1.0.0-beta.15` | `1.0.0-beta.15` |
| `@ontrails/warden` | `1.0.0-beta.15` | `1.0.0-beta.15` |
| `@ontrails/wayfinder` | `1.0.0-beta.15` | Missing or inaccessible |

The registry probe used `npm view <package> version --json` as a read-only
registry check. It is not a publish command and does not change the repo's Bun
publish posture.

## Current Release Mechanics

Beta flow, as documented today:

```bash
bunx changeset add
bunx changeset version
bun run publish:check
bun run publish:packages
```

The repo-specific semantics are:

- Changesets computes versions and changelogs.
- `bun run publish:check` is the pre-publish packability gate.
- `bun run publish:packages` is the only publish command.
- `.changeset/pre.json` chooses the `beta` dist-tag while prerelease mode is
  active.
- Once prerelease mode exits, `scripts/publish.ts` defaults to `latest`.

The PR-time changeset gate is useful but intentionally narrower than release
cutover:

- It protects per-PR package changes against missing changesets.
- It honors `release:none` only when no changed changeset files are present.
- It does not evaluate the full live Changesets release plan.
- It does not verify registry ownership, package availability, or dist-tag
  posture.

## Stable Cutover Runbook

This is the recommended execution order to codify in a durable runbook. Do not
run it as part of TRL-637.

### Preconditions

1. All v1 release-prep milestones are closed or have explicitly accepted
   exceptions.
2. Main is green on CI.
3. All active release-blocking PRs have merged.
4. No generated local SQLite artifacts are staged:

   ```bash
   git status --short -- .trails
   ```

5. Legacy root DB sidecars are absent or intentionally removed only if
   untracked:

   ```bash
   git status --short -- .trails/trails.db .trails/trails.db-shm .trails/trails.db-wal
   ```

6. The Changesets release plan computes:

   ```bash
   bunx changeset status --verbose
   ```

7. Every non-private `@ontrails/*` workspace has an explicit registry posture:
   existing package, first-time package creation, or intentional non-release
   exception.

### Stable Version Branch

```bash
RTK_SHIM_BYPASS=1 gt sync
RTK_SHIM_BYPASS=1 gt checkout main
RTK_SHIM_BYPASS=1 gt create trl-711-beta-to-1-release-runbook --no-interactive

bun scripts/adr.ts map
bun scripts/adr.ts check
bun run check
bun run build
bun run publish:check
bunx changeset status --verbose

bunx changeset pre exit
bunx changeset version

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

Review the generated diff before committing:

```bash
git diff -- .changeset package.json bun.lock packages apps adapters
```

Expected versioning outcomes:

- `.changeset/pre.json` should leave prerelease mode or be removed/rewritten by
  Changesets according to its stable-exit behavior.
- All fixed `@ontrails/*` packages should land on the same stable version.
- Internal package ranges should resolve to stable semver ranges after packing.
- Release notes should stop describing the current release as beta.

Commit and submit as a normal reviewable PR:

```bash
git branch --show-current
RTK_SHIM_BYPASS=1 gt modify -a -c -m "chore: version packages for 1.0.0" --no-interactive
RTK_SHIM_BYPASS=1 gt submit --draft --stack --no-edit --no-interactive
```

Keep the PR draft until CI is green and review is complete.

### Publish After Merge

After the version PR merges:

```bash
RTK_SHIM_BYPASS=1 gt sync
RTK_SHIM_BYPASS=1 gt checkout main

bun run publish:check
bun run publish:packages
```

Post-publish verification should check every non-private `@ontrails/*`
workspace:

```bash
npm view @ontrails/core version --json
npm view @ontrails/core dist-tags --json
```

Repeat for every published package or use a repo script once TRL-714 lands.

If a package publish fails mid-sequence:

1. Stop immediately. The script already aborts on first package failure.
2. Record the last successfully published package and version.
3. Do not rerun the whole matrix blindly.
4. Use the script's `--only <name[,name]>` support only after confirming the
   already-published packages have the expected version and dist-tag.
5. File a release incident note with the package, version, command, failure
   output, and chosen resume set.

## Findings

### F1: Stable cutover lacks a durable runbook

Current release guidance documents beta mechanics and the existence of
`bunx changeset pre exit`, but not a complete stable cutover sequence with
preconditions, post-publish verification, and partial-publish handling.

Impact: stable release execution still depends on operator memory and this
audit packet.

Follow-up: TRL-711.

### F2: Stable 1.x doctrine is not captured in an ADR

The repo needs a stable-line decision record before 1.0: whether lockstep
continues, how breaking changes are handled, how retired package names are
managed after stable, how generated apps stay installable, and what dist-tag
policy governs future releases.

Impact: without a durable ADR, release tooling and docs can drift after the
first stable cut.

Follow-up: TRL-712.

### F3: Changesets release-plan computation is currently blocked

Command:

```bash
bunx changeset status --verbose
```

Result:

```text
Found changeset logtape-observe-target for package @ontrails/logging which is not in the workspace
```

The offending changeset is `.changeset/logtape-observe-target.md`, which still
contains:

```text
"@ontrails/logging": patch
```

Impact: stable cutover cannot safely run `bunx changeset pre exit` and
`bunx changeset version` until stale frontmatter is repaired or removed.

Follow-up: TRL-713.

### F4: Packability passes while registry readiness is incomplete

Command:

```bash
bun run publish:check
```

Result: passed for every non-private packable workspace.

Read-only registry probes still reported these packages as missing or
inaccessible at `1.0.0-beta.15`:

- `@ontrails/commander`
- `@ontrails/observe`
- `@ontrails/topographer`
- `@ontrails/wayfinder`

Impact: local tarball cleanliness is necessary but not sufficient. A generated
app or release note can reference a package that passes local pack checks but
is not installable from the registry.

Follow-up: TRL-714. TRL-707 remains the generated-project install blocker for
the specific `@ontrails/commander` symptom.

## Recommended Stable Doctrine ADR Shape

The stable release ADR should answer these decisions explicitly:

1. Package versioning: whether `@ontrails/*` remains fixed/lockstep for the
   whole 1.x line.
2. Dist-tags: `latest` for stable, prerelease tags only for explicit future
   prerelease channels.
3. Breaking changes: major-only after 1.0 unless an ADR defines an exception.
4. Package retirements: package rename/removal must include migration docs,
   deprecation posture, generated app updates, and release-note callouts.
5. Generated apps: current stable scaffold dependencies must be installable
   from the public registry.
6. Changelogs: package changelogs must include user-visible API, package, and
   surface changes for the package that ships them.
7. Publication: Changesets owns version/changelog calculation; `bun run
   publish:packages` owns publication.
8. Recovery: partial-publish handling must be documented and must use explicit
   resume sets.
9. Governance: release PRs should cite the ADR and include the release
   preflight checklist output.

## Filed Follow-Ups

| Issue | Priority | Purpose |
| --- | --- | --- |
| [TRL-711](https://linear.app/outfitter/issue/TRL-711/codify-the-beta-to-10-release-runbook) | High | Codify the beta-to-1.0 release runbook. |
| [TRL-712](https://linear.app/outfitter/issue/TRL-712/author-stable-release-doctrine-adr-for-the-1x-line) | High | Author the stable 1.x release doctrine ADR. |
| [TRL-713](https://linear.app/outfitter/issue/TRL-713/repair-stale-changesets-references-before-stable-cutover) | High | Repair stale Changesets references before stable cutover. |
| [TRL-714](https://linear.app/outfitter/issue/TRL-714/add-registry-availability-and-dist-tag-release-preflights) | High | Add registry availability and dist-tag release preflights. |

## Acceptance Check

- Changesets state inventoried: yes.
- Lockstep versioning inventoried: yes.
- Dist-tag policy inventoried: yes.
- Publish script inventoried: yes.
- CI gates inventoried: yes.
- Beta-to-stable command order recommended: yes.
- Stable release doctrine ADR shape recommended: yes.
- Release was not run: yes.
- Follow-up issues filed: TRL-711, TRL-712, TRL-713, TRL-714.
