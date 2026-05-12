# Local Review Round 2: Topographer API Lane

Scope: stack tip `trl-637-audit-release-process-and-beta-to-10-cutover-requirements`, focused on the round-1 TRL-657 `survey.trail` activation-source fix and TRL-655/TRL-657 TopoGraph/topo-store query API regressions.

## Result

Not clean. The round-1 `survey.trail` schema-bearing activation-source finding is fixed, and focused tests pass. I found one new P2 in the direct `deriveTopoGraph` projection path, plus the prior P3 compact API-reference omission remains.

## Verified Round-1 Fix

`survey.trail` now preserves schema-bearing activation source fields through the shared core projection helper.

- `apps/trails/src/trails/topo-activation.ts:156-159`
  > "const projectActivationSource = ("
  > "source: ActivationSource"
  > "): ActivationSourceReport =>"
  > "projectActivationSourceDeclaration(source) as ActivationSourceReport;"
- `packages/core/src/activation-source-projection.ts:143-160`
  > "if (source.parse !== undefined) {"
  > "record['hasParse'] = true;"
  > "record['parseOutputSchema'] = toSortedJsonSchema(output);"
  > "record['hasPayloadSchema'] = true;"
  > "record['payloadSchema'] = toSortedJsonSchema(source.payload);"
- `apps/trails/src/trails/topo-output-schemas.ts:24-26`
  > "parseOutputSchema: jsonSchemaOutput.optional(),"
  > "path: z.string().optional(),"
  > "payloadSchema: jsonSchemaOutput.optional(),"
- `apps/trails/src/__tests__/survey.test.ts:1007-1033`
  > "expect(trailDetailOutput.safeParse(detail).success).toBe(true);"
  > "parseOutputSchema: {"
  > "path: '/webhooks/users/upsert',"
  > "payloadSchema: {"

## Findings

### P2: Direct `deriveTopoGraph` activation sources still use the older local projection

- Owning branch: `TRL-657` (`trl-657-add-complete-resolved-contract-detail-view-for-blind-agents`)
- Evidence:
  - `docs/adr/0046-lock-v3-artifact-family.md:77-83`
    > "The content artifact answers: \"What is the resolved topo?\""
    > "It contains the serialized `TopoGraph`: every trail, signal, resource, and"
    > "contour with their schemas, examples, relationships, activation sources, governance"
    > "metadata, and surface projections."
  - `packages/core/src/activation-source-projection.ts:138-166`
    > "if (source.kind === 'webhook') {"
    > "record['method'] = normalizeWebhookMethod(source.method);"
    > "record['path'] ="
    > "record['hasVerify'] = true;"
  - `packages/topographer/src/internal/topo-store.ts:436-439`
    > "const projectActivationSource = ("
    > "source: ActivationSource"
    > "): ActivationSourceCatalogRecord =>"
    > "projectActivationSourceDeclaration(source) as ActivationSourceCatalogRecord;"
  - `packages/topographer/src/internal/topo-store.ts:922-929`
    > "if (trail.activationSources.length > 0) {"
    > "entry['activationSources'] = trail.activationSources.map((activation) =>"
    > "source: projectActivationSource(activation.source),"
  - `packages/topographer/src/derive.ts:171-210`
    > "const projectActivationSource = ("
    > "source: ActivationSource"
    > "): TopoGraphActivationSource => {"
    > "if (source.parse !== undefined) {"
    > "if (source.payload !== undefined) {"
    > "if (source.timezone !== undefined) {"
  - `packages/topographer/src/derive.ts:683-690`
    > "const activationSources = collectActivationSourceCatalog(topo);"
    > "activationSources: Object.fromEntries("
    > "activationSources.map((source) => [source.key, source])"
  - `apps/trails/src/__tests__/survey.test.ts:1008-1033`
    > "expect(detail.activationSources).toEqual(["
    > "hasVerify: true,"
    > "method: 'POST',"
    > "path: '/webhooks/users/upsert',"
  - `packages/topographer/src/__tests__/topo-store.test.ts:1161-1176`
    > "expect(source).toMatchObject({"
    > "hasVerify: true,"
    > "method: 'POST',"
    > "path: '/webhooks/users/upsert',"
