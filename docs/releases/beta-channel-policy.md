# Beta Channel Policy

This policy applies while Trails remains in the `1.0.0-beta.N` prerelease line.

## Runtime Requirement

Trails requires Bun. The published `trails` CLI bin uses `#!/usr/bin/env bun`; Node-only invocation through `npx` or `node` is not supported.

For direct package invocation before a project has been scaffolded, use Bun:

```bash
bunx --bun --package @ontrails/trails@beta trails <subcommand>
```

Scaffolded projects should prefer their generated package scripts, such as `bun run warden`, `bun run survey`, and `bun run topo`.

## Consumer Installs

Use the beta channel deliberately:

- Use explicit pins such as `@ontrails/core@1.0.0-beta.N` when a handoff,
  fixture, generated app, or downstream migration must be reproducible. Use the
  exact beta number from the release packet instead of copying an older guide's
  example version.
- Use `@beta` when you intentionally want the newest published beta.
- Do not rely on unqualified `@ontrails/*` installs during the beta line unless
  release notes explicitly say `latest` has been advanced.
- Keep public `@ontrails/*` packages on the same beta number. Do not mix exact
  beta pins and `@beta` ranges in one app unless the migration guide for that
  handoff explicitly says to.

Example active-beta install:

```bash
bun add @ontrails/core@beta @ontrails/cli@beta @ontrails/commander@beta zod
bun add @ontrails/mcp@beta
bun add @ontrails/http@beta @ontrails/hono@beta
bun add -d @ontrails/testing@beta
```

For fully reproducible docs, replace `@beta` with the exact beta version named by the release packet.

## Dist-Tag Posture

`.changeset/pre.json` is the channel source while it has `mode: "pre"`. The current prerelease tag is `beta`.

The built-in release flow follows that source. The package scripts below are compatibility wrappers around its native Bun packing binding and npm registry adapter binding:

- `bun run publish:check` is local and read-only.
- `bun run publish:registry-check` defaults to `.changeset/pre.json`'s tag in
  prerelease mode, so it checks `beta` today. This is the pre-publish
  readiness check: it proves the registry is reachable and the expected tag is
  not ahead of the repo target. It may pass while the tag still points at the
  previous published beta.
- `bun run publish:packages` packs and validates with Bun, publishes the packed
  tarballs with npm, and uses the same prerelease tag by default. In GitHub
  Actions, `--trusted-publishing` requires npm's OIDC credentials instead of a
  long-lived registry token.
- `bun run publish:registry-check:published` verifies the expected dist-tag
  after publication and requires every public package to expose the repo target
  through exact-version metadata or an equivalent consumer package fetch. A
  visible access record or dist-tag alone is not publication proof.

During the beta line, `latest` may intentionally lag behind `beta`. Operators should not advance `latest` after every beta publication. Move `latest` only when leaving prerelease mode for the stable 1.x line, or after a separate explicit release decision that says a beta should become the unqualified default.

Do not invoke `npm publish`, `changeset publish`, or ad hoc dist-tag mutation directly for normal Trails package releases. The repo publish command owns the npm invocation and its Bun-produced tarballs.

## Built-In Release Bindings

`@ontrails/trails/release` declares two bindings coordinated by the built-in release flow. The native Bun binding owns package discovery, workspace dependency ordering, packing, and tarball validation. The same-package npm adapter binding crosses the foreign npm tool and registry contract for read-only preflight and the controlled `npm publish <tarball>` handoff. Future integrations that cross into a different release tool or registry contract belong in their own adapter bindings.

## Read-Only Registry Checks

The standard beta posture check is:

```bash
bun run publish:registry-check
```

Its output validates registry readiness and prints both `latest` and `beta` for each published public workspace package, making tag lag visible. A behind tag is expected before the current beta has been published; the check fails when the registry is inaccessible or the tag points ahead of the repo target.

After publishing, use the strict equality gate:

```bash
bun run publish:registry-check:published
```

That check requires every public workspace package to resolve at the repo target version through exact-version metadata or an equivalent consumer package fetch, and the expected dist-tag to point at that version. Its diagnostics distinguish a visible package and tag from pending consumer proof.

For a small representative spot check:

```bash
for pkg in @ontrails/core @ontrails/commander @ontrails/testing @ontrails/topography; do
  npm view "$pkg" dist-tags --json
done
```

That command is read-only. It should show whether `latest` and `beta` point at different versions.

## Version-Bump Cadence

Every PR that changes publishable `@ontrails/*` package contents needs branch-local release intent unless the PR carries an explicit no-release reason.

## Release Rules

