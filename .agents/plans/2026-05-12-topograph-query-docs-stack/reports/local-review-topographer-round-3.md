# Local Review: Topographer Round 3

Lane: Topographer API and persisted/direct projection consistency.

Stack tip reviewed: `trl-637-audit-release-process-and-beta-to-10-cutover-requirements`.

## Result

Clean for P0/P1/P2. Round 1's survey-detail P2 is fixed, and round 2's direct `deriveTopoGraph` webhook projection P2 is fixed. I found one residual P3 docs-only export-list gap from rounds 1-2; it is not an implementation, schema, type, or test blocker.

Unknowns:

- I did not run the full repo `bun run check` or inspect remote PR/CI state.
- This pass reviewed the local stack tip only. It did not validate Linear issue state or GitHub review threads.

## Findings

| Severity | Owning branch | Finding | Recommended action |
| --- | --- | --- | --- |
| P3 | `TRL-653` docs/API sweep, with exported type additions originating in `TRL-655`/`TRL-657` | Compact `docs/api-reference.md` still omits several public topo-store record types that are exported and documented in the deeper topo-store reference. This was reported in rounds 1-2 and remains docs-only. | Add `TopoStoreContourRecord`, `TopoStoreEntryKind`, `TopoStoreSignalDetailRecord`, `TopoStoreSignalRecord`, `TopoStoreTopoGraphEntryRecord`, and `TopoStoreTopoGraphRecord` to the compact `@ontrails/topographer` type list in `docs/api-reference.md`. |

No P0/P1/P2 findings remain in this lane.

## Evidence

Representative file:line quotes anchoring the review:

- `.agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md:190-194` quotes: "Prefer extending the existing trail detail path (`topoStore.trails.get(...)` and `survey.trail`)" and "CLI/MCP-facing output schemas must match actual returned shape."
- `docs/adr/0046-lock-v3-artifact-family.md:81-83` quotes: "It contains the serialized `TopoGraph`: every trail, signal, resource, and contour with their schemas, examples, relationships, activation data, governance metadata, and surface projections."
- `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-topographer-round-2.md:36-38` quotes: "P2: Direct `deriveTopoGraph` activation sources still use the older local projection" and "Owning branch: `TRL-657`".
- `packages/topographer/src/derive.ts:150-153` quotes: "const projectActivationSource = (" and "projectActivationSourceDeclaration(source) as TopoGraphActivationSource".
- `apps/trails/src/trails/topo-output-schemas.ts:23-26` quotes: "method: z.string().optional(),", "parseOutputSchema: jsonSchemaOutput.optional(),", "path: z.string().optional(),", and "payloadSchema: jsonSchemaOutput.optional(),".
- `packages/topographer/src/internal/topo-store-read.ts:87-107` quotes `TopoStoreTrailDetailRecord` fields including "activationContext", "activationSources", "fieldOverrides", "governance", "input", "layers", "output", "surfaceProjections", and "surfaces".

### Review Brief And Prior Rounds

- `.agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md:10` says: "Do not use the Trails skill for this work."
- `.agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md:130-135` says typed topo-store views should stay accessors over canonical saved state, cover contours, surfaces, layers, activation metadata, field overrides, examples, schemas, and empty/missing cases.
- `.agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md:156-165` says persisted `topo_surfaces` rows are an operational query projection and complete resolved surface detail lives in `TopoGraph`.
- `.agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md:190-194` says the blind-agent detail view should include surfaces, schemas, examples, intent, crosses, resources, activation sources/edges/context, contours, field overrides/layer context, governance metadata, and matching CLI/MCP schemas.
- `.agents/plans/2026-05-12-topograph-query-docs-stack/REFS.md:37-40` identifies `TRL-655`, `TRL-656`, and `TRL-657` as the typed query, persisted-row honesty, and blind-agent detail branches.
- `docs/adr/0046-lock-v3-artifact-family.md:81-83` says `topo.lock` contains serialized `TopoGraph` entries with schemas, examples, relationships, activation data, governance metadata, and surface projections.
- `docs/adr/0046-lock-v3-artifact-family.md:154-157` says agents should inspect `topo.lock` or typed topo-store query views for graph detail, and Topographer owns query views.
- `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-topographer-round-1.md:11-38` reported a P2 where `survey.trail` dropped activation source schemas.
- `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-topographer-round-2.md:11-17` verified the round-1 survey fix through the shared projection helper.
- `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-topographer-round-2.md:36-88` then reported a P2 where direct `deriveTopoGraph` still used an older local projection.
- `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-topographer-round-2.md:96-122` carried forward the P3 compact API reference omission.

