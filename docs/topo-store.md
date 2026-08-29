# Topo Store

The topo store is Trails' queryable database of your application's topology — every trail, signal, resource, and their relationships. Its default `trails.db` lives in the per-user Trails state store (`$TRAILS_STATE_HOME`, `$XDG_STATE_HOME`, then `~/.local/state`) and is created automatically when you run topo commands.

For the full SQLite schema and programmatic query API, see the [Topo Store Reference](./topo-store-reference.md). If you are migrating from the old surface-map or root database layout, see the [TopoGraph Artifact Family Migration](./migration/topograph-artifact-family.md).

## Project files and local state

Current v1 builds write one committed resolved-truth file per lock-owning app:

```text
<app-root>/trails.lock      # Trails lock v4 envelope (git-tracked)
<project-root>/.trails/     # committed Trails control directory
```

- **`trails.lock`** — Committed lock v4 envelope at a standalone or configured app root. It embeds the serialized TopoGraph plus the hash, summary, and scope facts needed for drift checks and graph reads. A configured workspace names its lock-owning apps through static `workspace.apps`; it never owns an aggregate workspace-root lock. A root `trails.lock` is app-owned only when `root: '.'` explicitly assigns that root to one app.
- **`.trails/`** — Committed Trails control directory. Project-local Warden rules and scaffold/control metadata live here; cache, generated lock fragments, and SQLite state do not.
- **`trails.db`** — SQLite database containing topo snapshots, pins, and schema cache. It is local state under the per-user Trails state store, not a repo file.

Local per-developer overrides live at the project root as `trails.config.local.*`, not under `.trails/`.

## What trails.db contains

### Saves

Every topo write creates a **save** — a snapshot of your topology at that moment. Each save records a unique ID, git SHA, dirty state, trail/signal/resource counts, and timestamp. Older unpinned saves are pruned automatically.

### Pins

A **pin** is a durable, human-friendly name you assign to a save you care about. Pins persist until you explicitly unpin them. They are your landmarks in topo history.

### Metadata

For each save, the database stores trail IDs, intents, descriptions, examples, compositions, signals, resources, and their relationships. The schema cache avoids recomputing `zodToJsonSchema()` when schemas haven't changed.

### Error scope

For v1, the topo store and TopoGraph record authored error-related contract facts:

- `examples` may include named error examples from `trail.examples`.
- `detours` include the declared recovery error class name and effective capped attempt count.

These fields are not exhaustive per-trail error contracts. Error categories, retryability, and surface codes stay owned by the core error taxonomy registry, while public body redaction stays owned by the shared error derived view policy. See [ADR-0045](./adr/0045-v1-resolved-graph-error-scope.md).

## Commands

Artifact lifecycle commands are top-level `trails` commands: `trails compile`, `trails validate`, and `trails diff`. The `trails topo` namespace is reserved for topo-store history and pin management.

Retired shapes such as `trails topo compile`, `trails topo verify`, and `trails topo check` are not aliases. Use the top-level commands instead:

- `trails compile` writes one selected app's `trails.lock`. A configured workspace-root invocation requires `--app <id>` and never creates an aggregate root lock.
- `trails validate` checks one selected app, or proves the complete configured app set when run at a workspace root without `--app`.
- `trails diff` compares the current topo against a saved TopoGraph target.

Programmatic consumers use `@ontrails/topography` APIs directly; the package does not ship a separate CLI binary.

### `trails topo pin`

Create a named pin for the current topo state.

```bash
trails topo pin --name before-auth-refactor
trails topo pin --name v1.2.0-baseline
```

Use before major refactors, deployments, or release boundaries.

### `trails topo unpin`

Remove a pin. Requires `--yes` to confirm (dry-run by default). The underlying save becomes eligible for pruning.

```bash
trails topo unpin --name experimental-feature --yes
```

### `trails survey <id>`

Display every trail, resource, or signal matching an ID. Use the typed survey accessors when you want exactly one kind.

