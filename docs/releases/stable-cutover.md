# Stable Cutover Runbook

This runbook is the operator checklist for leaving the beta prerelease line and publishing the first normal Trails release, `0.2.0`, on `latest`.

It is governed by [ADR-0047: Stable Release Line Discipline](../adr/0047-stable-release-line-discipline.md). Public `@ontrails/*` packages stay lockstep through 0.x and the eventual 1.x line. Changesets computes versions and changelogs, Bun packs and validates package tarballs, npm publishes them through the repo-owned flow, generated apps must install from the public registry, and partial publishes are handled as release incidents.

`stable` describes the distribution channel, without a prerelease suffix. The API remains pre-1.0: patches preserve compatibility, while minor releases may require consumer migrations. The release owner must separately approve 1.0.

Do not run this from an in-progress feature stack. The versioning PR and the publish step are separate operations.

## Release Boundaries

There are two distinct phases:

| Phase | What happens | Where |
| --- | --- | --- |
| Version PR | Prepare the approved package versions/changelogs, review the diff, and merge. | A normal Graphite branch and PR |
| Publish | Publish already-merged package contents and verify registry/dist-tag state. | Clean `main` after the version PR merges |

Never publish from an unmerged version PR. Never use `changeset publish`, a direct `npm publish`, or ad hoc package publication for the normal stable cutover.

Generated release PRs are policy-gated by labels. Source PRs that introduced consumed changesets should carry `stack:boundary` before the stable version PR is expected to reach `publish:auto`. Missing source evidence or missing `stack:boundary` requires the manual publication path: an explicit workflow dispatch with `publish=true`, followed by approval in the protected `npm` environment. Unknown/conflicting managed labels, registry contradictions, or `publish:block` stop the workflow. `publish:none` is only for generated release PRs and requires an audit reason in the release PR body or comments.

## Approved initial 0.x transition

The September 2026 decision supersedes the prepared but unpublished `1.0.0` source release and the generated `1.0.1` proposal. The reviewed version PR targets `0.2.0`, the next minor after the pre-beta `0.1.0` source baseline; it consumes the pending correction changesets and regenerates the scaffold pins, plugin framework metadata, and lockfiles. Existing beta changelog entries and published versions remain historical evidence.

This transition must use `channel:stable` and `publish:manual`. It is a descending version reset, so it carries no `release:patch`, `release:minor`, or `release:major` label. Registry preflight recognizes only the public Trails family's initial `latest` move from `1.0.0-beta.N` to `0.2.0`. Other descending tags remain blockers, and a matching tag without exact-version proof still fails the post-publication check.

The manual version branch is `trl-1347-retarget-the-prepared-trails-package-family-to-010`. Publication discovery recognizes it only after it targets `main`, with the labels above and the exact `1.0.0` to `0.2.0` transition. Dispatch the manual Release workflow while the merged version commit remains at the head of `main`, after that commit's CI passes. Hold subsequent merges until publication and registry verification finish: discovery uses the current commit and its predecessor, and later changesets can restart version preparation.

The generated Homebrew formula uses `version_scheme 1` so `brew upgrade trails` recognizes `0.2.0` as an upgrade from the old beta line. Keep that scheme on future releases; removing it would make already-installed versions sort ahead again. This is Homebrew's supported [version scheme change](https://docs.brew.sh/Formula-Cookbook#version-scheme-changes), and the formula generator owns it.

The prerelease exit already happened in source. Do not run `changeset pre exit` again, merge the obsolete `1.0.1` proposal, or run ordinary version generation over the unpublished `1.0.0` baseline. Use the reviewed 0.2.0 version PR and its recorded generation evidence. The general version-PR procedure below describes an increasing release or a future prerelease exit.

After publication, use the [consumer migration guide](./migrate-to-0x.md) to preview and apply the disposable manifest bridge. Existing beta ranges cannot resolve downward to `0.2.0`; update their declared sources and let Bun regenerate its lockfile. Release completion requires fresh consumer installation proof against npm, after all 23 packages resolve at the new version.

## Preconditions

Before creating the version PR:

1. All v1 release-prep blockers are merged or have explicit accepted
   exceptions.
