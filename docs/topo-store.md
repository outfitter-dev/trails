# Topo Store

The topo store is Trails' queryable database of your application's topology — every trail, signal, resource, and their relationships. It lives in `.trails/state/trails.db` and is created automatically when you run topo commands.

For the full SQLite schema and programmatic query API, see the [Topo Store Reference](./topo-store-reference.md).
If you are migrating from the old surface-map or root database layout, see the
[TopoGraph Artifact Family Migration](./migration/topograph-artifact-family.md).

## The `.trails/` directory

Trails creates a `.trails/` directory in your workspace root on first use:

```text
.trails/
├── .gitignore             # Auto-generated gitignore for this directory
├── config.local.ts        # Local TypeScript config overrides (gitignored)
├── config.local.js        # Local JavaScript config overrides (gitignored)
├── cache/                 # Rebuildable derived data (gitignored)
├── state/                 # Mutable framework state (gitignored)
│   └── trails.db          # SQLite database (topology store)
├── topo.lock              # Serialized TopoGraph (git-tracked)
└── trails.lock            # Lock v3 manifest (text, git-tracked)
```

- **`state/trails.db`** — SQLite database containing topo snapshots, pins, and schema cache. Not git-tracked.
- **`topo.lock`** — Committed serialized TopoGraph with trail, signal, resource, relation, example, detour, and workspace metadata.
- **`trails.lock`** — Committed compact v3 manifest that points at `topo.lock` and verifies its hash.

## What trails.db contains

### Saves

Every topo write creates a **save** — a snapshot of your topology at that moment. Each save records a unique ID, git SHA, dirty state, trail/signal/resource counts, and timestamp. Older unpinned saves are pruned automatically.

### Pins

A **pin** is a durable, human-friendly name you assign to a save you care about. Pins persist until you explicitly unpin them. They are your landmarks in topo history.

### Metadata

For each save, the database stores trail IDs, intents, descriptions, examples, crossings, signals, resources, and their relationships. The schema cache avoids recomputing `zodToJsonSchema()` when schemas haven't changed.

### Error scope

For v1, the topo store and TopoGraph record authored error-related contract facts:

- `examples` may include named error examples from `trail.examples`.
- `detours` include the declared recovery error class name and effective capped attempt count.

These fields are not exhaustive per-trail error contracts. Error categories, retryability, and surface codes stay owned by the core error taxonomy registry, while public body redaction stays owned by the shared error projection policy. See [ADR-0045](./adr/0045-v1-resolved-graph-error-scope.md).

## Commands

Artifact lifecycle commands are top-level `trails` commands:
`trails compile`, `trails validate`, and `trails diff`. The `trails topo`
namespace is reserved for topo-store history and pin management.

Retired shapes such as `trails topo compile`, `trails topo verify`, and
`trails topo check` are not aliases. Use the top-level commands instead:

- `trails compile` writes `.trails/topo.lock` and `.trails/trails.lock`.
- `trails validate` checks committed artifacts against the current topo.
- `trails diff` compares the current topo against a saved TopoGraph target.

Programmatic consumers use `@ontrails/topographer` APIs directly; the package
does not ship a separate CLI binary.

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

Use `trails survey surfaces` when a blind agent or parity check needs the
complete shipped-surface projection inventory. The report lists every public
trail eligible for CLI, MCP, and HTTP, including CLI command paths, MCP tool
names, HTTP method/path pairs, and whether each projection came from explicit
authored surface metadata or default derivation. WebSocket is still planned and
is intentionally reported as excluded until a public package/API exists.

### `trails topo history`

List saved topo states (pinned and recent autosaves).

```bash
trails topo history --limit 20
```

### `trails compile`

Compile the current topo to `.trails/topo.lock` and `.trails/trails.lock`.

```bash
trails compile
```

### `trails diff`

Compare the current topo against a saved TopoGraph target. The default target is
the committed `.trails/topo.lock`; explicit targets may be workspace-relative
`topo.lock` files, JSON TopoGraphs, TopoGraph directories, pins, or snapshots.

```bash
trails diff
trails diff user.create@1..2 --against pre-refactor
trails diff --breaks
trails diff --forces
```

### `trails revise`

Scaffold trail version lifecycle entries from source. The default shape creates a
revision entry for the current version and bumps the trail to the next version.
Use `--as fork` when the historical version needs its own preserved blaze.

```bash
trails revise billing.quote
trails revise billing.quote --as fork
trails revise billing.quote@1 --as fork
```

### `trails deprecate`

Mark a historical version entry deprecated, or archived when the historical
version should remain inspectable but leave default runtime negotiation.

```bash
trails deprecate billing.quote@1 --successor 2 --note "Use v2."
trails deprecate billing.quote@1 --archive --reason "Superseded before GA."
```

### `trails doctor`

Summarize version lifecycle state for the loaded app, including deprecated and
archived historical entries plus forced topo break audit events.

```bash
trails doctor
```

### `trails validate`

Check that the `.trails/trails.lock` / `.trails/topo.lock` artifact family
matches your current topo. Fails if either committed artifact has drifted.

```bash
# In CI
trails validate || exit 1
```

## Workflows

### Pre-deployment

1. Make topology changes
2. Compile: `trails compile`
3. Commit `.trails/trails.lock` and `.trails/topo.lock`
4. In CI, validate: `trails validate`

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
import { topoStore } from '@ontrails/topographer';

trail('warden.check-outputs', {
  resources: [topoStore],
  intent: 'read',
  blaze: async (_input, ctx) => {
    const store = topoStore.from(ctx);
    const writeTrails = store.trails.list({ intent: 'write' });
    const missing = writeTrails.filter(t => !t.hasOutput);
    return Result.ok({ pass: missing.length === 0, missing });
  },
});
```

The resource is read-only by design — available in dev and CI, not production.
