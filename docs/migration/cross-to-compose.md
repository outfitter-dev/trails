# Cross To Compose Migration

Trails now uses the `compose` family for trail-to-trail composition. The old `cross` family is retired from active APIs, docs, generated projects, Warden rules, and topo persistence.

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

Create a saved Regrade plan in a clean worktree, then review its derived forms, namespace census, and occurrence inventory:

```bash
mkdir -p .tmp-regrade
bun apps/trails/bin/trails.ts regrade plan \
  --root-dir . \
  --type class \
  --name cross-compose \
  --class-ids term-rewrite:no-retired-cross-vocabulary \
  --include-entries all \
  --json > .tmp-regrade/cross-compose-plan.json

PLAN_PATH="$(jq -r '.path' .tmp-regrade/cross-compose-plan.json)"
```

For a smaller migration, scope it to a package or app:

```bash
bun apps/trails/bin/trails.ts regrade plan \
  --root-dir . \
  --type class \
  --name cross-compose \
  --class-ids term-rewrite:no-retired-cross-vocabulary \
  --include 'packages/my-app/**' \
  --include-entries all \
  --json > .tmp-regrade/cross-compose-plan.json

PLAN_PATH="$(jq -r '.path' .tmp-regrade/cross-compose-plan.json)"
```

This class plan safely rewrites the exact forms recognized by the retired-cross Warden rule. Review broader `cross`/`Cross` identifiers from the namespace census separately; the class does not rewrite unrelated English uses such as cross-app, cross-package, or cross-cutting.

Preview and dry-run the saved plan before applying it:

```bash
bun apps/trails/bin/trails.ts regrade preview --root-dir . --plan "$PLAN_PATH"
bun apps/trails/bin/trails.ts regrade apply \
  --root-dir . --plan "$PLAN_PATH" --dry-run
bun apps/trails/bin/trails.ts regrade apply --root-dir . --plan "$PLAN_PATH"
bun apps/trails/bin/trails.ts regrade check --root-dir . --plan cross-compose
```

Apply appends deterministic evidence to the transition's consolidated history. Make any semantic review edits only after Regrade exhausts the safe slice.

## Trails Lock

Committed `trails.lock` files that contain the old `crosses` JSON key should be regenerated. The topo-store schema migrates local SQLite state from `topo_crossings` to `topo_composings`, but committed locks are meant to be rebuilt from source.

```bash
trails compile
trails validate
```

## Verification

After migration, run the same checks you would run before submitting a Trails change:

```bash
bun run typecheck
bun run test
bun run lint
bun run lint:ast-grep
bun run format:check
bun run trails:check
bun run regrade:audit
```

If Warden or generated agent guidance changes, regenerate and check the Warden guide blocks:

```bash
bun run warden:agents:sync
bun run warden:skills:sync
bun run warden:agents:check
bun run warden:skills:check
```
