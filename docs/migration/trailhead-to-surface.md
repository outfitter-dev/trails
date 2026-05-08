# Trailhead To Surface Migration Guide

How to migrate consumers from the retired `trailhead` vocabulary to the canonical `surface` vocabulary. This is a clean cut: Trails does not ship compatibility aliases for these wire formats and public names.

This guide is temporary. Deprecate it after Matt's projects and downstream consumers have migrated.

## Overview

The framework now consistently uses `surface` for CLI, MCP, HTTP, and WebSocket exposure. Historical prose may still mention `trailhead`, but active API names, generated records, query schemas, and extension keys use `surface`.

## Rename Map

| Old | New | Action |
| --- | --- | --- |
| `TraceRecord.trailhead` | `TraceRecord.surface` | Update trace consumers and custom `TraceSink` implementations. |
| OTel attribute `trails.trailhead` | `trails.surface` | Update dashboards, alerts, exporters, and processors. |
| SQLite dev-store column `trailhead` | `surface` | Reset local Trails dev stores before upgrading. |
| `tracing.query` record field `trailhead` | `surface` | Update CLI/MCP/HTTP/API consumers that inspect query results. |
| Extension key value `__trails_trailhead` | `__trails_surface` | Update any direct `ctx.extensions` reads/writes to use `SURFACE_KEY`. |
| `TRAILHEAD_KEY` | removed | Import `SURFACE_KEY` from `@ontrails/core`. |
| `SurfaceMapEntry.trailheads` | `SurfaceMapEntry.surfaces` | Update surface-map JSON consumers and regenerate maps. |
| `extractTrailheads` | `extractSurfaces` | Update internal imports if you reached into non-public helpers. |
| `Trailhead "<name>" added/removed` | `Surface "<name>" added/removed` | Update diff-output tests or parsers. |
| `transportNames` / `TransportName` | `surfaceNames` / `SurfaceName` | Import the surface-named error projection API. |
| `transportErrorMap` | `surfaceErrorMap` | Import the surface-named error projection API. |
| `transportErrorRegistry` | `surfaceErrorRegistry` | Import the surface-named error projection API. |
| `mapTransportError` | `mapSurfaceError` | Import the surface-named error projection API. |
| `createTransportErrorMapper` | `createSurfaceErrorMapper` | Import the surface-named error projection API. |
| `TransportErrorCode` | `SurfaceErrorCode` | Import the surface-named error projection API. |
| `TransportErrorMapper` | `SurfaceErrorMapper` | Import the surface-named error projection API. |
| `TransportErrorMappings` | `SurfaceErrorMappings` | Import the surface-named error projection API. |
| `MapTransportError` | `typeof mapSurfaceError` | Use the canonical function type. |
| `AuthCredentials` | `PermitExtractionInput` | Import `PermitExtractionInput` from `@ontrails/permits`. |
| `isVisibleToTrailheads` | `isVisibleToSurfaces` | Update internal callers if you imported non-public helpers. |
| `topo.export` / `topoExportTrail` | `topo.compile` | Call `topo.compile` for topo artifact generation. |

## Code Imports

Prefer direct imports of the canonical names:

```typescript
import {
  SURFACE_KEY,
  mapSurfaceError,
  surfaceErrorMap,
  surfaceNames,
} from '@ontrails/core';
import type {
  SurfaceErrorCode,
  SurfaceErrorMapper,
  SurfaceName,
} from '@ontrails/core';
import type { PermitExtractionInput } from '@ontrails/permits';
```

Remove imports of `TRAILHEAD_KEY`, `mapTransportError`, `transportErrorMap`, `transportErrorRegistry`, `transportNames`, `createTransportErrorMapper`, `TransportName`, `TransportErrorCode`, `TransportErrorMapper`, `TransportErrorMappings`, `MapTransportError`, and `AuthCredentials`.

## Trace Records

Update any code that writes, reads, serializes, or asserts trace records:

```diff
 const record = createTraceRecord({
-  trailhead: 'cli',
+  surface: 'cli',
   trailId: 'user.list',
 });

-record.trailhead
+record.surface
```

Custom `TraceSink` implementations should persist `surface` and should not accept or emit `trailhead` as a current field.

## Observability

The OTel adapter now emits `trails.surface`.

```diff
-span.attributes['trails.trailhead']
+span.attributes['trails.surface']
```

Update saved dashboards, alerting rules, metric processors, log pipelines, and any tests that assert on span attributes.

## Dev Store

The tracing dev-store schema now uses a `surface` column. Existing local dev stores are transient and are not migrated in framework code.

Reset local Trails state before upgrading:

```bash
trails dev reset --yes
```

If you manage the database manually, delete `.trails/trails.db` and its SQLite sidecar files (`.trails/trails.db-wal`, `.trails/trails.db-shm`) before recreating local state.

## Query Trail

`tracing.query` now returns `surface` on each record:

```diff
 {
   "records": [
     {
       "trailId": "user.list",
-      "trailhead": "cli"
+      "surface": "cli"
     }
   ]
 }
```

Update typed clients, JSON assertions, and API consumers that read the query output.

## Extension Key

Use `SURFACE_KEY` for surface identity in `ctx.extensions`.

```diff
-ctx.extensions?.['__trails_trailhead']
+ctx.extensions?.[SURFACE_KEY]
```

The runtime key value is now `__trails_surface`. Any persisted state keyed by `__trails_trailhead` is invalid after the cutover.

## Surface Maps

Surface maps now store `surfaces` on each entry:

```diff
 {
   "id": "user.list",
-  "trailheads": ["cli", "mcp"]
+  "surfaces": ["cli", "mcp"]
 }
```

Regenerate surface maps and locks after upgrading. For the Trails app, use:

```bash
trails topo compile
```

Update any direct JSON consumers, fixtures, or snapshot assertions that read `entry.trailheads`.

## Topo Compile

The legacy `topo.export` trail has been removed. Use `topo.compile` for current topo artifacts:

```diff
-trails topo export
+trails topo compile
```

Any programmatic lookup for `topo.export` should move to `topo.compile`.

## Warden And Comments

Warden messages and active TSDoc now use `surface` for exposure and reserve `mount` for cross-app composition. No operator action is required beyond updating tests that assert exact diagnostic strings.
