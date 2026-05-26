# Cross To Compose Migration

Trails now uses the `compose` family for trail-to-trail composition. The old
`cross` family is retired from active APIs, docs, generated projects, Warden
rules, and topo persistence.

## Rename Map

| Retired | Current |
| --- | --- |
| `crosses:` | `composes:` |
| `ctx.cross(...)` | `ctx.compose(...)` |
| `CrossFn` | `ComposeFn` |
| `CrossOptions` | `ComposeOptions` |
| `CrossBatch*` | `ComposeBatch*` |
| `CrossInput<T>` | `ComposeInput<T>` |
| `crossInput` | `composeInput` |
| `testCrosses()` | `testComposes()` |
| `createCrossContext()` | `createComposeContext()` |
| `CrossScenario` | `ComposeScenario` |
| `TestCrossOptions` | `TestComposeOptions` |
| `expectCrossed` | `expectComposed` |
| `expectCrossedCount` | `expectComposedCount` |
| `cross-declarations` | `composes-declarations` |
| `no-destructured-cross` | `no-destructured-compose` |
| `version-pinned-cross` | `version-pinned-compose` |
| `topo_crossings` | `topo_composings` |
| `idx_topo_crossings_snapshot_id` | `idx_topo_composings_snapshot_id` |

## Source Update

Run the vocabulary rewrite in a clean worktree, then review the diff:

```bash
bun run vocab:rewrite -- --rule compose-api --write
```

For a smaller migration, scope it to a package or app:

```bash
bun run vocab:rewrite -- --rule compose-api --write --path packages/my-app
```

The codemod handles source identifiers, trail spec keys, context calls, testing
helper names, Warden rule names, and the topo persistence names. It does not
replace unrelated English uses such as cross-app, cross-package, or
cross-cutting.

## Topo Artifacts

Committed topo artifacts that contain the old `crosses` JSON key should be
regenerated. The topo-store schema migrates local SQLite state from
`topo_crossings` to `topo_composings`, but committed lockfiles are meant to be
rebuilt from source.

```bash
trails compile
trails validate
```

## Verification

After migration, run the same checks you would run before submitting a Trails
change:

```bash
bun run typecheck
bun run test
bun run lint
bun run lint:ast-grep
bun run format:check
bun run vocab:audit
```

If Warden or generated agent guidance changes, regenerate and check the Warden
guide blocks:

```bash
bun run warden:agents:sync
bun run warden:skills:sync
bun run warden:agents:check
bun run warden:skills:check
```