### Predicate 1: Direct, Persisted, And Survey Webhook Projection Shape

The current direct `deriveTopoGraph` path uses the shared core projector that includes webhook `method`, `path`, `hasVerify`, `parseOutputSchema`, and `payloadSchema`.

- `packages/core/src/activation-source-projection.ts:138-166` says the shared projector sets webhook `method`, sets `hasParse` and `parseOutputSchema`, normalizes `path`, sets `hasPayloadSchema` and `payloadSchema`, and sets `hasVerify`.
- `packages/topographer/src/derive.ts:5-16` imports `activationSourceKey` and `projectActivationSourceDeclaration` from `@ontrails/core`.
- `packages/topographer/src/derive.ts:150-153` defines `projectActivationSource(source)` as `projectActivationSourceDeclaration(source) as TopoGraphActivationSource`.
- `packages/topographer/src/derive.ts:178-188` collects direct `deriveTopoGraph` activation sources by calling that projector and storing them by `projected.key`.
- `packages/topographer/src/derive.ts:347-354` stores per-entry trail activation source detail with `source: projectActivationSource(activation.source)`.
- `packages/topographer/src/derive.ts:620-635` returns the `TopoGraph` with `activationGraph`, `activationSources`, `entries`, `generatedAt`, and `topoGraphSchemaVersion`.

The persisted topo-store export also uses the same shared projector and writes the result into stored graph JSON.

- `packages/topographer/src/internal/topo-store.ts:436-439` defines its activation source projector as `projectActivationSourceDeclaration(source)`.
- `packages/topographer/src/internal/topo-store.ts:922-929` stores per-entry activation source detail with `source: projectActivationSource(activation.source)`.
- `packages/topographer/src/internal/topo-store.ts:1247-1296` builds the stored `TopoGraph` with `activationSources` from `collectActivationSourceCatalog(trails)` plus the same entry family.
- `packages/topographer/src/internal/topo-store.ts:1537-1549` inserts `topo_graph`, `topo_graph_hash`, and `lock_manifest` into `topo_exports`.
- `packages/topographer/src/internal/topo-store.ts:1554-1574` reads persisted `topo_graph` back as `topoGraphJson`.

The survey path exposes the same activation source shape and the output schema accepts it.

- `apps/trails/src/trails/topo-activation.ts:21-37` defines `ActivationSourceReport` with `hasVerify`, `method`, `parseOutputSchema`, `path`, and `payloadSchema`.
- `apps/trails/src/trails/topo-activation.ts:156-159` projects survey activation sources through `projectActivationSourceDeclaration`.
- `apps/trails/src/trails/topo-activation.ts:184-194` collects activation sources by that projected `key`.
- `apps/trails/src/trails/topo-output-schemas.ts:11-29` defines `activationSourceOutput` with `hasParse`, `hasPayloadSchema`, `hasVerify`, `method`, `parseOutputSchema`, `path`, and `payloadSchema`.
- `apps/trails/src/__tests__/survey.test.ts:982-1034` asserts `deriveTrailDetail(...).activationSources` for a webhook includes `hasVerify: true`, `method: 'POST'`, `path`, `parseOutputSchema`, and `payloadSchema`, and passes `trailDetailOutput.safeParse`.
- `packages/topographer/src/__tests__/derive.test.ts:417-464` asserts the direct `deriveTopoGraph` webhook source includes the same fields.
- `packages/topographer/src/__tests__/topo-store.test.ts:1130-1183` asserts the persisted topo-store `topoGraph.activationSources` webhook source includes the same fields.