2. `main` is current and green in CI.
3. No old release-blocking stack is still open underneath the stable branch.
4. Pending force audit events are resolved before the version PR leaves draft:

   ```bash
   bun apps/trails/bin/trails.ts compile --root-dir . --app trails --permit '{"id":"stable-cutover","scopes":["topo:write"]}'
   bun apps/trails/bin/trails.ts diff --forces --root-dir apps/trails --module ./src/app.ts
   bun apps/trails/bin/trails.ts doctor --root-dir apps/trails --module ./src/app.ts
   bun apps/trails/bin/trails.ts warden --pre-push --depth all --lock skip --root-dir . --app trails
   ```

   Compile writes the selected app's `trails.lock`, so it requires an inline
   permit with the `topo:write` scope. From this configured workspace root,
   `--app trails` selects `apps/trails`, enforces the configured topo-name
   binding, and never writes an aggregate root lock. The remaining topo commands
   still point at the Trails app root with `--root-dir apps/trails --module
   ./src/app.ts`; passing a repo-root module path such as
   `apps/trails/src/app.ts` does not exercise the CLI's fresh app-loading path.
   Warden derives the app catalog from root `workspace.apps` and narrows
   topo-aware checks with `--app trails`. `trails diff --forces` compares
   against the saved
   `apps/trails/trails.lock`, so run `trails compile` first; without a
   saved TopoGraph the diff fails with `NotFoundError` before any force evidence
   can be collected. The diff and doctor output are the saved force-audit
   evidence for the release gate.
   `pending-force` is a topo-aware rule, so the Warden run must reach `topo` or
   `all` depth to surface live topo-derived force warnings. The bare `--pre-push`
   preset resolves Warden at `project` depth and never runs topo resolution, so
   `--depth all` is required here for the Warden cross-check. Use `--lock skip`
   so Warden checks the live app topology without turning saved force annotations
   into a drift blocker. A clean Warden run is not a substitute for the saved
   `apps/trails/trails.lock` evidence above. The v1 stable cutover default
   is zero pending force events. If a force event must remain for the stable
   version PR, the PR body must name the exception owner, forced entity, reason,
   and planned resolution before review starts. Warden `pending-force` output is
   a release-review warning, not an automatic exception.

   `trails compile --app trails` writes the committed
   `apps/trails/trails.lock`. Review any diff and keep the artifact aligned;
   never replace it with a repository-root aggregate lock.

