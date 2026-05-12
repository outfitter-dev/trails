# Local Review Round 3 - Persistence Honesty Lane

Date: 2026-05-12
Branch reviewed: `trl-637-audit-release-process-and-beta-to-10-cutover-requirements`
Scope: Persistence honesty and artifact-family claims at the current stack tip.

## Result

Clean for P0/P1/P2 in this lane.

The current docs, implementation, and focused tests distinguish the SQL
`topo_surfaces` operational projection from canonical saved `TopoGraph` contract
detail. Agent-facing docs also keep `.trails/trails.lock` and
`.trails/topo.lock` moving together for compile, verify, and pre-deployment
workflows. Legacy root DB sidecars and stale `.trails/dev/` /
`.trails/generated/` paths are treated as retired or cleanup-only vocabulary,
not required current state.

Round 1's P2 docs overclaim is fixed. The only residual from prior persistence
rounds is the already-classified P3 historical ADR-0015 polish note; I did not
promote that to a blocker.

## Findings

| Severity | Owning branch | Finding | Recommended action |
| --- | --- | --- | --- |
| None P0/P1/P2 | None | No blocking persistence-honesty issue found in the required artifacts. | No action required for this lane. |
| P3 carried from round 1 | `trl-656-make-persisted-surface-rows-complete-or-explicitly-partial` if touched | Round 1 noted that historical `docs/adr/0015-topo-store.md` still describes the aspirational `topo_surfaces` target shape. It was already classified P3 because active docs now teach the current v1 CLI-only row posture. ADR-0015 was not part of this round's required source-artifact list. | Optional follow-up only: add a historical note in ADR-0015 pointing readers to the active topo-store reference. |

## Evidence

### Predicate 1 - SQL rows are operational, saved TopoGraph is canonical detail

The plan's required posture for TRL-656 is explicit:

`.agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md:156-164`

```text
Persisted `topo_surfaces` rows should be documented and tested as an operational query projection, not the canonical complete surface graph. The complete resolved surface detail lives in `TopoGraph`. This matches the current implementation comment in `normalizeSurfaceRows()`, avoids premature SQL schema expansion, and keeps the artifact doctrine honest.

Implementation guidance:

- Make the partial-row posture explicit in code comments/TSDoc and docs.
- Tests should prove consumers can distinguish the row projection from full TopoGraph detail.
- Do not imply SQL rows are complete unless the branch actually makes them complete across CLI/MCP/HTTP/WebSocket.
```

The active reference doc now narrows the SQL table and avoids the round 1
overclaim:

`docs/topo-store-reference.md:171-177`

```text
This table is an operational query projection, not the canonical complete
surface graph. In the current v1 posture it records CLI-derived rows only:
`surface = 'cli'`, the CLI command name in `derived_name`, and `method = NULL`.
Schema-rich contract detail lives in the saved `TopoGraph`
(`topo_exports.topo_graph`) and the typed `store.topoGraph` / `store.entries`
accessors. Today its surface-related facts are the authored `surfaces` list and
CLI path metadata; complete multi-surface projection rows remain future work.
```

The detailed record docs keep the two fields separate:

`docs/topo-store-reference.md:364-370`

```text
Extends trail record with `crosses`, `detours`, `resources`, and `examples`
arrays. It also carries resolved `TopoGraph` contract facts for blind agents:
`input`, `output`, `cli`, `surfaces`, `surfaceProjections`, `contours`,
`contourDetails`, `activationContext`, `activationEdges`, `activationSources`,
`fieldOverrides`, `layers`, and `governance`. `surfaceProjections` are the
operational rows from `topo_surfaces`; `surfaces` and the schema-rich contract
fields come from the saved `TopoGraph`.
```

Implementation matches the docs:

`packages/topographer/src/internal/topo-store.ts:591-608`

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
```

The read path pulls SQL surface rows into `surfaceProjections` and combines them
with saved `TopoGraph` detail without making the rows canonical:

`packages/topographer/src/internal/topo-store-read.ts:381-390`

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
```

`packages/topographer/src/internal/topo-store-read.ts:520-542`

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

Tests lock the same distinction:

`packages/topographer/src/__tests__/topo-store.test.ts:375-388`

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

`packages/topographer/src/__tests__/topo-store-read.test.ts:681-720`

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
```

### Predicate 2 - Agent-facing docs move trails.lock and topo.lock together

ADR-0046 defines the artifact family and the roles:

`docs/adr/0046-lock-v3-artifact-family.md:35-40`

```text
Lock v3 is a committed artifact family:

- `.trails/trails.lock` is the compact manifest.
- `.trails/topo.lock` is the serialized `TopoGraph` content artifact.

Both files are generated, committed, framework-owned `.lock` artifacts.
```

`docs/adr/0046-lock-v3-artifact-family.md:150-155`

```text
- Ordinary contract changes keep a small manifest diff while the inspectable
  graph remains available in `topo.lock`.
- CI and Warden verify the manifest-listed artifact hashes instead of comparing
  one flat lock hash.