A branch-local changeset is the normal release intent. It says the branch changes user-visible package content and should flow into Changesets, package changelogs, and the next version plan. Use it for public API changes, generated-app changes, public trail contract changes, docs or examples that ship in a public package, and migration guidance that users need after upgrading.

`release:none` is the compatibility no-release override. Use it only when the branch touches package files but does not change user-visible package content. A good `release:none` rationale names the affected files and explains why users do not need a package changelog entry. A bad rationale merely says "internal" or "test only" while the branch also changes public trail additions/removals, visibility, input, output, surface exposure, generated artifacts, or package docs.

Trail versions and package semver are separate axes. A trail version entry preserves or exposes capability contracts inside a topo. A package version distributes framework bits through npm. Changing a public trail contract is a release fact even when the trail's own `version` field does not move, and a trail version migration still needs branch-local release intent when publishable package contents change.

The current check enforces the first contract-aware slice: public trail additions/removals, visibility transitions, input schema changes, output schema changes, or surface exposure changes need a branch-local changeset or an explicit no-release reason. The check is intentionally branch-local in Graphite stacks. Fix missing intent on the owning branch, then restack upward; do not add a top-stack cleanup changeset to hide a lower branch's missing release story.

Examples:

- Good changeset prose: "Expose `wayfind.contract` through the Trails operator CLI so agents can inspect saved input/output contracts before source reads."
- Good `release:none` rationale: "Only updates non-shipping fixture source under `packages/core/src/__tests__`; no public package files or public trail contracts changed."
- Bad `release:none` rationale: "No release needed" on a branch that changes `output: z.object(...)` for an exposed trail.

After substantial stacks merge to `main`:

1. Confirm all package-affecting PRs carried branch-local release intent. `trails release check --json` and `bun run changeset:check` are the local proof surfaces.
2. Ensure source PRs that introduced consumed changesets carry
   `stack:boundary` when the generated release should be eligible for
   automatic publishing. Missing boundary evidence is safe, but it routes the
   generated release PR to `publish:manual`.
3. Run `bunx changeset status --verbose` from clean, synced `main` to inspect
   the next beta plan.
4. When the next beta is warranted, create a dedicated version branch, run
   `bun run version:packages`, then run `bun run scaffold-versions:sync` so
   generated third-party scaffold dependency versions and exact `@ontrails/*`
   pins are checked together.
5. Review package versions, changelogs, generated lockfile changes, and
   generated-app dependency ranges.
6. Run the version-branch gates, including `bun run publish:check` and
   `bun run publish:registry-check`. The registry check is a pre-publish
   readiness gate, so it may pass while the current release is still unpublished
   and the channel tag points at the previous beta.
7. Submit and merge the version PR only after CI and review are clean. The
   GitHub release workflow creates or updates the generated
   `changeset-release/main` PR, applies missing `publish:*`, `channel:*`, and
   `release:*` labels without overriding human intent, and evaluates the
   publish policy after the generated PR merges.
8. Prefer the workflow publish path from clean `main`. `publish:auto` uses the
   `npm-auto` environment only when generated release shape, exact-SHA CI,
   registry posture, and `stack:boundary` source evidence are complete.
   `publish:manual` uses the protected `npm` environment for incomplete or
   ambiguous low-risk proof. `publish:block` and unknown/conflicting managed
   labels stop the workflow.
9. Use local publish commands only for diagnostics or explicit recovery.
   Local recovery uses the operator's ambient npm authentication; it does not
   create or repair a GitHub deployment record:
   `bun run publish:check`, `bun run publish:registry-check`,
   `bun run publish:packages`, then
   `bun run publish:registry-check:published`.

### First-Time Package Bootstrap

npm trusted publishing cannot create a package. When a release introduces a new public package, bootstrap only that package with authenticated local tooling, configure its trusted publisher, verify the record, then retry the GitHub release workflow:

```bash
bun run publish:packages -- --only @ontrails/<package> --tag beta
npx npm@11.18.0 trust github @ontrails/<package> \
  --file release.yml \
  --repo outfitter-dev/trails \
  --allow-publish \
  --yes
npx npm@11.18.0 trust list @ontrails/<package>
```

Do not set the trusted publisher's optional GitHub environment restriction. npm permits one trusted publisher per package, while Trails intentionally has two `main`-restricted GitHub environments: protected `npm` for manual approval and `npm-auto` for evidence-gated publication. The repository workflow and environment policies hold that distinction.

Feature branches and release-readiness stacks may run read-only checks, but they must not publish.

## Future Channels

`next` and `canary` are out of scope for the pre-1.0 beta line. Introducing another prerelease channel needs a focused policy issue or ADR amendment before any script, docs, or release operator starts using it.