5. The stable release doctrine ADR exists and is accepted.
6. Registry posture is known for every non-private public `@ontrails/*`
   workspace:

   ```bash
   bun run publish:registry-check
   ```

   This is the pre-publish readiness probe. It proves the registry is reachable
   and the expected dist-tag is not ahead of the repo target. It can pass while
   the tag still points at the previous published version, and first-time public
   packages can be reported as first-time package candidates. After publishing,
   use `bun run publish:registry-check:published` to require every package to
   expose exact-version metadata or equivalent consumer package-fetch proof and
   every dist-tag to match the repo target.

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
gt create chore/release/version-packages --no-interactive
```

Run the pre-version checks:

```bash
bun scripts/adr.ts map
bun scripts/adr.ts check
bun apps/trails/bin/trails.ts compile --root-dir . --app trails --permit '{"id":"stable-cutover","scopes":["topo:write"]}'
bun apps/trails/bin/trails.ts diff --forces --root-dir apps/trails --module ./src/app.ts
bun apps/trails/bin/trails.ts doctor --root-dir apps/trails --module ./src/app.ts
bun apps/trails/bin/trails.ts warden --pre-push --depth all --lock skip --root-dir . --app trails
bun apps/trails/bin/trails.ts release smoke --check wayfinder-dogfood
bun run check
bun run build
bun run publish:check
bun run publish:registry-check
bunx changeset status --verbose
```

`trails compile --app trails` writes the committed `apps/trails/trails.lock`. Review any diff and keep the artifact aligned; never remove it as temporary evidence or replace it with a repository-root aggregate lock.

Run a registry-backed generated-app smoke before changing versions. This proves the currently published package set and the generator still agree:

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

Exit prerelease mode only when `.changeset/pre.json` records an active prerelease, then compute the next normal versions:

```bash
# Only for an active prerelease exit; skip on the normal 0.x line.
bunx changeset pre exit
bun run version:packages
bun run scaffold-versions:sync
```

Review the generated diff before committing:

```bash
git diff -- .changeset package.json bun.lock packages adapters apps docs plugin
```

Expected outcomes:

- `.changeset/pre.json` leaves prerelease mode or is removed/rewritten by
  Changesets according to its stable-exit behavior.
- All public non-private `@ontrails/*` packages land on the same stable
  version.
- The Trails skill's `metadata.trails.version` matches `@ontrails/core`;
  the independent plugin version remains unchanged.
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
  --output json \
  --permit '{"id":"stable-cutover-smoke","scopes":["project:write","entity:write"]}'
```

Do not run the install-backed registry smoke on the version PR branch after `bun run version:packages`. At that point generated apps request the intended stable range, but the stable packages are not on the public registry until the version PR merges and the publish step completes.

Capture the generated `package.json` dependency ranges in the PR body. Remove the temp project after recording the evidence.

Commit and submit:

```bash
git branch --show-current
gt modify -a -c -m "chore(release): version packages" --no-interactive
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

The normal publication path is the GitHub release workflow after the generated version PR merges. `publish:auto` uses the `npm-auto` environment when release evidence is complete. `publish:manual` requires an explicit Release workflow dispatch on `main` with `publish=true` before the protected `npm` environment approval applies; merging the version PR does not start that manual publish job. Both jobs publish through npm trusted publishing and produce the repository deployment record.

When merge authority excludes publication and tags, verify the live policy reports `decision=manual` and `should_publish=true`, with the intended stable versions unpublished and the intended Git tag and GitHub release absent. The manual label alone does not hold back release assets or GitHub release creation when the registry already matches the release: those jobs may run with `should_publish=false`. Stop for a scoped authority decision if the registry is already complete or contradicts the intended unpublished state.

After the GitHub release assets are published and validated, the release workflow calls **Publish Homebrew** for that exact tag. The handoff also runs after a successful recovery release when npm publication jobs were intentionally skipped. It requires the GitHub release job to succeed and the run to remain uncancelled. That workflow validates the already published tag and its complete checksum-backed asset set before it checks out `outfitter-dev/homebrew-tap`. It then opens or updates a reviewable tap PR. The tap PR is deliberately not auto-merged: completion requires review, merge, and a clean install or upgrade verification from the tap.

Use clean, synced `main` for final read-only verification:

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

`publish:registry-check` is the readiness check before mutation. It should make registry drift visible, but it does not require the target version to be published yet. The strict equality check is the post-publish gate below.

The publish script discovers non-private workspaces, topo-sorts by workspace dependency edges, packs and validates each workspace with Bun, publishes the tarball with npm, and uses `latest` outside Changesets prerelease mode. GitHub Actions passes `--trusted-publishing`, which requires an OIDC-capable npm CLI and the package's configured trusted publisher.

Use `bun run publish:packages` locally only for explicit bootstrap or incident recovery. Do not replace it with a direct `npm publish`. Do not run `changeset publish`.

### First-Time Package Bootstrap

npm requires the package to exist before its trusted publisher can be configured. Bootstrap only the new package with authenticated local tooling, then enroll and verify its trusted publisher before retrying the GitHub release:

```bash
bun run publish:packages -- --only @ontrails/<package> --tag latest
npx npm@11.18.0 trust github @ontrails/<package> \
  --file release.yml \
  --repo outfitter-dev/trails \
  --allow-publish \
  --yes
npx npm@11.18.0 trust list @ontrails/<package>
```

The trusted-publisher record deliberately omits a GitHub environment because npm permits only one trusted publisher per package while Trails supports both the protected `npm` job and the evidence-gated `npm-auto` job. Both GitHub environments are independently restricted to `main`.

## Post-Publish Verification

After publish, require every public package to have consumer-facing proof and every expected dist-tag to match:

```bash
bun run publish:registry-check:published
```

Package access and dist-tag visibility are not sufficient. The strict check requires exact-version metadata or an equivalent consumer package fetch before it reports a package complete.

After publication, the check waits up to two minutes for missing packages, missing exact-version proof, or lagging dist-tags. Read-only probes back off from 5 seconds to a 30-second cap, and confirmed packages keep their proof without being probed again. The deadline includes npm subprocess time. Pre-publish readiness remains a single pass.

A newer dist-tag or an inaccessible registry fails immediately because it is not evidence of propagation lag. A timeout reports the remaining observations as a post-publish verification failure; it does not retry publication or establish that publication failed. Inspect those observations before choosing recovery.

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
  --output json \
  --permit '{"id":"stable-cutover-smoke","scopes":["project:write","entity:write"]}'

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

If `bun run publish:packages` fails after publishing one or more packages, stop immediately. A retry is safe after investigating the failure: the command queries each exact package version and skips versions already present in npm.

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

Resume with an explicit package set when narrowing the incident is useful:

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
- the Homebrew tap PR has been reviewed and merged, and a clean `brew install outfitter-dev/tap/trails` or `brew upgrade trails` followed by `trails --version` reports the released version;
- no generated `.trails` or `.trails-tmp` runtime state is staged;
- the release issue or project update links to the final evidence.

### Homebrew Handoff Recovery Boundary

Treat GitHub release assets, checksums, and the generated tap formula as one handoff. Do not hand-edit a release asset or `Formula/trails.rb` to recover a failed handoff. If the tag is already published, first validate that every expected platform archive and the checksum manifest are present and correct; then rerun **Publish Homebrew** for that existing tag so the formula and tap PR are regenerated from reviewed release evidence. If asset validation fails, repair the release incident before rerunning the Homebrew workflow.