- Agents inspect `topo.lock` or typed topo-store query views for graph detail.
  They should not reverse-engineer graph facts from `trails.lock`.
```

The topo-store doc says compile writes both files, verify checks the family, and
pre-deployment commits both:

`docs/topo-store.md:92-117`

````text
### `trails topo compile`

Compile the current topo to `.trails/topo.lock` and `.trails/trails.lock`.

```bash
trails topo compile
```

### `trails topo verify`

Check that the `.trails/trails.lock` / `.trails/topo.lock` artifact family
matches your current topo. Fails if either committed artifact has drifted.
````

```text
1. Make topology changes
2. Compile: `trails topo compile`
3. Commit `.trails/trails.lock` and `.trails/topo.lock`
4. In CI, verify: `trails topo verify`
```

The migration doc also introduces the same paired artifact family:

`docs/migration/topograph-artifact-family.md:3-12`

```text
The v1 topo artifact family uses a compact manifest plus an inspectable graph
content artifact:

- `.trails/trails.lock` is the committed lock v3 manifest.
- `.trails/topo.lock` is the committed serialized `TopoGraph` content artifact.
- `.trails/state/trails.db` is ignored mutable SQLite state for snapshots,
  pins, tracing, and other framework subsystems.
- `.trails/cache/` is ignored rebuildable cache state.
- `.trails/config.local.ts` and `.trails/config.local.js` are ignored local
  override files.
