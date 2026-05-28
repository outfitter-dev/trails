---
created: "2026-05-23T21:40:48Z"
updated: "2026-05-23T21:40:48Z"
description: "Audit report for TRL-766. Verdict: stable-cutover blocker. Marker projection is deterministic for supported constructs, but Zod validation checks and refinements (.min, .email, .refine, .strict, .catchall) do not affect marker content and produce no diagnostic. Follow-ups TRL-772 (markers vs Zod validation) and TRL-773 (Warden parity for lazy/intersection/record) filed."
impl_status: implemented
linear:
  - TRL-766
  - TRL-772
  - TRL-773
references:
  - docs/adr/0048-trail-versioning-v3.md
  - docs/lexicon.md
  - packages/core/src/trail.ts
  - packages/core/src/version-marker.ts
  - packages/core/src/validation.ts
  - packages/topographer/src/derive.ts
  - packages/topographer/src/versioning.ts
  - packages/warden/src/rules/trail-versioning-source.ts
  - packages/core/src/__tests__/version-marker.test.ts
  - packages/topographer/src/__tests__/derive.test.ts
  - packages/warden/src/__tests__/trail-versioning-rules.test.ts
---

# TRL-766 Audit: Version Marker Failure UX And Bounded Zod Diagnostics

- **Date:** 2026-05-22
- **Branch:** `trl-766-audit-version-marker-failure-ux-and-bounded-zod-diagnostics`
- **Issue:** `TRL-766`

## Summary Verdict

Verdict: `stable-cutover blocker`

The marker projection is deterministic, pathful, and loud for several unsupported schema constructs, but it is not yet a safe v1 stable marker contract. The current implementation accepts common Zod validation constraints and refinements while projecting the same marker as the unconstrained schema. That means two validation contracts can be semantically different while sharing a version marker.

This is larger than a report-only polish fix. Before stable cutover, Trails should either serialize those validation semantics into the canonical marker projection or reject them as unsupported bounded-Zod constructs with a clear diagnostic.

Good existing behavior:

- Authors cannot write `marker:` on source contracts.
- Runtime marker derivation rejects unsupported empty schema projections with
  pathful `ValidationError`s.
- `marker-schema-unsupported` catches some high-risk source-level constructs
  before graph derivation.
- Supported primitive/object/array/enum/literal/optional/nullable/union/default
  projections are deterministic in the tested paths.

Release-blocking gap:

- Zod checks and refinements such as `.min()`, `.email()`, `.regex()`, `.int()`,
  array `.min()`, object `.strict()`, `.catchall()`, `.refine()`, and
  `.superRefine()` currently do not affect marker content and do not produce a
  marker diagnostic.

Secondary diagnostic gap:

- Runtime projection rejects `z.lazy()`, `z.intersection()`, and `z.record()`,
  but the source Warden rule does not flag them early.

## Evidence Map

### Doctrine

- `docs/adr/0048-trail-versioning-v3.md:157-180` says authors do not write
  markers, markers are 16-character SHA-256 prefixes over canonicalized resolved
  contract content, and unsupported schema features must fail loudly with a
  clear diagnostic.
- `docs/lexicon.md:456-467` defines `marker` as a framework-projected,
  content-addressed contract identifier and says surfaces may resolve
  `@<marker-prefix>` when the prefix is unambiguous.

### Marker Projection

- `packages/core/src/trail.ts:789-802` rejects authored `kind`/`marker` on
  historical version entries.
- `packages/core/src/trail.ts:1021-1024` rejects authored top-level
  `marker`.
- `packages/core/src/version-marker.ts:35-61` rejects unsupported empty schema
  projections except the empty `properties` object.
- `packages/core/src/version-marker.ts:63-128` canonicalizes JSON-compatible
  marker content and rejects undefined, functions, symbols, non-plain objects,
  and circular references with pathful messages.
- `packages/core/src/version-marker.ts:130-138` derives the marker by hashing
  canonicalized JSON over the projected schema content.
- `packages/core/src/version-marker.ts:192-251` defines current and historical
  marker content.
