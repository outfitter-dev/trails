# Local Review Round 2 - Persistence Honesty Lane

Date: 2026-05-12
Branch reviewed: `trl-637-audit-release-process-and-beta-to-10-cutover-requirements`
Scope: TRL-656 persistence-honesty fix after round 1, with the current stack tip visible.

## Result

No P0/P1/P2 findings.

The round 1 P2 in `docs/topo-store-reference.md` is fixed. The reference now says `topo_surfaces` is an operational CLI-only row projection and narrows saved `TopoGraph` surface-related facts to the authored `surfaces` list plus CLI path metadata, with complete multi-surface projection rows left as future work.

Focused validation passed:

```bash
bun test packages/topographer/src/__tests__/topo-store.test.ts packages/topographer/src/__tests__/topo-store-read.test.ts
```

Result: 29 pass, 0 fail, 171 assertions.

## P0/P1/P2 Findings

None.

## Evidence

### Round 1 P2 docs mismatch is fixed

`docs/topo-store-reference.md:171-177` now explicitly distinguishes partial SQL rows from saved graph facts and avoids claiming complete non-CLI projection metadata exists today:

```text
This table is an operational query projection, not the canonical complete
surface graph. In the current v1 posture it records CLI-derived rows only:
`surface = 'cli'`, the CLI command name in `derived_name`, and `method = NULL`.
Schema-rich contract detail lives in the saved `TopoGraph`
(`topo_exports.topo_graph`) and the typed `store.topoGraph` / `store.entries`
accessors. Today its surface-related facts are the authored `surfaces` list and
CLI path metadata; complete multi-surface projection rows remain future work.
```

This matches the TRL-656 plan posture in `.agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md:158-164`:

```text
Persisted `topo_surfaces` rows should be documented and tested as an operational query projection, not the canonical complete surface graph. The complete resolved surface detail lives in `TopoGraph`. This matches the current implementation comment in `normalizeSurfaceRows()`, avoids premature SQL schema expansion, and keeps the artifact doctrine honest.

Implementation guidance:

- Make the partial-row posture explicit in code comments/TSDoc and docs.
- Tests should prove consumers can distinguish the row projection from full TopoGraph detail.
- Do not imply SQL rows are complete unless the branch actually makes them complete across CLI/MCP/HTTP/WebSocket.
```

### Persisted `topo_surfaces` rows remain explicitly CLI-only

`packages/topographer/src/internal/topo-store.ts:591-609` documents and implements the current row projection as CLI-derived:

```text
/**
 * Project surface rows for stored topo.
 *
 * Currently records only CLI-derived rows. MCP, HTTP, and other surface
 * projections are intentionally deferred until the topo-store schema supports
 * multi-surface representation. The JSON export (`topo_graph` in
 * `topo_exports`) is more faithful for now. See ADR-0015 for the target shape.
 */
const normalizeSurfaceRows = (
  trails: readonly AnyTrail[],
  snapshotId: string
): readonly TopoSurfaceRow[] =>
  trails.map((trail) => ({
    derivedName: deriveCliPath(trail.id).join(' '),
    method: null,
    snapshotId,
    surface: 'cli',
    trailId: trail.id,
  }));
```

`packages/topographer/src/__tests__/topo-store.test.ts:375-388` asserts those rows as CLI rows with `method: null`:

```text
expect(readSurfaceRows(db, snapshotId)).toEqual([
  {
    derived_name: 'entity add',
    method: null,
    surface: 'cli',
    trail_id: 'entity.add',
  },
  {
    derived_name: 'entity list',
    method: null,
    surface: 'cli',
    trail_id: 'entity.list',
  },
]);
```

### Typed reads preserve the row-vs-graph distinction

`packages/topographer/src/internal/topo-store-read.ts:381-399` maps SQL rows into `TopoStoreSurfaceProjectionRecord` only:

```text
const readTrailSurfaceProjections = (
  db: Database,
  snapshotId: string,
  trailId: string
): readonly TopoStoreSurfaceProjectionRecord[] =>
  db
    .query<TopoSurfaceProjectionRow, [string, string]>(
      `SELECT trail_id, surface, derived_name, method
       FROM topo_surfaces
       WHERE snapshot_id = ? AND trail_id = ?
       ORDER BY surface ASC, derived_name ASC`
    )
    .all(snapshotId, trailId)
    .map((row) => ({
      derivedName: row.derived_name,
      method: row.method,
      surface: row.surface,
      trailId: row.trail_id,
    }));
```