```

Implementation persists the manifest and graph content together:

`packages/topographer/src/internal/topo-store.ts:1315-1321`

```text
artifacts: [{ path: 'topo.lock', role: 'topo', sha256: hash }],
scope: { app: topo.name },
summary: {
  contours: countEntriesForKind(topoGraph.entries, 'contour'),
  resources: countEntriesForKind(topoGraph.entries, 'resource'),
  signals: countEntriesForKind(topoGraph.entries, 'signal'),
  trails: countEntriesForKind(topoGraph.entries, 'trail'),
```

`packages/topographer/src/internal/topo-store.ts:1541-1549`

```text
db.run(
  `INSERT INTO topo_exports (
    snapshot_id, topo_graph, topo_graph_hash, lock_manifest
  ) VALUES (?, ?, ?, ?)`,
  [
    exportRow.snapshotId,
    exportRow.topoGraph,
    exportRow.topoGraphHash,
    exportRow.lockManifest,
```

Tests assert the manifest artifact points at `topo.lock` with the stored graph
hash:

`packages/topographer/src/__tests__/topo-store.test.ts:699-707`

```text
const lock = JSON.parse(stored.lockManifestJson);
expect(lock).toMatchObject({
  artifacts: [
    { path: 'topo.lock', role: 'topo', sha256: stored.topoGraphHash },
  ],
  scope: { app: 'projection-app' },
  summary: { contours: 1, resources: 2, signals: 1, trails: 2 },
  version: 3,
});
```

### Predicate 3 - Legacy sidecars and stale directories are not required

ADR-0046 makes `.trails/state/trails.db` the hard-cut path and rejects silent
fallback to the old root DB:

`docs/adr/0046-lock-v3-artifact-family.md:123-125`

```text
The default local SQLite path is `.trails/state/trails.db`. This is a pre-v1
hard cut from `.trails/trails.db`; runtime and tooling should not silently read
fallback data from the legacy root database path.
```

The migration doc treats old root DB files and stale directories as migration
cleanup or rename-map entries:

`docs/migration/topograph-artifact-family.md:37-52`

````text
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

Do not commit any `.trails/state/trails.db*` files.
````

The requested implementation and test artifacts do not require old root sidecar
paths or stale workspace directories:

```text
$ rg -n '\.trails/trails\.db|\.trails/dev|\.trails/generated|trails\.db-shm|trails\.db-wal' packages/topographer/src/__tests__/topo-store.test.ts packages/topographer/src/__tests__/topo-store-read.test.ts packages/topographer/src/internal/topo-store.ts packages/topographer/src/internal/topo-store-read.ts
<no matches>
```

Current local `.trails` state also has no stale `dev/` or `generated/`
directories and no DB sidecars:

```text
$ /usr/bin/find .trails -maxdepth 3 -type d -print
.trails
.trails/config
.trails/clark

$ /usr/bin/find .trails -maxdepth 3 -type f -print
.trails/.gitignore
.trails/clark/survey-latest.md
.trails/clark/decisions.md
```

`.trails/.gitignore:5-9`

```text
# Rebuildable cache
cache/

# Mutable runtime state
state/
```

### Predicate 4 - Prior P0/P1/P2 closure

Round 1 found one P2:

`.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-persistence-round-1.md:25-33`

```text
## P2 Findings

### P2 - Topo store docs overclaim complete non-CLI surface detail in TopoGraph

Owning branch: `trl-656-make-persisted-surface-rows-complete-or-explicitly-partial` for the minimal docs fix. If the intended resolution is to add real complete non-CLI projection data, ownership moves to `trl-657-add-complete-resolved-contract-detail-view-for-blind-agents`.

Finding:

`docs/topo-store-reference.md:171-176` correctly says `topo_surfaces` is partial, but then claims the saved TopoGraph contains "non-CLI surface attachments and rich projection metadata."
```

Round 2 marked that fixed:

`.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-persistence-round-2.md:7-11`

```text
## Result

No P0/P1/P2 findings.

The round 1 P2 in `docs/topo-store-reference.md` is fixed. The reference now says `topo_surfaces` is an operational CLI-only row projection and narrows saved `TopoGraph` surface-related facts to the authored `surfaces` list plus CLI path metadata, with complete multi-surface projection rows left as future work.
```

This round independently verified the fixed text in
`docs/topo-store-reference.md:171-177` above.

## Test Result

```text
$ bun test packages/topographer/src/__tests__/topo-store.test.ts packages/topographer/src/__tests__/topo-store-read.test.ts
29 pass
0 fail
171 expect() calls
Ran 29 tests across 2 files. [395.00ms]
```

## Commands Run

```text
rg -n "M4b|topograph|persistence|artifact-family|topo-store|local-review-persistence" /Users/mg/.codex/memories/MEMORY.md
pwd
rg --files .agents/plans/2026-05-12-topograph-query-docs-stack docs packages/topographer/src | rg "(PLAN.md|0046-lock-v3-artifact-family.md|topo-store.md|topo-store-reference.md|topograph-artifact-family.md|topo-store(-read)?\\.ts|topo-store(-read)?\\.test\\.ts|local-review-persistence-round-[12]\\.md|local-review-persistence-round-3\\.md)$"
wc -l <required source artifacts and prior reports>
rg -n -C 3 "persistence|persisted|topo.lock|trails.lock|topograph|TopoGraph|topo-store|artifact|verify|deploy|P0|P1|P2|local-review" .agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md
nl -ba .agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-persistence-round-1.md
nl -ba .agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-persistence-round-2.md
nl -ba .agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-persistence-round-3.md
qmd search "topo_surfaces operational CLI-derived TopoGraph"
qmd search "topo.lock trails.lock artifact family verify deploy"
qmd search "trails.db state generated sidecar"
rg -n -C 4 <artifact-family patterns> docs/adr/0046-lock-v3-artifact-family.md docs/topo-store.md docs/topo-store-reference.md docs/migration/topograph-artifact-family.md
rg -n -C 6 <persistence patterns> packages/topographer/src/internal/topo-store.ts packages/topographer/src/internal/topo-store-read.ts packages/topographer/src/__tests__/topo-store.test.ts packages/topographer/src/__tests__/topo-store-read.test.ts
rg -n -C 3 "\\.trails/trails\\.db|\\.trails/dev|\\.trails/generated|\\.trails/state|trails\\.db-shm|trails\\.db-wal|sidecar|root SQLite" .agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md docs/adr/0046-lock-v3-artifact-family.md docs/topo-store.md docs/topo-store-reference.md docs/migration/topograph-artifact-family.md packages/topographer/src/internal/topo-store.ts packages/topographer/src/internal/topo-store-read.ts packages/topographer/src/__tests__/topo-store.test.ts packages/topographer/src/__tests__/topo-store-read.test.ts
rg -n "\\.trails/trails\\.db|\\.trails/dev|\\.trails/generated|trails\\.db-shm|trails\\.db-wal" packages/topographer/src/__tests__/topo-store.test.ts packages/topographer/src/__tests__/topo-store-read.test.ts packages/topographer/src/internal/topo-store.ts packages/topographer/src/internal/topo-store-read.ts
rg -n "\\.trails/trails\\.db|\\.trails/dev|\\.trails/generated|trails\\.db-shm|trails\\.db-wal" docs/topo-store.md docs/topo-store-reference.md docs/migration/topograph-artifact-family.md docs/adr/0046-lock-v3-artifact-family.md
bun test packages/topographer/src/__tests__/topo-store.test.ts packages/topographer/src/__tests__/topo-store-read.test.ts
git status --short .trails .agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-persistence-round-3.md
git ls-files .trails
/usr/bin/find .trails -maxdepth 3 -type d -print
/usr/bin/find .trails -maxdepth 3 -type f -print
git diff --cached --name-status
git status --short --branch
nl -ba .trails/.gitignore
git diff -- .agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-persistence-round-3.md
git status --short --branch
```

Note: an initial docs `rg` pattern used unescaped Markdown backticks around
`TopoGraph`, which made zsh emit `command not found: TopoGraph`. I discarded
that attempt and reran the docs searches with quoted patterns; all evidence
above comes from the successful reruns.

## Unknowns

- I did not inspect remote CI, PR review threads, or any remote branch state.
- I did not audit every active doc in the repo; I read the required source
  artifacts and used targeted searches for this lane's exact vocabulary.
- I did not re-review ADR-0015 beyond the prior reports' P3 note because it was
  not part of this round's required source-artifact list.
- Final `git status --short --branch` showed other round-3 lane report changes
  in this reports directory. I left those unrelated files untouched.
- This report is the only file I intentionally wrote.