- Why this matters:
  - The round-1 survey-facing bug is fixed by using `projectActivationSourceDeclaration`.
  - The topo-store persistence path also uses `projectActivationSourceDeclaration`.
  - The public direct `deriveTopoGraph(...)` path still has a separate projector in `packages/topographer/src/derive.ts` that preserves parse and payload schemas but not webhook `method`, `path`, or `hasVerify`.
  - That means a direct `writeTopoGraph(deriveTopoGraph(app))` / `topo.lock` artifact can be less complete than the topo-store export for the same activation source, which undermines ADR-0046's contract that `topo.lock` is the canonical resolved graph content artifact.
- Recommended action:
  - Replace the local activation-source projection in `packages/topographer/src/derive.ts` with the shared `projectActivationSourceDeclaration`/`activationSourceKey` helper from `@ontrails/core`, or move the topographer derive path to the same shared helper used by `packages/topographer/src/internal/topo-store.ts`.
  - Add a focused `packages/topographer/src/__tests__/derive.test.ts` assertion for a webhook source with `method`, `path`, `payload`, `parse.output`, and `verify`, matching the existing topo-store expectation for `method: 'POST'`, normalized `path`, and `hasVerify: true`.
  - Consider making `method`, `path`, and `hasVerify` explicit optional fields on `TopoGraphActivationSource` so future omissions are type-visible instead of hidden behind `Readonly<Record<string, unknown>>`.
- Focused validation:
  - Current tests passed but do not catch this mismatch:
    - `bun test packages/topographer/src/__tests__/derive.test.ts packages/topographer/src/__tests__/topo-store.test.ts -t "activation source"` - passed, 4 tests / 7 expectations.
    - `bun test packages/topographer/src/__tests__/topo-store-read.test.ts apps/trails/src/__tests__/survey.test.ts` - passed, 51 tests / 183 expectations.
    - `bun run typecheck` - passed, 21 cached package typecheck tasks.
  - After the fix, rerun those commands and ensure the new derive-path webhook assertion fails before the change and passes after it.

### P3: Compact API reference still omits several newly exported topo-store record types

- Owning branch: `TRL-655` for the typed topo-store accessors; `TRL-657` for the detail record additions.
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
  - `docs/api-reference.md:227-232`
    > "TopoGraph, TopoGraphEntry, TopoGraphContourReference, LockManifest, DiffResult, DiffEntry, JsonSchema"
    > "ReadOnlyTopoStore, MockTopoStoreSeed, TopoSnapshot, TopoStoreRef"
    > "TopoStoreActivationContextRecord, TopoStoreExportRecord, TopoStoreResourceRecord"
    > "TopoStoreSurfaceProjectionRecord, TopoStoreTrailRecord, TopoStoreTrailDetailRecord"
  - `docs/topo-store-reference.md:378-404`
    > "### `TopoStoreTopoGraphRecord`"
    > "### `TopoStoreTopoGraphEntryRecord`"
    > "### `TopoStoreContourRecord`"
- Why this matters:
  - The types are exported and documented in the deeper topo-store reference, so this is not an implementation blocker.
  - The compact API reference remains stale for blind API scanning.
- Recommended action:
  - Add `TopoStoreContourRecord`, `TopoStoreEntryKind`, `TopoStoreSignalDetailRecord`, `TopoStoreSignalRecord`, `TopoStoreTopoGraphEntryRecord`, and `TopoStoreTopoGraphRecord` to the `@ontrails/topographer` export list in `docs/api-reference.md`.
- Focused validation:
  - `bun run format:check`

## Checks Run

- `bun test packages/topographer/src/__tests__/topo-store-read.test.ts apps/trails/src/__tests__/survey.test.ts` - passed, 51 tests / 183 expectations.
- `bun test packages/topographer/src/__tests__/derive.test.ts packages/topographer/src/__tests__/topo-store.test.ts -t "activation source"` - passed, 4 tests / 7 expectations.
- `bun run typecheck` - passed, 21 cached package typecheck tasks.

## Unknowns

- I did not run a custom ad hoc output probe for `deriveTopoGraph`; the P2 is based on source-path comparison plus the current test coverage mismatch. The recommended derive-path test should be the executable proof.

## Notes

- I did not run any source-control write command.
- I wrote only this report file.