- `packages/core/src/version-marker.ts:310-351` derives current and historical
  marker records and enforces uniqueness.
- `packages/topographer/src/derive.ts:470-488` projects marker fields onto the
  resolved graph entry.
- `packages/topographer/src/versioning.ts:90-125` projects historical version
  entry schemas and markers.
- `packages/topographer/src/versioning.ts:249-280` derives current and
  historical markers during TopoGraph version projection.

### Zod Projection Boundary

- `packages/core/src/validation.ts:173-179` documents the intended common Zod
  coverage: string, number, boolean, object, array, enum, optional, default,
  union, literal, nullable, and describe.
- `packages/core/src/validation.ts:217-262` implements converters for array,
  boolean, default, enum, literal, nullable, number, object, optional, readonly,
  string, and union.
- `packages/core/src/validation.ts:264-270` falls back to an empty object when
  no converter exists, then adds `description` when present. Runtime marker
  support later rejects these empty projections in most nested schema positions.
- The string, number, array, and object converters do not include Zod check
  metadata or object unknown-key/catchall policy, so those validation semantics
  are currently invisible to marker content.

### Warden Diagnostics

- `packages/warden/src/rules/trail-versioning-source.ts:18-24` lists the
  current unsupported source call denylist: `any`, `custom`, `preprocess`,
  `transform`, and `unknown`.
- `packages/warden/src/rules/trail-versioning-source.ts:228-264` applies the
  `marker-schema-unsupported` rule only to versioned trail `input`/`output`
  schema nodes and historical version entries.
- `packages/warden/src/__tests__/trail-versioning-rules.test.ts:110-129`
  covers `z.any()` as an unsupported marker schema shape.
- `packages/warden/src/__tests__/trail-versioning-rules.test.ts:131-151`
  preserves the callback-scope guard so helper method names inside callbacks do
  not create false positives.

### Regression Tests Already Present

- `packages/core/src/__tests__/version-marker.test.ts:17-30` verifies marker
  hashing is canonical and 16 hexadecimal characters.
- `packages/core/src/__tests__/version-marker.test.ts:61-71` verifies marker
  canonicalization rejects unsupported non-JSON content instead of stringifying
  it.
- `packages/topographer/src/__tests__/derive.test.ts:321-351` verifies mutable
  examples and status do not affect markers.
- `packages/topographer/src/__tests__/derive.test.ts:353-391` verifies resolved
  contract content changes can change current and historical markers.
- `packages/topographer/src/__tests__/derive.test.ts:498-519` verifies
  `z.any()` produces an unsupported marker schema projection failure.

## Command Snippets

The four `bun --eval` matrices below were run interactively against the in-repo APIs as one-off audit harnesses. The recorded **outputs** are the audit evidence. The script bodies are summarized inline as `<matrix omitted for length: …>` placeholders for readability; the next paragraph names exactly which existing regression tests do and do not cover the same matrix, so a future auditor knows whether they need to reproduce the matrix from scratch.

Test coverage map for these matrices:

- Construct matrix (first block): partially covered.
  `packages/topographer/src/__tests__/derive.test.ts:498-519` covers `z.any()`
  as an unsupported marker schema projection;
  `packages/warden/src/__tests__/trail-versioning-rules.test.ts:110-152` covers
  the Warden `marker-schema-unsupported` rule for the supported failure set.
  The matrix in this report widens that coverage to `transform`, `preprocess`,
  `lazy`, `intersection`, `record`, `any`, `unknown`, and `custom`; only
  `z.any()` is directly tested today.
- Constraint-pair matrix (second block): **not covered today**. No test in
  `packages/core/src/__tests__/version-marker.test.ts` (129 lines) or in
  `packages/warden/src/__tests__/trail-versioning-rules.test.ts` exercises
  marker stability across `.min()`, `.email()`, `.regex()`, `.int()`, array
  `.min()`, `.strict()`, `.passthrough()`, `.catchall()`, `.refine()`, or
  `.superRefine()` pairs. This is exactly the stable-cutover blocker the
  audit surfaces and TRL-772 carries.