```bash
trails survey auth.login
trails survey trail auth.login
trails survey resource db.main
trails survey signal user.created
```

Use `trails survey surfaces` when a blind agent or parity check needs the complete shipped-surface derived view inventory. The report lists every public trail eligible for CLI, MCP, and HTTP, including CLI command paths, MCP tool names, HTTP method/path pairs, and whether each derived view came from explicit authored surface metadata or default derivation. WebSocket is still planned and is intentionally reported as excluded until a public package/API exists.

### `trails topo history`

List saved topo states (pinned and recent autosaves).

```bash
trails topo history --limit 20
```

### `trails compile`

Compile the selected app topo to that app root's `trails.lock`.

```bash
# Standalone app or CWD inside a configured app root
trails compile

# Configured workspace root
trails compile --app api
```

`--root-dir` fixes the discovery boundary, `--app` selects a configured app, and CWD selects an app when it is inside exactly one configured app root. `--module` only refines the selected app's entry module; it cannot select an app, change its lock root, or bypass the configured topo-name binding. Compile at a configured workspace root without `--app` fails with the configured app IDs and writes nothing.

### `trails diff`

Compare the current topo against a saved TopoGraph target. The default target is the committed root `trails.lock`; explicit targets may be workspace-relative `trails.lock` or legacy `topo.lock` files, JSON TopoGraphs, TopoGraph directories, pins, or snapshots.

```bash
trails diff
trails diff user.create@1..2 --against pre-refactor
trails diff --breaks
trails diff --forces
```

### `trails revise`

Scaffold trail version lifecycle entries from source. The default shape creates a revision entry for the current version and bumps the trail to the next version. Use `--as fork` when the historical version needs its own preserved implementation.

```bash
trails revise billing.quote
trails revise billing.quote --as fork
trails revise billing.quote@1 --as fork
```

### `trails deprecate`

Mark a historical version entry deprecated, or archived when the historical version should remain inspectable but leave default runtime negotiation.

```bash
trails deprecate billing.quote@1 --successor 2 --note "Use v2."
trails deprecate billing.quote@1 --archive --reason "Superseded before GA."
```

### `trails doctor`

Summarize version lifecycle state for the loaded app, including deprecated and archived historical entries plus forced topo break audit events.

```bash
trails doctor
```

### `trails validate`

Check that committed app locks match current source. From an app root or with `--app`, validation is scoped to one app and does not require unrelated apps to be available. From a configured workspace root without `--app`, validation loads every configured app and fails closed unless every binding, lock, live graph, and freshness verdict is complete.

```bash
# One app
trails validate --app api || exit 1

# Complete configured workspace
trails validate || exit 1
```

Machine-readable compile and validate results distinguish `standalone-app`, `configured-app`, and `workspace` extents and include the selected project root, selection provenance, configured app IDs, module source, artifact path, and completeness evidence. Workspace validation additionally returns the per-app evidence and canonical workspace-view hash.

## Workflows

### Pre-deployment

1. Make topology changes
2. Compile each changed app: `trails compile` for a standalone app or from inside a configured app root, or `trails compile --app <id>` at a configured workspace root
3. Commit each app-root `trails.lock`
4. In CI, validate the configured workspace: `trails validate`

### Pin before refactoring

```bash
trails topo pin --name pre-refactor
# ... make changes ...
trails compile
# Compare lockfile diff against the pinned baseline
```

### Querying from trails

Use the `topoStore` resource for programmatic access:

```typescript
import { topoStore } from '@ontrails/topography';

trail('warden.check-outputs', {
  resources: [topoStore],
  intent: 'read',
  implementation: async (_input, ctx) => {
    const store = topoStore.from(ctx);
    const writeTrails = store.trails.list({ intent: 'write' });
    const missing = writeTrails.filter(t => !t.hasOutput);
    return Result.ok({ pass: missing.length === 0, missing });
  },
});
```

The resource is read-only by design — available in dev and CI, not production.
