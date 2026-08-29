# TopoGraph Artifact Family Migration

Current v1 builds use one committed resolved-truth file per lock-owning app:

- `trails.lock` is the committed lock envelope at an app root. It embeds the
  serialized `TopoGraph`, graph hash, scope, and summary.
- A standalone app owns its root `trails.lock`. A configured workspace names
  each lock-owning app through static `workspace.apps`; every configured app
  owns its own root lock. There is no workspace-root aggregate lock. When a
  configured app's resolved root is the workspace root, whether authored as
  `root: '.'` or through a safe internal alias, the workspace-root
  `trails.lock` is that app's lock.
- `.trails/trails.lock` and `.trails/topo.lock` are the previous beta artifact
  family. Readers keep a compatibility bridge for the migration window, but
  new writes converge on the selected app root's `trails.lock`.
- `.trails/` is committed Trails control, not a generated-state directory.
- `trails.db` lives in the per-user Trails state store for snapshots, pins,
  tracing, and other framework subsystems.
- Rebuildable cache state lives outside the repo in the Trails cache store.
- `trails.config.local.*` files at the project root are ignored local override files.

Regenerate a standalone or selected app's root `trails.lock` from that app root with:

```bash
trails compile
```

Validate committed artifacts with:

```bash
trails validate
```

During the workspace operator cutover, programmatic consumers can read the static catalog and derive the saved view without importing app source:

```typescript
import { readTrailsProjectIdentity } from '@ontrails/config';
import { deriveWorkspaceView } from '@ontrails/topography';

const workspaceRoot = process.cwd();
const identity = await readTrailsProjectIdentity({
  boundaryDir: workspaceRoot,
  startDir: process.cwd(),
});
const view = await deriveWorkspaceView({ identity });
```

Missing, invalid, mismatched, and stale configured locks remain typed app evidence. A nested `trails.lock` outside `workspace.apps` is reported as an unowned artifact with declare-or-remove coaching. A lock at the configured workspace root is reported as a forbidden aggregate when no root app is declared. Neither path derives app identity, and the read never compiles or writes artifacts.

`buildWorkspaceTrailIndex()` has been removed. Operator run, completion, Wayfinder, and Warden consumers now resolve `workspace.apps` through the shared Config-owned context and load only the selected app or an explicitly complete workspace view.

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
import { createTopoStore, readTopoGraph } from '@ontrails/topography';

const topoGraph = await readTopoGraph({ dir: process.cwd() });
const store = createTopoStore();
const detail = store.trails.get('auth.login');
```

Use `store.topoGraph`, `store.entries`, `store.trails`, `store.resources`, `store.signals`, and `store.entities` for queryable access instead of parsing serialized JSON in application code.
