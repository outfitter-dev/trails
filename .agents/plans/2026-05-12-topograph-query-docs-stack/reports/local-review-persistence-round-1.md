# Local Review Round 1 - Persistence Honesty Lane

Date: 2026-05-12
Branch reviewed: `trl-637-audit-release-process-and-beta-to-10-cutover-requirements`
Scope: TRL-656 persistence honesty plus interactions with TRL-655 and TRL-657.

## Result

Found 1 P2 documentation mismatch and 1 P3 polish note.

The implementation separates partial SQL rows from saved TopoGraph detail in the API shape:

- `TopoStoreTrailDetailRecord.surfaceProjections` is populated from `topo_surfaces`.
- `TopoStoreTrailDetailRecord.surfaces` and the schema-rich fields are populated from the saved TopoGraph entry.
- `store.trails.list()` does not expose surface facts, so the list API does not appear to promote partial rows as canonical complete surface data.

Focused validation passed:

```bash
bun test packages/topographer/src/__tests__/topo-store.test.ts packages/topographer/src/__tests__/topo-store-read.test.ts
```

Result: 29 pass, 0 fail, 171 assertions.

## P2 Findings

### P2 - Topo store docs overclaim complete non-CLI surface detail in TopoGraph

Owning branch: `trl-656-make-persisted-surface-rows-complete-or-explicitly-partial` for the minimal docs fix. If the intended resolution is to add real complete non-CLI projection data, ownership moves to `trl-657-add-complete-resolved-contract-detail-view-for-blind-agents`.

Finding:

`docs/topo-store-reference.md:171-176` correctly says `topo_surfaces` is partial, but then claims the saved TopoGraph contains "non-CLI surface attachments and rich projection metadata." The current TopoGraph type and derivation do not support that full claim: surface-related fields are `surfaces` and optional `cli`, with no MCP or HTTP projection metadata in `TopoGraphEntry`.

Verbatim quote:

```text
This table is an operational query projection, not the canonical complete
surface graph. In the current v1 posture it records CLI-derived rows only:
`surface = 'cli'`, the CLI command name in `derived_name`, and `method = NULL`.
Complete resolved graph detail, including non-CLI surface attachments and rich
projection metadata, lives in the saved `TopoGraph` (`topo_exports.topo_graph`)
and the typed `store.topoGraph` / `store.entries` accessors.
```

Evidence:

`packages/topographer/src/types.ts:98-106` only defines `surfaces` and optional `cli` as surface-adjacent TopoGraph entry fields:

```text
export interface TopoGraphEntry {
  readonly id: string;
  readonly kind: 'contour' | 'trail' | 'signal' | 'resource';
  readonly surfaces: readonly string[];
  readonly cli?:
    | {
        readonly path: readonly string[];
      }
    | undefined;
```

`packages/topographer/src/derive.ts:527-539` derives the same shape:

```text
const trailToEntry = (
  t: Trail<unknown, unknown, unknown>,
  topoLayers: readonly Layer[]
): TopoGraphEntry => {
  const raw = t as unknown as Record<string, unknown>;
  const surfaces = extractSurfaces(raw);
  const entry: Record<string, unknown> = {
    cli: { path: deriveCliPath(t.id) },
    exampleCount: Array.isArray(t.examples) ? t.examples.length : 0,
    id: t.id,
    kind: t.kind,
    surfaces,
  };
```

Recommended action:

Narrow `docs/topo-store-reference.md:174-176` so it says the schema-rich contract detail lives in TopoGraph, while the current surface-related TopoGraph facts are the authored `surfaces` attachment list and CLI path. Do not describe non-CLI projection metadata as present until MCP/HTTP/WebSocket projection records actually exist in TopoGraph and are covered by tests.

Suggested replacement shape:

```text
Schema-rich contract detail lives in the saved `TopoGraph`
(`topo_exports.topo_graph`) and the typed `store.topoGraph` / `store.entries`
accessors. Today its surface-related facts are the authored `surfaces` list and
CLI path metadata; complete multi-surface projection rows remain future work.
```

Validation after fix:

```bash
bun test packages/topographer/src/__tests__/topo-store.test.ts packages/topographer/src/__tests__/topo-store-read.test.ts
bun run format:check
```

## P3 Polish

### P3 - ADR-0015 still reads like `topo_surfaces` is complete across shipped surfaces

Owning branch: `trl-656-make-persisted-surface-rows-complete-or-explicitly-partial` if touched, otherwise safe to leave as historical ADR text.

Finding:

`docs/adr/0015-topo-store.md` is historical accepted ADR text, so I am not treating this as a blocker. Still, it is an easy place for a future agent to rediscover the wrong posture because it describes `topo_surfaces` as if it includes CLI, MCP, and HTTP rows.

Verbatim quote:

`docs/adr/0015-topo-store.md:132-138`:

```text
-- Surface mappings (which surfaces expose which trails)
CREATE TABLE topo_surfaces (
  trail_id TEXT NOT NULL,
  surface TEXT NOT NULL,          -- 'cli' | 'mcp' | 'http'
  derived_name TEXT NOT NULL,     -- CLI command path, MCP tool name, HTTP route
  method TEXT,                    -- HTTP method (null for CLI/MCP)
  snapshot_id TEXT NOT NULL,
```

Recommended action:

Optional docs polish: add a short note near this schema saying the current v1 implementation intentionally stores only CLI operational rows in `topo_surfaces`, with the active reference at `docs/topo-store-reference.md`.

Validation after optional polish:

```bash
bun scripts/adr.ts check
bun run format:check
```

## Clean Checks

The following expectations were verified from the current stack tip:

- `packages/topographer/src/internal/topo-store.ts:591-609` explicitly comments that SQL surface rows currently record only CLI-derived rows.
- `packages/topographer/src/__tests__/topo-store.test.ts:252-271` reads `trail_id`, `surface`, `derived_name`, and `method`, then `packages/topographer/src/__tests__/topo-store.test.ts:375-388` asserts only CLI rows with `method: null`.
- `packages/topographer/src/__tests__/topo-store-read.test.ts:681-725` proves consumers can distinguish the CLI row projection from richer saved TopoGraph detail.
- `packages/topographer/src/internal/topo-store-read.ts:381-399` reads SQL rows into `TopoStoreSurfaceProjectionRecord`.
- `packages/topographer/src/internal/topo-store-read.ts:499-543` builds trail graph detail by combining saved TopoGraph entry detail with `surfaceProjections`.
- `packages/topographer/src/internal/topo-store-read.ts:816-835` returns both `surfaceProjections` and `surfaces` with distinct names.
- `docs/topo-store-reference.md:367-369` explicitly says `surfaceProjections` are operational rows from `topo_surfaces`, while `surfaces` and schema-rich fields come from saved TopoGraph.
- `docs/migration/topograph-artifact-family.md` and `docs/lexicon.md` use ADR-0046 vocabulary accurately for `.trails/trails.lock`, `.trails/topo.lock`, `topo_graph`, `lock_manifest`, `.trails/state/`, `.trails/cache/`, and `.trails/config.local.{ts,js}`.

## Unknowns

- I did not inspect every active doc in the repository, only the named anchors plus targeted `rg` evidence around `topo_surfaces`, `surfaceProjections`, and surface vocabulary.
- I did not validate remote CI or review comments.
- I did not change source files. This report is the only file written.
