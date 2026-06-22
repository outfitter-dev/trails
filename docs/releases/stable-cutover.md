# Stable Cutover Runbook

This runbook is the operator checklist for leaving the beta prerelease line and publishing the first stable 1.x Trails release.

It is governed by [ADR-0047: Stable Release Line Discipline](../adr/0047-stable-release-line-discipline.md). The short version: public `@ontrails/*` packages stay lockstep for 1.x, Changesets computes versions and changelogs, Bun publishes packages, generated apps must install from the public registry, and partial publishes are handled as release incidents.

Do not run this from an in-progress feature stack. The versioning PR and the publish step are separate operations.

## Release Boundaries

There are two distinct phases:

| Phase | What happens | Where |
| --- | --- | --- |
| Version PR | Exit prerelease mode, compute stable versions/changelogs, review the diff, and merge. | A normal Graphite branch and PR |
| Publish | Publish already-merged package contents and verify registry/dist-tag state. | Clean `main` after the version PR merges |

Never publish from an unmerged version PR. Never use `changeset publish`, `npm publish`, or ad hoc package publication for the normal stable cutover.

Generated release PRs are policy-gated by labels. Source PRs that introduced consumed changesets should carry `stack:boundary` before the stable version PR is expected to reach `publish:auto`. Missing source evidence or missing `stack:boundary` routes publication to the protected manual environment; unknown/conflicting managed labels, registry contradictions, or `publish:block` stop the workflow. `publish:none` is only for generated release PRs and requires an audit reason in the release PR body or comments.

## Preconditions

Before creating the version PR:

1. All v1 release-prep blockers are merged or have explicit accepted
   exceptions.
2. `main` is current and green in CI.
3. No old release-blocking stack is still open underneath the stable branch.
4. Pending force audit events are resolved before the version PR leaves draft:

   ```bash
   bun apps/trails/bin/trails.ts compile --root-dir apps/trails --module ./src/app.ts --permit '{"id":"stable-cutover","scopes":["topo:write"]}'
   bun apps/trails/bin/trails.ts diff --forces --root-dir apps/trails --module ./src/app.ts
   bun apps/trails/bin/trails.ts doctor --root-dir apps/trails --module ./src/app.ts
   bun apps/trails/bin/trails.ts warden --pre-push --depth all --lock skip --root-dir apps/trails --apps ./src/app.ts
   ```

   The compile command writes topo artifacts, so it requires an inline permit
   with the `topo:write` scope. Run the gate from the repo root, but point the
   topo commands at the Trails app root with `--root-dir apps/trails --module
   ./src/app.ts`; passing a repo-root module path such as
   `apps/trails/src/app.ts` does not exercise the CLI's fresh app-loading path.
   The repo ships more than one app module (`apps/trails` and
   `apps/trails-demo`), so pass an explicit app selector: `--module` for the
   compile, diff, and doctor commands, and `--apps` for Warden. Without an app
   selector, discovery finds multiple candidates and aborts before any evidence
   is produced. `trails diff --forces` compares against the saved
   `apps/trails/.trails/topo.lock`, so run `trails compile` first; without a
   saved TopoGraph the diff fails with `NotFoundError` before any force evidence
   can be collected. The diff and doctor output are the saved force-audit
   evidence for the release gate.
   `pending-force` is a topo-aware rule, so the Warden run must reach `topo` or
   `all` depth to surface live topo-derived force warnings. The bare `--pre-push`
   preset resolves Warden at `project` depth and never runs topo resolution, so
   `--depth all` is required here for the Warden cross-check. Use `--lock skip`
   so Warden checks the live app topology without turning saved force annotations
   into a drift blocker. A clean Warden run is not a substitute for the saved
   `apps/trails/.trails/topo.lock` evidence above. The v1 stable cutover default
   is zero pending force events. If a force event must remain for the stable
   version PR, the PR body must name the exception owner, forced entity, reason,
   and planned resolution before review starts. Warden `pending-force` output is
   a release-review warning, not an automatic exception.

   `trails compile` can write generated topo evidence files. Remove them before
   continuing to the clean-main preconditions unless the release branch is
   intentionally updating those artifacts:

   ```bash
   rm -f apps/trails/.trails/topo.lock apps/trails/.trails/trails.lock
   git status --short -- apps/trails/.trails/topo.lock apps/trails/.trails/trails.lock
   ```