- Default-projection check (third block): partially covered.
  `packages/core/src/__tests__/version-marker.test.ts:32-58` covers stable
  runtime contract references in marker content. The matrix in this report
  additionally distinguishes static vs dynamic defaults, which is not isolated
  in a dedicated regression test today.
- Warden unsupported-call check (fourth block):
  `packages/warden/src/__tests__/trail-versioning-rules.test.ts:131-152`
  covers `marker-schema-unsupported` ignoring callbacks. The matrix in this
  report runs the rule across validation-check / refinement / object-policy
  invocations and confirms no diagnostic is produced for any of them, which
  is the gap TRL-773 carries.

If a future audit needs the exact harness scripts, treat the omitted blocks as TODOs to lift into focused regression tests on TRL-772 / TRL-773 rather than as duplicates of existing coverage.

```text
$ bun --eval '<matrix omitted for length: derive markers for supported and unsupported Zod constructs through deriveTopoGraph and run markerSchemaUnsupported on equivalent source snippets>'
{"name":"transform","projection":"error","error":"ValidationError: Trail version marker content at input.properties.value contains an unsupported empty schema projection","warden":["marker-schema-unsupported"]}
{"name":"preprocess","projection":"error","error":"ValidationError: Trail version marker content at input.properties.value contains an unsupported empty schema projection","warden":["marker-schema-unsupported"]}
{"name":"lazy","projection":"error","error":"ValidationError: Trail version marker content at input.properties.value contains an unsupported empty schema projection","warden":[]}
{"name":"intersection","projection":"error","error":"ValidationError: Trail version marker content at input contains an unsupported empty schema projection","warden":[]}
{"name":"record","projection":"error","error":"ValidationError: Trail version marker content at input.properties.value contains an unsupported empty schema projection","warden":[]}
```

```text
$ bun --eval '<constraint-pair matrix omitted for length: compare base schema markers against constrained schema markers>'
{"name":"string-min","left":"4562785c00880b6b","right":"4562785c00880b6b","changed":false}
{"name":"string-email","left":"4562785c00880b6b","right":"4562785c00880b6b","changed":false}
{"name":"string-regex","left":"4562785c00880b6b","right":"4562785c00880b6b","changed":false}
{"name":"number-int","left":"46aa52f6c2cb6413","right":"46aa52f6c2cb6413","changed":false}
{"name":"number-min","left":"46aa52f6c2cb6413","right":"46aa52f6c2cb6413","changed":false}
{"name":"array-min","left":"6846115ebd8c1eee","right":"6846115ebd8c1eee","changed":false}
{"name":"object-strict","left":"d9137a2387fd2bc0","right":"d9137a2387fd2bc0","changed":false}
{"name":"object-passthrough","left":"d9137a2387fd2bc0","right":"d9137a2387fd2bc0","changed":false}
{"name":"object-catchall","left":"d9137a2387fd2bc0","right":"d9137a2387fd2bc0","changed":false}
{"name":"literal-change","left":"02cdf0d45dcb1bba","right":"b7cf1ca35da15c02","changed":true}
{"name":"enum-change","left":"0c61671d9e6dbe6e","right":"28a2ed059facd78f","changed":true}
```

```text
$ bun --eval '<default projection check omitted for length>'
{"name":"staticDefault","same":true}
{"name":"dynamicRandomDefault","same":true}
{"name":"dynamicObjectDefault","same":true}
```

```text
$ bun --eval '<Warden unsupported-call check omitted for length>'
{"schema":"z.string().min(3)","diagnostics":[]}
{"schema":"z.string().email()","diagnostics":[]}
{"schema":"z.number().int()","diagnostics":[]}
{"schema":"z.array(z.string()).min(1)","diagnostics":[]}
{"schema":"z.object({ a: z.string() }).strict()","diagnostics":[]}
{"schema":"z.object({ a: z.string() }).catchall(z.number())","diagnostics":[]}
{"schema":"z.string().refine((v) => v.length > 0)","diagnostics":[]}
{"schema":"z.string().superRefine(() => {})","diagnostics":[]}
```

## Current Behavior Matrix