`packages/topographer/src/internal/topo-store-read.ts:520-542` keeps SQL row projections and saved `TopoGraph` facts in separate fields:

```text
const storedTopoGraph = readStoredTopoGraph(db, snapshotId);
const storedEntry = findTopoGraphEntry(storedTopoGraph, 'trail', trailId);
const entryDetail = mapStoredTrailEntryDetail(storedEntry);

return {
  activationContext: mapActivationContext(storedTopoGraph),
  activationEdges: readTrailActivationEdges(storedTopoGraph, trailId),
  activationSources: entryDetail.activationSources,
  cli: entryDetail.cli,
  contourDetails: readTrailContourDetails(
    storedTopoGraph,
    snapshotId,
    entryDetail.contours
  ),
  contours: entryDetail.contours,
  detours: entryDetail.detours,
  fieldOverrides: entryDetail.fieldOverrides,
  governance: entryDetail.governance,
  input: entryDetail.input,
  layers: entryDetail.layers,
  output: entryDetail.output,
  surfaceProjections: readTrailSurfaceProjections(db, snapshotId, trailId),
  surfaces: entryDetail.surfaces,
};
```

`docs/topo-store-reference.md:364-370` describes the same API distinction:

```text
Extends trail record with `crosses`, `detours`, `resources`, and `examples`
arrays. It also carries resolved `TopoGraph` contract facts for blind agents:
`input`, `output`, `cli`, `surfaces`, `surfaceProjections`, `contours`,
`contourDetails`, `activationContext`, `activationEdges`, `activationSources`,
`fieldOverrides`, `layers`, and `governance`. `surfaceProjections` are the
operational rows from `topo_surfaces`; `surfaces` and the schema-rich contract
fields come from the saved `TopoGraph`.
```

`packages/topographer/src/__tests__/topo-store-read.test.ts:681-725` covers that distinction from the consumer side:

```text
test('distinguishes CLI surface rows from canonical TopoGraph detail', async () => {
  const rootDir = makeRoot();
  const snapshot = await expectOk(
    createTopoSnapshot(graphAttachmentApp(), {
      createdAt: '2026-04-03T16:30:00.000Z',
      gitSha: 'abc123',
      rootDir,
    })
  );
  const store = createTopoStore({ rootDir });

  expect(
    store.query<{
      derived_name: string;
      method: string | null;
      surface: string;
      trail_id: string;
    }>(
      `SELECT trail_id, surface, derived_name, method
       FROM topo_surfaces
       WHERE snapshot_id = ?
       ORDER BY trail_id ASC, surface ASC`,
      [snapshot.id]
    )
  ).toEqual([
    {
      derived_name: 'entity process',
      method: null,
      surface: 'cli',
      trail_id: 'entity.process',
    },
  ]);

  const graphDetail = store.entries.get('entity.process', {
    kind: 'trail',
    snapshot: { snapshotId: snapshot.id },
  });
  expect(graphDetail).toEqual(
    expect.objectContaining({
      activationSources: expect.any(Array),
      fieldOverrides: expect.any(Array),
      layers: expect.any(Array),
      output: expect.objectContaining({ type: 'object' }),
    })
  );
});
```

### ADR-0046 and migration docs stay aligned

ADR-0046 keeps graph detail in `topo.lock` and typed topo-store query views, not in `trails.lock` or reverse-engineered row projections. `docs/adr/0046-lock-v3-artifact-family.md:150-155`:

```text
- Ordinary contract changes keep a small manifest diff while the inspectable
  graph remains available in `topo.lock`.
- CI and Warden verify the manifest-listed artifact hashes instead of comparing
  one flat lock hash.
- Agents inspect `topo.lock` or typed topo-store query views for graph detail.
  They should not reverse-engineer graph facts from `trails.lock`.
```

The migration guide keeps the artifact family roles clear. `docs/migration/topograph-artifact-family.md:56-69`:

````text
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
````

## Unknowns

- I did not inspect remote CI, PR review threads, or branches below the current stack tip.
- I did not run broad repository gates; only the focused persistence tests requested for this lane.
- I did not change source files. This report is the only file written.