5. The stable release doctrine ADR exists and is accepted.
6. Registry posture is known for every non-private public `@ontrails/*`
   workspace:

   ```bash
   bun run publish:registry-check
   ```

   First-time public packages can be reported as first-time package
   candidates during this read-only probe. That is expected before their first
   publication; after publishing, use `bun run publish:registry-check:published`
   to require every package and dist-tag to exist.

7. The local package tarballs are clean:

   ```bash
   bun run publish:check
   ```

8. The Changesets release plan computes:

   ```bash
   bunx changeset status --verbose
   ```

9. Scaffolded project dependency pins are ready for the target package line:

   ```bash
   bun run scaffold-versions:check
   ```

   Generated apps must emit exact `@ontrails/*` pins for the current
   `@ontrails/trails` package version, not caret prerelease ranges. The stable
   version PR should update that package version through Changesets before the
   post-version scaffold inspection below.

10. No generated local SQLite artifacts are staged:

    ```bash
    git status --short -- .trails .trails-tmp
    git status --short -- .trails/state .trails/cache '.trails/trails.db*'
    ```

    Current `trails.db` state lives in the per-user Trails state store and
    cannot be staged from the repo. Treat `.trails/state`, `.trails/cache`, or
    `.trails/trails.db*` as legacy repo-local residue; clean it with
    `trails dev reset --yes` before release.

11. The ADR and docs checks pass:

    ```bash
    bun scripts/adr.ts map
    bun scripts/adr.ts check
    bun run format:check
    ```

If any precondition fails, stop and fix that issue in its own branch before starting the stable version PR.

## Version PR

Start from clean, synced `main`:

```bash
gt sync
gt checkout main
git status --short --branch
```

Create a dedicated branch:

```bash
gt create chore/version-packages-for-1-0-0 --no-interactive
```

Run the pre-version checks:

```bash
bun scripts/adr.ts map
bun scripts/adr.ts check
bun apps/trails/bin/trails.ts compile --root-dir apps/trails --module ./src/app.ts --permit '{"id":"stable-cutover","scopes":["topo:write"]}'
bun apps/trails/bin/trails.ts diff --forces --root-dir apps/trails --module ./src/app.ts
bun apps/trails/bin/trails.ts doctor --root-dir apps/trails --module ./src/app.ts
bun apps/trails/bin/trails.ts warden --pre-push --depth all --lock skip --root-dir apps/trails --apps ./src/app.ts
bun apps/trails/bin/trails.ts release smoke --check wayfinder-dogfood
bun run check
bun run build
bun run publish:check
bun run publish:registry-check
bunx changeset status --verbose
```

`trails compile` can write `apps/trails/.trails/topo.lock` and `apps/trails/.trails/trails.lock`. If the version PR is not intentionally updating those generated artifacts, remove the evidence files before continuing:

```bash
rm -f apps/trails/.trails/topo.lock apps/trails/.trails/trails.lock
git status --short -- apps/trails/.trails/topo.lock apps/trails/.trails/trails.lock
```

Run a registry-backed generated-app smoke before exiting prerelease mode. This proves the current published prerelease package set and the generator still agree:

```bash
tmp=$(mktemp -d /tmp/trails-preversion-smoke.XXXXXX)
cache=$(mktemp -d /tmp/bun-cache-preversion.XXXXXX)

bun apps/trails/bin/trails.ts create docs-smoke \
  --dir "$tmp" \
  --surfaces cli mcp http \
  --verify \
  --output json \
  --permit '{"id":"stable-cutover-smoke","scopes":["project:write","entity:write"]}'

(
  cd "$tmp/docs-smoke"
  BUN_INSTALL_CACHE_DIR="$cache" bun install
  bun run typecheck
  bun test
)
```

Exit prerelease mode and compute the stable versions:

```bash
bunx changeset pre exit
bunx changeset version
bun run scaffold-versions:sync
```

Review the generated diff before committing:

```bash
git diff -- .changeset package.json bun.lock packages adapters apps docs
```

Expected outcomes:

- `.changeset/pre.json` leaves prerelease mode or is removed/rewritten by
  Changesets according to its stable-exit behavior.
- All public non-private `@ontrails/*` packages land on the same stable
  version.
- The scaffold-version helper has rewritten generated dependency versions and
  verified generated `@ontrails/*` pins match that stable version exactly.
- Internal package ranges pack without unresolved `workspace:` or `catalog:`
  ranges.
- Changelogs and release notes stop describing the release as beta.
- Generated app dependency ranges point at exact intended stable package
  versions.
  The post-publish smoke below proves those stable ranges are installable from
  the registry after publication.

