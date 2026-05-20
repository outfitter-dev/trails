# TopoGraph Artifact Family Migration

The v1 topo artifact family uses a compact manifest plus an inspectable graph
content artifact:

- `.trails/trails.lock` is the committed lock v3 manifest.
- `.trails/topo.lock` is the committed serialized `TopoGraph` content artifact.
- `.trails/state/trails.db` is ignored mutable SQLite state for snapshots,
  pins, tracing, and other framework subsystems.
- `.trails/cache/` is ignored rebuildable cache state.
- `.trails/config.local.ts` and `.trails/config.local.js` are ignored local
  override files.

Regenerate the current artifact family with:

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
| `_surface.json` | `.trails/topo.lock` |
| `surface_map` | `topo_graph` |
| `serialized_lock` | `lock_manifest` for stored manifest export content; `.trails/trails.lock` for the committed manifest file |
| `.trails/config/local.*` | `.trails/config.local.ts` or `.trails/config.local.js` |
| `.trails/trails.db` | `.trails/state/trails.db` |
| `.trails/dev/` | `.trails/state/` |
| `.trails/generated/` | `.trails/cache/` |

## Local Cleanup

Current builds create the shared database under `.trails/state/`. If an old
workspace still has untracked root SQLite sidecars, remove only the legacy root
files:

```bash
rm -f .trails/trails.db .trails/trails.db-shm .trails/trails.db-wal
```

Do not commit any `.trails/state/trails.db*` files. They are local runtime
state and are ignored by the workspace `.trails/.gitignore`.

## Consumer Updates

Consumers that previously parsed `_surface.json` should read `.trails/topo.lock`
through `readTopoGraph()` or use the typed topo-store views:

```typescript
import { createTopoStore, readTopoGraph } from '@ontrails/topographer';

const topoGraph = await readTopoGraph({ dir: '.trails' });
const store = createTopoStore();
const detail = store.trails.get('auth.login');
```

Use `store.topoGraph`, `store.entries`, `store.trails`, `store.resources`,
`store.signals`, and `store.contours` for queryable access instead of parsing
serialized JSON in application code.