### Predicate 2: TopoStore Typed Views Over Saved TopoGraph

The typed store API is broad enough for blind agents across entries, contours, topoGraph, trail detail, surfaces, layers, activation, governance, and schemas.

- `packages/topographer/src/internal/topo-store-read.ts:34-47` defines `TopoStoreTopoGraphRecord`, `TopoStoreTopoGraphEntryRecord`, and `TopoStoreContourRecord`.
- `packages/topographer/src/internal/topo-store-read.ts:87-107` defines `TopoStoreTrailDetailRecord` with `activationContext`, `activationEdges`, `activationSources`, `cli`, `contourDetails`, `contours`, `crosses`, `detours`, `examples`, `fieldOverrides`, `governance`, `input`, `layers`, `output`, `resources`, `surfaceProjections`, and `surfaces`.
- `packages/topographer/src/internal/topo-store-read.ts:246-288` parses saved `topoGraphJson` and maps saved graph entries into typed `TopoStoreTopoGraphEntryRecord`s.
- `packages/topographer/src/internal/topo-store-read.ts:499-543` builds trail graph detail from the stored `TopoGraph`, including activation context/edges/sources, contour detail, field overrides, governance, input/output schemas, layers, surface projections, and surfaces.
- `packages/topographer/src/internal/topo-store-read.ts:694-703` exposes `getTopoStoreTopoGraph(...)` as `{ snapshot, topoGraph }`.
- `packages/topographer/src/internal/topo-store-read.ts:791-835` returns `store.trails.get(...)` detail by combining SQL row data with stored graph detail.
- `packages/topographer/src/internal/topo-store-read.ts:1032-1040` reads signal detail examples and payload from the stored graph entry.
- `packages/topographer/src/topo-store.ts:203-268` defines `ReadOnlyTopoStore` with typed `contours`, `entries`, `exports`, `resources`, `signals`, `snapshots`, `topoGraph`, and `trails` accessors.
- `packages/topographer/src/topo-store.ts:320-346` derives mock `topoGraphs`, `entries`, and `contours` from seeded exports/topoGraph content.
- `packages/topographer/src/topo-store.ts:535-633` wires the real store accessors to the read helpers.
- `packages/topographer/src/__tests__/topo-store-read.test.ts:504-679` covers saved `topoGraph`, `entries`, `trails.get(...)`, contour detail, layers, field overrides, activation context/sources/edges, schemas, signal entries, and missing entries.
- `packages/topographer/src/__tests__/topo-store-read.test.ts:681-725` proves SQL `topo_surfaces` is a CLI row projection while typed graph detail still exposes activation sources, field overrides, layers, and output schema.

### Predicate 3: Claimed Detail Fields Are Covered By Types, Output Schemas, And Tests

The direct and survey-facing claimed fields are covered by TypeScript interfaces, output schemas, and focused tests.

- `packages/topographer/src/types.ts:48-66` makes activation source webhook fields type-visible: `hasVerify`, `method`, `parseOutputSchema`, `path`, and `payloadSchema`.
- `packages/topographer/src/types.ts:101-155` defines `TopoGraphEntry` and `TopoGraph` fields for surfaces, CLI path, input/payload/output schemas, intent, permit, activation sources, crosses, contours, resources, fires/on, governance, field overrides, layers, detours, examples, and workspace metadata.
- `apps/trails/src/trails/topo-reports.ts:108-164` defines `TrailDetailReport` with the blind-agent detail fields, including activation, contours, field overrides, governance, layers, schemas, resources, surface projections, and surfaces.
- `apps/trails/src/trails/topo-reports.ts:421-525` derives graph detail from `deriveTopoGraph(app)` and returns activation context/edges, contour details, field overrides, governance, input/output schemas, layers, surface projections, and surfaces.
- `apps/trails/src/trails/topo-reports.ts:539-595` returns those graph-detail fields from `deriveTrailDetail`.
- `apps/trails/src/trails/topo-output-schemas.ts:96-151` defines `trailDetailOutput` with activation context/edges/sources, CLI, composed layers, contour details, crosses, detours, examples, field overrides, governance, input/output schemas, resources, surface projections, and surfaces.
- `apps/trails/src/__tests__/survey.test.ts:547-670` asserts survey trail detail includes resolved TopoGraph contract fields for blind agents and passes `trailDetailOutput.safeParse`.

