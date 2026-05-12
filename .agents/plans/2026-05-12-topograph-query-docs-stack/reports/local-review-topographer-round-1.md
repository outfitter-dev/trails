# Local Review Round 1: Topographer API Lane

Scope: TRL-655 and TRL-657 TopoGraph/topo-store/query API implementation at stack tip `trl-637-audit-release-process-and-beta-to-10-cutover-requirements`.

## Result

Latest pass found one P2 and one P3. Focused tests and typecheck pass, but the P2 should be fixed before the stack exits the local review loop.

## Findings

### P2: `survey.trail` drops activation source schemas that the TopoGraph contract preserves

- Owning branch: `TRL-657` (`trl-657-add-complete-resolved-contract-detail-view-for-blind-agents`)
- Evidence:
  - `.agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md:190-194`
    > "Prefer extending the existing trail detail path (`topoStore.trails.get(...)` and `survey.trail`) if it can naturally become the complete resolved contract detail view."
    > "Include trail id/kind, surfaces and projection metadata, input/output schemas, examples, intent, crosses, resources, activation sources/edges/context, contour/reference metadata, field overrides/layer context, and governance metadata needed by Warden or agent review."
  - `packages/topographer/src/derive.ts:183-204`
    > "if (Object.hasOwn(source, 'input')) {"
    > "record['inputSchema'] = toSortedJsonSchema(source.input);"
    > "record['parseOutputSchema'] = toSortedJsonSchema(parseOutput);"
    > "record['payloadSchema'] = toSortedJsonSchema(source.payload);"
  - `apps/trails/src/trails/topo-activation.ts:160-170`
    > "record['input'] = canonicalize(source.input);"
    > "record['hasParse'] = true;"
    > "record['hasPayloadSchema'] = true;"
  - `apps/trails/src/trails/topo-reports.ts:556-568`
    > "const graphDetail = deriveResolvedTrailGraphDetail("
    > "activationEdges: graphDetail.activationEdges,"
    > "activationSources: activation.sources,"
- Why this matters:
  - The canonical `TopoGraph` activation source projection includes schema-bearing fields such as `inputSchema`, `parseOutputSchema`, and `payloadSchema`.
  - The topo-store detail path preserves saved `TopoGraph` activation source detail through `processEntry?.activationSources` and asserts that in `packages/topographer/src/__tests__/topo-store-read.test.ts:604`.
  - The survey-facing detail path keeps the richer TopoGraph edges/context but returns `activation.sources` from `apps/trails/src/trails/topo-activation.ts`, whose projection only keeps `hasParse`/`hasPayloadSchema` flags.
  - I verified with an ad hoc Bun eval that a webhook activation source with both `parse.output` and `payload` produces `parseOutputSchema` and `payloadSchema` in `deriveTopoGraph(...)`, but `deriveTrailDetail(...).activationSources[0]` only contains `hasParse` and `hasPayloadSchema`.
- Recommended action:
  - Extend `apps/trails/src/trails/topo-activation.ts` source projection to preserve the same schema fields as the Topographer projection, or have `deriveTrailDetail` source its activation source records from the derived `TopoGraph` while preserving the current public flat shape.
  - Add a focused `apps/trails/src/__tests__/survey.test.ts` case with a webhook activation source that has `parse.output` and `payload`, asserting `trailDetailOutput.safeParse(detail).success` and the presence of `parseOutputSchema`/`payloadSchema` in `detail.activationSources[0]`.
- Focused validation:
  - `bun test apps/trails/src/__tests__/survey.test.ts`
  - `bun test packages/topographer/src/__tests__/topo-store-read.test.ts`
  - `bun run typecheck`

### P3: API reference omits several newly exported topo-store record types

- Owning branch: `TRL-655` for the new typed topo-store accessors; `TRL-657` adds additional detail record types.
- Evidence:
  - `packages/topographer/src/index.ts:93-103`
    > "TopoStoreActivationContextRecord,"
    > "TopoStoreContourRecord,"
    > "TopoStoreEntryKind,"
    > "TopoStoreSignalDetailRecord,"
    > "TopoStoreSignalRecord,"
    > "TopoStoreSurfaceProjectionRecord,"
    > "TopoStoreTopoGraphEntryRecord,"
    > "TopoStoreTopoGraphRecord,"
  - `docs/api-reference.md:229-232`
    > "ReadOnlyTopoStore, MockTopoStoreSeed, TopoSnapshot, TopoStoreRef"
    > "TopoStoreActivationContextRecord, TopoStoreExportRecord, TopoStoreResourceRecord"
    > "TopoStoreSurfaceProjectionRecord, TopoStoreTrailRecord, TopoStoreTrailDetailRecord"
- Why this matters:
  - `docs/topo-store-reference.md` documents `TopoStoreTopoGraphRecord`, `TopoStoreTopoGraphEntryRecord`, and `TopoStoreContourRecord`, but the compact topographer API export list does not mention them.
  - This is documentation/API-reference drift rather than an implementation break; the types are exported and `bun run typecheck` passes.
- Recommended action:
  - Add `TopoStoreContourRecord`, `TopoStoreEntryKind`, `TopoStoreSignalDetailRecord`, `TopoStoreSignalRecord`, `TopoStoreTopoGraphEntryRecord`, and `TopoStoreTopoGraphRecord` to the `@ontrails/topographer` list in `docs/api-reference.md`.
- Focused validation:
  - `bun run format:check`

## Checks Run

- `bun test packages/topographer/src/__tests__/topo-store-read.test.ts apps/trails/src/__tests__/survey.test.ts` - passed, 50 tests / 181 expectations.
- `bun run typecheck` - passed, 21 cached package typecheck tasks.

## Notes

- I did not run any source-control write command.
- I wrote only this report file.