| Construct | Runtime Projection | Warden | Verdict |
| --- | --- | --- | --- |
| `z.string()`, `z.number()`, `z.boolean()` | Marker derives. | No diagnostic. | Supported primitive path. |
| `z.object({ ... })` | Marker derives. | No diagnostic. | Supported structural path, but object policy is not represented. |
| `z.array(...)` | Marker derives. | No diagnostic. | Supported structural path, but array checks are not represented. |
| `z.enum(...)`, `z.literal(...)` | Marker derives and changes when enum/literal values change. | No diagnostic. | Supported. |
| `z.union(...)`, `z.discriminatedUnion(...)` | Marker derives. | No diagnostic. | Supported via the union converter. |
| `.optional()`, `.nullable()` | Marker derives. | No diagnostic. | Supported. |
| `.default(...)` | Marker derives; stable defaults are included and dynamic defaults are omitted. | No diagnostic. | Supported enough for deterministic marker content. |
| `.readonly()`, `.brand()` | Marker derives as the inner schema. | No diagnostic. | Likely acceptable if treated as non-runtime marker metadata, but should be explicit. |
| `z.any()`, `z.unknown()`, `z.custom()` | Runtime rejects with pathful `ValidationError`. | Diagnostic emitted. | Good failure UX. |
| `z.transform(...)`, `z.preprocess(...)` | Runtime rejects with pathful `ValidationError`. | Diagnostic emitted. | Good failure UX. |
| `z.lazy(...)`, `z.intersection(...)`, `z.record(...)` | Runtime rejects with pathful `ValidationError`. | No diagnostic. | Needs source-level Warden coverage or explicit runtime-only policy. |
| `.min()`, `.email()`, `.regex()`, `.int()`, array `.min()` | Marker derives unchanged from the unconstrained schema. | No diagnostic. | Release-blocking marker identity gap. |
| `.strict()`, `.passthrough()`, `.catchall(...)` | Marker derives unchanged from the base object schema. | No diagnostic. | Release-blocking marker identity gap. |
| `.refine(...)`, `.superRefine(...)` | Marker derives unchanged from the inner schema. | No diagnostic. | Release-blocking marker identity gap. |

## Audit Questions

### Do version-marker failures include enough context for agents to fix schemas?

Partially. Runtime projection failures include the marker content path, for example `input.properties.value`, and identify the unsupported empty schema projection. That is enough to find the field, but not enough to name the original Zod construct after projection has collapsed to `{}`.

Warden gives earlier, source-level feedback for `any`, `custom`, `preprocess`, `transform`, and `unknown`, but misses other runtime-failing constructs such as `lazy`, `intersection`, and `record`.

### Does the bounded Zod subset fail loudly for unsupported features?

Not consistently. Runtime projection fails loudly for constructs that project to empty schema objects, but several runtime validation features are accepted and ignored. Those accepted-but-ignored features are the stable-cutover problem.

### Can stable cutover rely on version markers as content-addressed contract identities?

Not yet for contracts that use Zod validation checks or refinements. Literal and enum value changes correctly change markers, and structural field additions are covered by existing tests. However, validation constraints can change the accepted input contract without changing the marker.

### Is this small enough to fix inside the audit branch?

No. The correct fix needs a policy choice:

- expand marker projection to include supported Zod checks and object policy, or
- treat those constructs as unsupported for versioned marker contracts and
  reject them through runtime projection plus Warden.

Either path needs tests, docs/ADR alignment, and likely Warden updates. That is larger than the committed audit-report scope.

## Follow-Up Issues

- `TRL-772`: Make version markers account for or reject Zod validation checks.
- `TRL-773`: Align `marker-schema-unsupported` Warden coverage with runtime
  marker failures.

## Stable Cutover Recommendation

Do not cut stable while version markers are advertised as content-addressed contract identifiers unless `TRL-772` is resolved or the stable runbook explicitly narrows the marker guarantee to the currently serialized subset.

Recommended release gate text after `TRL-772` lands:

```markdown
- [ ] Version marker bounded-Zod gate is clean: all versioned trail schemas
      either serialize supported validation semantics into marker content or
      fail Warden/runtime diagnostics for unsupported constructs.
```