Run the full version-PR gate:

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
bun run publish:registry-check
git diff --check
```

Generate a fresh app outside the monorepo and inspect its package ranges:

```bash
tmp=$(mktemp -d /tmp/trails-stable-smoke.XXXXXX)

bun apps/trails/bin/trails.ts create docs-smoke \
  --dir "$tmp" \
  --surfaces cli mcp http \
  --verify \
  --output json
```

Do not run the install-backed registry smoke on the version PR branch after `bunx changeset version`. At that point generated apps request the intended stable range, but the stable packages are not on the public registry until the version PR merges and the publish step completes.

Capture the generated `package.json` dependency ranges in the PR body. Remove the temp project after recording the evidence.

Commit and submit:

```bash
git branch --show-current
gt modify -a -c -m "chore: version packages for 1.0.0" --no-interactive
gt submit --draft --stack --no-edit --no-interactive
```

Keep the PR draft until CI is green and review is complete. The PR body should include:

- link to ADR-0047;
- the intended stable version;
- intended generated release PR labels, including `channel:stable`, release
  size, and whether publication should be `publish:auto` or `publish:manual`;
- `stack:boundary` evidence for source PRs that introduced consumed changesets,
  or an explicit reason the release should use the protected manual publish
  path;
- `bunx changeset status --verbose` summary;
- `bun run publish:check` result;
- `bun run publish:registry-check` result;
- pending-force gate evidence from `trails diff --forces`, `trails doctor`,
  and Warden `pending-force` status, or a named exception with owner, forced
  entity, reason, and planned resolution;
- pre-version fresh-start generated-app smoke evidence;
- generated stable dependency range evidence from the post-version scaffold;
- a statement that no publish command was run from the PR branch.

## Publish After Merge

Only publish after the version PR has merged.

Start from clean, synced `main`:

```bash
gt sync
gt checkout main
git status --short --branch
```

Confirm `main` contains the merged version commit and CI is green.

Run final local pre-publish checks:

```bash
bun run publish:check
bun run publish:registry-check
```

Publish with the repo script:

```bash
bun run publish:packages
```

The publish script discovers non-private workspaces, topo-sorts by workspace dependency edges, runs `bun publish --access public --tag <tag>`, and uses `latest` outside Changesets prerelease mode.

Do not replace this with `npm publish`. Do not run `changeset publish`.

## Post-Publish Verification

After publish, require every public package and expected dist-tag to be visible:

```bash
bun run publish:registry-check:published
```

Spot-check representative packages directly when debugging:

```bash
npm view @ontrails/core version --json
npm view @ontrails/core dist-tags --json
npm view @ontrails/commander version --json
npm view @ontrails/commander dist-tags --json
```

Then rerun the fresh generated-app smoke from a clean cache so the proof comes from the registry, not local workspace links:

```bash
tmp=$(mktemp -d /tmp/trails-stable-smoke.XXXXXX)
cache=$(mktemp -d /tmp/bun-cache-stable.XXXXXX)

bun apps/trails/bin/trails.ts create docs-smoke \
  --dir "$tmp" \
  --surfaces cli mcp http \
  --verify \
  --output json

(
  cd "$tmp/docs-smoke"
  BUN_INSTALL_CACHE_DIR="$cache" bun install
  bun run typecheck
  bun test
)
```

Record:

- generated `@ontrails/*` dependency ranges;
- selected `@ontrails/*` versions in `bun.lock`;
- `bun run typecheck` result;
- `bun test` result;
- final registry/dist-tag check result.

## Partial-Publish Recovery

If `bun run publish:packages` fails after publishing one or more packages, stop immediately.

Create a release incident note with:

- exact command;
- failure output;
- intended version and dist-tag;
- packages already published at that version;
- package that failed;
- package that should publish next;
- selected resume set.

Verify already-published packages before retrying:

```bash
bun run publish:registry-check:published
```

If that check fails because the release is incomplete, use targeted read-only registry probes for the packages already reported as published. Do not mutate dist-tags to hide an incomplete release.

Resume only with an explicit package set after confirming which packages are already present:

```bash
bun run publish:packages -- --only @ontrails/package-a,@ontrails/package-b
```

Rerun the full post-publish verification after the resume completes.

## Stable Release Completion

The stable release is complete only when:

- the version PR has merged;
- `bun run publish:packages` completed or a documented partial-publish resume
  completed;
- `bun run publish:registry-check:published` passes;
- fresh generated-app install, typecheck, and tests pass from a clean cache;
- release notes and package changelogs reflect the stable release;
- no generated `.trails` or `.trails-tmp` runtime state is staged;
- the release issue or project update links to the final evidence.
