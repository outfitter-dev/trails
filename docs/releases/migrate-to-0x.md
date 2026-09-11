# Migrate Trails Consumers to 0.2.0

Trails is leaving the `1.0.0-beta.*` prerelease line without taking on the compatibility promise implied by 1.0. The prerelease work continues from its 0.1 source baseline as the first normal release, `0.2.0`, on the npm `latest` tag.

Use the temporary consumer bridge in this repository to move package manifests to `0.2.0`. It updates only current public `@ontrails/*` package names. Package route and source vocabulary migrations remain owned by Warden and Regrade.

## Preview the Change

Run the bridge from a Trails checkout and pass the consumer repository root:

```bash
bun scripts/migrate-consumer-to-0x.ts --root /path/to/consumer
```

Preview is the default. The command lists manifest changes and reports anything that prevents a safe version-only transition. It does not write manifests, update a lockfile, or install packages.

Trails `0.2.0` is available on npm. Review the preview before applying manifest changes and installing dependencies.

The bridge recognizes exact, caret, and tilde declarations for `1.0.0-beta.*`, `1.0.0`, and `1.0.1`. It preserves the existing range style:

| Before | After |
| --- | --- |
| `1.0.0-beta.46` | `0.2.0` |
| `^1.0.0-beta.18` | `^0.2.0` |
| `~1.0.0` | `~0.2.0` |

It checks `dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`, root catalogs, named catalogs, flat overrides, resolutions, and npm aliases. Recognized beta tarball overrides for `@ontrails/*` packages are removed so they cannot shadow the normal npm release, including override-only entries whose old package name is no longer public. An actual dependency on a retired package still blocks every write.

## Apply and Install

Write the reviewed manifest changes:

```bash
bun scripts/migrate-consumer-to-0x.ts --root /path/to/consumer --apply
```

This leaves the lockfile unchanged and prints the required `bun install` follow up. To write manifests and explicitly regenerate the Bun install together, run:

```bash
bun scripts/migrate-consumer-to-0x.ts \
  --root /path/to/consumer \
  --apply \
  --install
```

The bridge derives the public package set from the Trails workspace manifests. It never writes a manifest outside the selected consumer root. An exact external Trails workspace entry in an array-form `workspaces` declaration can be detached and its corresponding `workspace:` range converted to `0.2.0`. Object-form external workspace declarations require manual detachment. External packages reached through a workspace glob or an ambiguous workspace shape stop the apply so the source link can be reviewed.

Any other workspace outside the selected consumer root blocks the apply. Migrate that workspace separately or select a broader root that owns all participating manifests; the bridge does not infer how to detach unowned packages.

Glob-discovered symlinks to members inside the consumer also stop the apply. List those members by their exact real workspace paths before rerunning the bridge so every manifest is included in the migration.

## Resolve Blocked Package Routes

A package name absent from the current public package set stops the apply when it appears in a dependency, catalog, or other version-bearing declaration. The exception is a recognized beta tarball override, which is removed because it only shadows package resolution and does not rename source. A blocking declaration usually means the consumer also needs a governed source migration.

Follow the [governed vocabulary transition workflow](./v1-vocabulary-transition-workflow.md) and use the matching Regrade transition to update package declarations and source imports together, then rerun the consumer bridge. The preview identifies the blocking package and its source manifest. Do not replace a retired name with a guessed successor merely to make the version command pass.

Nested npm override objects, selector-bearing overrides, Git sources, ordinary file sources, tags such as `latest`, and arbitrary comparator expressions are outside this one-time bridge. The preview reports these sources and leaves them unchanged.

## Verify the Consumer

After installation, use the consumer repository's own checks. A typical Bun consumer runs:

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
```

Also run the consumer's Trails validation or Warden command when it has one. Review the manifest and lockfile diff together to confirm that no beta tarball, external Trails workspace, or 1.0-line package source remains.

If typechecking fails to resolve Node built-in imports such as `node:fs`, check that the app declares a current `@types/node` development dependency. The published `0.2.0` scaffolder omits it; use the [documented repair](../getting-started.md#repair-apps-generated-by-020). The manifest bridge changes Trails package sources and does not add unrelated development dependencies.

## Remove the Bridge

The Trails maintainers own this bridge and its removal under [TRL-1346](https://linear.app/outfitter/issue/TRL-1346/provide-a-disposable-consumer-bridge-to-trails-010). This script is transition tooling, not a permanent package-management surface. Remove the script, its focused tests, its Knip entry, and this guide after every known owned consumer has left `1.0.0-beta.*`, `1.0.0`, and `1.0.1`, installs from the normal `0.2.x` release line, and passes its repository checks without a temporary Trails workspace or tarball override.
