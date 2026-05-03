# Topo Store

The topo store is Trails' queryable database of your application's topology — every trail, signal, resource, and their relationships. It lives in `.trails/trails.db` and is created automatically when you run topo commands.

For the full SQLite schema and programmatic query API, see the [Topo Store Reference](./topo-store-reference.md).

## The `.trails/` directory

Trails creates a `.trails/` directory in your workspace root on first use:

```text
.trails/
├── .gitignore             # Auto-generated gitignore for this directory
├── config/                # Local config overrides (gitignored)
├── dev/                   # Development state (gitignored)
├── generated/             # Generated artifacts (gitignored)
├── trails.db              # SQLite database (topology store)
├── trails.lock            # Lockfile (text, git-tracked)
└── _surface.json          # Full surface map (compiled artifact)
```

- **`trails.db`** — SQLite database containing all topo saves, pins, and schema cache. Not git-tracked.
- **`trails.lock`** — Committed lockfile. Text format, git-tracked. This is your contract's current state for CI.
- **`_surface.json`** — Full surface map with all metadata, written by `topo compile`.

## What trails.db contains

### Saves

Every topo write creates a **save** — a snapshot of your topology at that moment. Each save records a unique ID, git SHA, dirty state, trail/signal/resource counts, and timestamp. Older unpinned saves are pruned automatically.

### Pins

A **pin** is a durable, human-friendly name you assign to a save you care about. Pins persist until you explicitly unpin them. They are your landmarks in topo history.

### Metadata

For each save, the database stores trail IDs, intents, descriptions, examples, crossings, signals, resources, and their relationships. The schema cache avoids recomputing `zodToJsonSchema()` when schemas haven't changed.

## Commands

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

### `trails topo history`

List saved topo states (pinned and recent autosaves).

```bash
trails topo history --limit 20
```

### `trails topo compile`

Compile the current topo to `.trails/trails.lock` and `.trails/_surface.json`.

```bash
trails topo compile
```

### `trails topo verify`

Check that `.trails/trails.lock` matches your current topo. Fails if the lockfile has drifted.

```bash
# In CI
trails topo verify || exit 1
```

## Workflows

### Pre-deployment

1. Make topology changes
2. Compile: `trails topo compile`
3. Commit `.trails/trails.lock`
4. In CI, verify: `trails topo verify`

### Pin before refactoring

```bash
trails topo pin --name pre-refactor
# ... make changes ...
trails topo compile
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
