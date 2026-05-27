---
id: 46
slug: lock-v3-artifact-family
title: Lock v3 Artifact Family
status: accepted
created: 2026-05-11
updated: 2026-05-11
accepted: 2026-05-11
owners: ['[galligan](https://github.com/galligan)']
depends_on: [10, 11, 15, 17, 42, 45]
---

# ADR-0046: Lock v3 Artifact Family

## Context

ADR-0017 set the long-term goal correctly: the resolved topo should be a machine-readable story that agents, CI, and tools can inspect without guessing from source. Its chosen container was too broad. It put every graph fact into `.trails/trails.lock` and made that one file responsible for both drift verification and full graph inspection.

The current v1 implementation proved that those are related but separate jobs. Topographer already derives a rich graph artifact with trails, signals, resources, contours, schemas, examples, activation sources, governance metadata, and surface projections. The existing `SurfaceMap` name understates what that artifact contains, while the current `trails.lock` is only a hash envelope and optional workspace index.

For v1, Trails needs the resolved topo to stay inspectable without turning the most frequently reviewed drift gate into a large graph payload.

## Decision

Lock v3 is a committed artifact family:

- `.trails/trails.lock` is the compact manifest.
- `.trails/topo.lock` is the serialized `TopoGraph` content artifact.

Both files are generated, committed, framework-owned `.lock` artifacts. They have different responsibilities.

### `trails.lock` is the manifest

The manifest answers: "Is this resolved topo artifact family in a verified, known state?"

It contains:

- manifest `version: 3`;
- scope metadata for an app or workspace;
- artifact paths and stable SHA-256 hashes;
- a small deterministic summary for fast review.

It does not contain graph entries and intentionally omits `generatedAt`.

```json
{
  "version": 3,
  "scope": { "app": "demo" },
  "artifacts": [
    {
      "role": "topo",
      "path": "topo.lock",
      "sha256": "a3f5..."
    }
  ],
  "summary": {
    "trails": 12,
    "signals": 4,
    "resources": 3,
    "contours": 2
  }
}
```

### `topo.lock` is the graph content

The content artifact answers: "What is the resolved topo?"

It contains the serialized `TopoGraph`: every trail, signal, resource, and contour with their schemas, examples, relationships, activation data, governance metadata, and surface projections.

`topo.lock` owns content metadata. It keeps `generatedAt` and a content schema version field named `topoGraphSchemaVersion`. The manifest's `version: 3` is the manifest schema version and is separate from `topoGraphSchemaVersion`.

The TopoGraph hash canonicalizes around `generatedAt`, so regeneration time does not create false drift.

### Naming

The public topographer API uses `TopoGraph` vocabulary:

- `SurfaceMap` becomes `TopoGraph`;
- `SurfaceMapEntry` becomes `TopoGraphEntry`;
- `deriveSurfaceMap*` helpers become `deriveTopoGraph*` helpers;
- `SurfaceLock` becomes `LockManifest`.

Storage keeps the word boundary visible:

- SQL/export names use `topo_graph`;
- JavaScript field names use `topoGraph`;
- do not use `topograph` as a field or column name.

The topo-store export named `serialized_lock` is not a second graph copy. It is either replaced with `lock_manifest` when the export pipeline needs stored manifest content, or removed when the manifest can be derived from `topo_graph` during compile.

### Workspace layout

`.trails/` is the Trails workspace, with explicit tracking policy:

- committed root `.lock` artifacts: `.trails/trails.lock` and
  `.trails/topo.lock`;
- ignored rebuildable cache: `.trails/cache/`;
- ignored mutable runtime state: `.trails/state/`;
- ignored local override config: `.trails/config.local.ts` or
  `.trails/config.local.js`.

The default local SQLite path is `.trails/state/trails.db`. This is a pre-v1 hard cut from `.trails/trails.db`; runtime and tooling should not silently read fallback data from the legacy root database path.

Shared authored project config stays at root `trails.config.ts`.

### Workspace trail index

Workspace ownership data does not belong in the manifest body. When the artifact family describes a workspace, `topo.lock` may carry an optional top-level `workspace` section. Typed helpers expose that data for `trails run <id>` and completion consumers.

Workspace ownership is a projection over the graph, not an ordinary `entries[]` node.

### Legacy lock behavior

Lock v3 is the v1 target. Legacy v2 hash envelopes and hash-only files are not silently upgraded or interpreted as valid v3 manifests. Readers should fail loudly with an instruction to regenerate with `trails compile`.

## Consequences

- ADR-0017 is partially superseded. The resolved topo remains the story, but the
  story is expressed by a manifest plus content artifact instead of one
  all-purpose lockfile.
- Ordinary contract changes keep a small manifest diff while the inspectable
  graph remains available in `topo.lock`.
- CI and Warden verify the manifest-listed artifact hashes instead of comparing
  one flat lock hash.
- Agents inspect `topo.lock` or typed topo-store query views for graph detail.
  They should not reverse-engineer graph facts from `trails.lock`.
- Topographer owns the durable artifact family: derivation, hashing, semantic
  diffing, lock/topo I/O, topo-store exports, and query views.
- Pre-v1 breaking changes are acceptable here. The old `SurfaceMap`,
  `_surface.json`, `surface_map`, `serialized_lock`, `.trails/trails.db`, and
  `.trails/config/local.*` target-state names should retire from active docs and
  implementation surfaces as follow-up PRs land.

## Non-goals

- This ADR does not add a new artifact kind taxonomy beyond the v1 manifest
  roles needed for `topo.lock`.
- This ADR does not define schema URI grammar for artifact schemas.
- This ADR does not require Warden placement rules for `.trails/` paths in v1.
- This ADR does not add a separate committed contract-detail file. Contract
  detail belongs in `TopoGraph` and typed query views unless future evidence
  proves it needs its own artifact.

## References

- [ADR-0010: Trails-Native Infrastructure Pattern](0010-native-infrastructure.md)
- [ADR-0011: Schema-Driven Config](0011-schema-driven-config.md)
- [ADR-0015: Topo Store](0015-topo-store.md)
- [ADR-0017: The Serialized Topo Graph](0017-serialized-topo-graph.md)
- [ADR-0042: Core/Topographer Boundary Doctrine](0042-core-topographer-boundary-doctrine.md)
- [ADR-0045: v1 Resolved Graph Error Scope](0045-v1-resolved-graph-error-scope.md)
