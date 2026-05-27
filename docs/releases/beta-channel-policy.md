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

- Use explicit pins such as `@ontrails/core@1.0.0-beta.18` when a handoff,
  fixture, generated app, or downstream migration must be reproducible.
- Use `@beta` when you intentionally want the newest published beta.
- Do not rely on unqualified `@ontrails/*` installs during the beta line unless
  release notes explicitly say `latest` has been advanced.
- Keep public `@ontrails/*` packages on the same beta number. Do not mix
  `beta.15`, `beta.18`, and `@beta` ranges in one app.

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

The release scripts follow that source:

- `bun run publish:check` is local and read-only.
- `bun run publish:registry-check` defaults to `.changeset/pre.json`'s tag in
  prerelease mode, so it checks `beta` today.
- `bun run publish:packages` publishes with Bun and uses the same prerelease tag
  by default.
- `bun run publish:registry-check:published` verifies the expected dist-tag
  after publication.

During the beta line, `latest` may intentionally lag behind `beta`. Operators should not advance `latest` after every beta publication. Move `latest` only when leaving prerelease mode for the stable 1.x line, or after a separate explicit release decision that says a beta should become the unqualified default.

Do not use `npm publish`, `changeset publish`, or ad hoc dist-tag mutation for normal Trails package releases.

## Read-Only Registry Checks

The standard beta posture check is:

```bash
bun run publish:registry-check
```

Its output validates the expected tag and prints both `latest` and `beta` for each published public workspace package, making tag lag visible.

For a small representative spot check:

```bash
for pkg in @ontrails/core @ontrails/commander @ontrails/testing @ontrails/topographer; do
  npm view "$pkg" dist-tags --json
done
```

That command is read-only. It should show whether `latest` and `beta` point at different versions.

## Version-Bump Cadence

Every PR that changes publishable `@ontrails/*` package contents needs a branch-local changeset unless the PR is explicitly labeled `release:none`.

After substantial stacks merge to `main`:

1. Confirm all package-affecting PRs carried changesets or an explicit
   `release:none` decision.
2. Run `bunx changeset status --verbose` from clean, synced `main` to inspect
   the next beta plan.
3. When the next beta is warranted, create a dedicated version branch, run
   `bunx changeset version`, then run `bun run scaffold-versions:sync` so
   generated third-party scaffold dependency versions and exact `@ontrails/*`
   pins are checked together.
4. Review package versions, changelogs, generated lockfile changes, and
   generated-app dependency ranges.
5. Run the version-branch gates, including `bun run publish:check` and
   `bun run publish:registry-check`.
6. Submit and merge the version PR only after CI and review are clean.
7. Publish only from clean, synced `main` after the version PR merges:
   `bun run publish:check`, `bun run publish:registry-check`,
   `bun run publish:packages`, then
   `bun run publish:registry-check:published`.

Feature branches and release-readiness stacks may run read-only checks, but they must not publish.

## Future Channels

`next` and `canary` are out of scope for the pre-1.0 beta line. Introducing another prerelease channel needs a focused policy issue or ADR amendment before any script, docs, or release operator starts using it.
