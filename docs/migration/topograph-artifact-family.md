# TopoGraph Artifact Family Migration

Current v1 builds use one committed resolved-truth file:

- `trails.lock` is the committed lock v4 envelope. It embeds the serialized `TopoGraph`, the graph hash, scope, and summary.
- `.trails/trails.lock` and `.trails/topo.lock` are the previous beta artifact family. Readers keep a compatibility bridge for the migration window, but new writes converge on root `trails.lock`.
- `.trails/` is committed Trails control, not a generated-state directory.
- `trails.db` lives in the per-user Trails state store for snapshots, pins,
  tracing, and other framework subsystems.
- Rebuildable cache state lives outside the repo in the Trails cache store.
- `trails.config.local.*` files at the project root are ignored local override files.

Regenerate the current root `trails.lock` with:

```bash
trails compile
```

Validate committed artifacts with:

```bash
trails validate
```

## Rename Map

| Retired | Current |
| --- | --- |
| `SurfaceMap` | `TopoGraph` |
| `SurfaceMapEntry` | `TopoGraphEntry` |
| `deriveSurfaceMap()` / `hashSurfaceMap()` / `diffSurfaceMaps()` | `deriveTopoGraph()` / `deriveTopoGraphHash()` / `deriveTopoGraphDiff()` |
| `_surface.json` | `trails.lock` |
| `surface_map` | `topo_graph` |
| `serialized_lock` | `lock_manifest` for stored manifest export content; `trails.lock` for the committed resolved-truth file |
| `.trails/config/local.*` | `trails.config.local.*` at the project root |
| `.trails/config.local.*` | `trails.config.local.*` at the project root |
| `.trails/trails.db` | Trails state store `trails.db` |
| `.trails/state/` | Trails state store |
| `.trails/dev/` | Trails state store |
| `.trails/generated/` | Trails cache store |

## Local Cleanup

Current builds create the shared database under the per-user Trails state store. If an old workspace still has untracked root SQLite sidecars, remove only the legacy root files:

```bash
rm -f .trails/trails.db .trails/trails.db-shm .trails/trails.db-wal
```

Do not commit any `.trails/state/trails.db*` files if they exist from older builds. They are legacy local runtime state; current builds use the per-user state store.

If an old workspace still has committed `.trails/trails.lock` and `.trails/topo.lock`, rerun:

```bash
trails compile
```

Review the new root `trails.lock` diff, then remove the legacy committed artifacts from `.trails/`.

## Consumer Updates

Consumers that previously parsed `_surface.json` or `.trails/topo.lock` should read root `trails.lock` through `readTopoGraph()` or use the typed topo-store views:

```typescript
import { createTopoStore, readTopoGraph } from '@ontrails/topographer';

const topoGraph = await readTopoGraph({ dir: process.cwd() });
const store = createTopoStore();
const detail = store.trails.get('auth.login');
```

Use `store.topoGraph`, `store.entries`, `store.trails`, `store.resources`, `store.signals`, and `store.entities` for queryable access instead of parsing serialized JSON in application code.