I did not find a claimed direct-entry or survey-detail field missing from the relevant output schemas, TypeScript types, or focused tests.

### Predicate 4: Prior P0/P1/P2 Status

- Round 1 P2 (`survey.trail` activation source schemas) is fixed: `apps/trails/src/trails/topo-activation.ts:156-159` uses the shared projector, `apps/trails/src/trails/topo-output-schemas.ts:11-29` accepts the schema-bearing fields, and `apps/trails/src/__tests__/survey.test.ts:982-1034` covers the webhook shape.
- Round 2 P2 (direct `deriveTopoGraph` missing webhook `method`/`path`/`hasVerify`) is fixed: `packages/topographer/src/derive.ts:150-153` uses the shared projector, and `packages/topographer/src/__tests__/derive.test.ts:417-464` covers the webhook shape.
- No prior P0/P1 findings were present in the topographer round-1 or round-2 reports.
- The P3 compact API reference omission remains: `packages/topographer/src/index.ts:87-106` exports the newer topo-store types, while `docs/api-reference.md:227-232` lists only a subset. `docs/topo-store-reference.md:378-404` documents the saved graph entry/contour types, so this is docs polish rather than missing implementation.

## Commands Run

Read-only evidence commands:

- `nl -ba .agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md | sed -n '1,260p'`
- `nl -ba .agents/plans/2026-05-12-topograph-query-docs-stack/REFS.md | sed -n '1,260p'`
- `nl -ba docs/adr/0046-lock-v3-artifact-family.md | sed -n '1,260p'`
- `nl -ba .agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-topographer-round-1.md | sed -n '1,260p'`
- `nl -ba .agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-topographer-round-2.md | sed -n '1,320p'`
- `rg -n "webhook|activation|payloadSchema|parseOutputSchema|hasVerify|method|path|TopoGraph|topoGraph|surfaces|layers|governance|schemas|contours|entries|detail|survey" packages/topographer/src/derive.ts packages/topographer/src/types.ts packages/topographer/src/internal/topo-store-read.ts packages/topographer/src/topo-store.ts apps/trails/src/trails/topo-reports.ts apps/trails/src/trails/topo-output-schemas.ts apps/trails/src/trails/topo-activation.ts`
- `nl -ba` source slices from the required files plus `packages/core/src/activation-source-projection.ts`, `packages/topographer/src/internal/topo-store.ts`, `packages/topographer/src/index.ts`, `docs/api-reference.md`, `docs/topo-store-reference.md`, and focused test files.

Verification commands:

| Command | Output |
| --- | --- |
| `git status --short --branch` | `## trl-637-audit-release-process-and-beta-to-10-cutover-requirements` |
| `bun test packages/core/src/__tests__/activation-source-projection.test.ts` | 6 pass, 0 fail, 10 expect calls. |
| `bun test packages/topographer/src/__tests__/derive.test.ts packages/topographer/src/__tests__/topo-store.test.ts -t "activation source"` | 4 pass, 44 filtered out, 0 fail, 7 expect calls. |
| `bun test packages/topographer/src/__tests__/topo-store-read.test.ts apps/trails/src/__tests__/survey.test.ts` | 51 pass, 0 fail, 183 expect calls. |
| `bun run typecheck` | 21 successful tasks, 21 total; all cached. |
