---
id: 48
slug: trail-versioning-v3
title: Trail Versioning v3
status: accepted
created: 2026-05-19
updated: 2026-05-19
accepted: 2026-05-19
owners: ['[galligan](https://github.com/galligan)']
depends_on: [3, 6, 8, 13, 16, 17, 24, 26, 35, 46, 47]
---

# ADR-0048: Trail Versioning v3

## Context

ADR-0044 made the right architectural claim: the trail is the unit of
versioning. It also carried implementation grammar that no longer fits the
framework after the beta.18 cleanup: adjacent `.v*.ts` discovery, a
`version.current` object, `adapt:` transforms, sunset-style lifecycle language,
and command names such as `trails version`.

The current Trails language is stricter:

- A trail is the contract unit.
- A `blaze` is authored behavior that establishes how a trail runs.
- The runtime runs blazed trails through one shared execution pipeline.
- Surfaces negotiate boundary concerns and do not call blazes directly.
- Durable graph content belongs in the TopoGraph artifact family, not in
  scattered per-surface state.

Versioning must extend that grammar rather than create a parallel model. A
versioned trail should still look like a trail: current `input`, `output`, and
`blaze` stay at the top level, while historical contracts are explicit sibling
entries.

This ADR supersedes ADR-0044. ADR-0044 remains historical source material for
why versioning is per trail, but this ADR is the implementation doctrine for
the v1 Trail Versioning stack.

## Decision

### Trail-only versioning for v1

Trails versions individual trails in v1. A topo, surface, contour, signal,
resource, store, adapter, or app package does not inherit the trail versioning
shape.

Non-trail specs may reserve `version?: never` so the field name stays available
for future primitive-specific designs. That reservation is not a cross-primitive
capability promise.

### Current stays top-level

A versioned trail authors the current contract exactly where an unversioned
trail does:

```typescript
const createInvite = trail({
  id: 'invite.create',
  input: currentInput,
  output: currentOutput,
  blaze: currentBlaze,
  version: 3,
  versions: {
    2: {
      input: v2Input,
      output: v2Output,
      transpose: {
        input: ({ input }) => ({ ...input, notify: true }),
        output: ({ output }) => ({
          inviteId: output.inviteId,
          status: output.status,
        }),
      },
      status: {
        state: 'deprecated',
        successor: 3,
        migration: ['Add the notify field when calling invite.create.'],
      },
    },
    1: {
      input: v1Input,
      output: v1Output,
      blaze: v1Blaze,
      status: {
        state: 'archived',
        reason: 'Legacy invite path is no longer supported.',
      },
    },
  },
});
```

`version: N` is the current version number. `versions: { N: ... }` is a map of
historical entries. A trail without `version` is current-only and behaves as it
does today.

Historical entries always declare explicit `input` and `output`. There is no
inheritance from current. This makes frozen contract identity clear when the
current contract moves again.

### Revision and fork entries

There is no authored `kind:` field in source. The framework infers entry kind
from field presence and projects `kind: 'revision' | 'fork'` in the resolved
graph.

Revision entries use `transpose:`:

```typescript
versions: {
  2: {
    input: v2Input,
    output: v2Output,
    transpose: {
      input: ({ input }) => currentInput.parse(input),
      output: ({ output }) => v2Output.parse(output),
    },
  },
}
```

A revision is a schema-only translation path between a historical contract and
current.
The current blazed trail still runs. Transpose functions are pure data
transforms: no `ctx`, no resources, no composes, no signal firing, no permit
state, and no surface state.

Fork entries use `blaze:`. A fork preserves a complete historical runtime
contract and may own `composes`, `resources`, and `detours` because its own
blazed trail runs for that version.

Entries with both `transpose:` and `blaze:` are invalid. Entries with neither
are allowed only when the historical schemas are identical to current and the
entry is metadata-only.

### Lifecycle status

Lifecycle is optional `status:` metadata on a historical entry:

```typescript
status: { state: 'deprecated', successor: 3, note: 'Use v3.' }
status: { state: 'archived', reason: 'No supported callers remain.' }
```

Absence of `status` means active. `status: { state: 'active' }` is not a source
shape.

Deprecated entries remain live. Archived entries remain inspectable historical
records but do not resolve at runtime; requests for them return
`VersionNotSupportedError`.

M3 owns full lifecycle command behavior and surface signaling. M1/M2 only leave
the type and graph shape needed for deprecated and archived states.

### Markers are projected identities

Authors do not write `marker:`. The framework projects a content-addressed
marker for current and every historical entry.

The stored marker is a 16-character SHA-256 prefix over canonicalized resolved
contract content. Display surfaces may show the shortest unambiguous prefix,
with four characters as the minimum.

Marker inputs are contract content, not implementation source:

- Current hashes top-level contract fields.
- Revisions hash explicit historical `input`, `output`, frozen metadata, and
  the canonicalized `transpose` shape.
- Forks hash explicit historical `input`, `output`, frozen metadata,
  `composes`, `resources`, and `detours`; the `blaze` function body is not part
  of the marker.
- `status` and `examples` are mutable and do not participate in the frozen
  marker hash.

Marker canonicalization in v1 is intentionally bounded to the supported Zod
subset the implementation can serialize deterministically. Unsupported schema
features must fail loudly with a clear diagnostic instead of producing unstable
markers. If implementation evidence shows the needed Zod semantics cannot be
bounded safely in M2, the stack must stop and defer that part to the later
bounded-Zod rule work.

`@N` references resolve by integer version. `@<marker-prefix>` references
resolve by unambiguous marker prefix.

### Resolved graph projection

The resolved graph projects versioning as additive TopoGraph content on the
trail entry:

```json
{
  "kind": "trail",
  "id": "invite.create",
  "version": 3,
  "marker": "a3f5e7c9d1b2e8f4",
  "supports": [2, 3],
  "versions": {
    "2": {
      "kind": "revision",
      "marker": "f2c8b1e3a7d491c5",
      "status": { "state": "deprecated", "successor": 3 }
    },
    "1": {
      "kind": "fork",
      "marker": "c4a9d2e7f0b18e63",
      "status": { "state": "archived" }
    }
  },
  "forces": []
}
```

`supports` is current plus live historical entries. Archived entries stay in
`versions` for audit and diffing but are excluded from runtime support by
default.

`forces` is graph-only audit debt for future `--force` compile behavior. It is
not source, not an authored version entry, and not implemented by M1/M2 except
where graph types must leave room for it.

ADR-0046 does not need a manifest-schema amendment for this. `.trails/trails.lock`
continues to hash the TopoGraph content artifact. The TopoGraph content schema
evolves additively.

### Runtime resolution

Execution resolves `(trail, version)` through one model:

- Current runs the current top-level contract and blazed trail.
- Revision validates historical input, applies `transpose.input`, runs the
  current blazed trail, applies `transpose.output`, and validates historical
  output.
- Fork validates historical input, runs the fork's blazed trail, and validates
  historical output.
- Deprecated entries remain live.
- Archived or missing entries return `VersionNotSupportedError` with the
  requested and supported versions.
- Graph-only force entries never resolve at runtime.

`ctx.compose()` runs current by default. Explicit `{ version }` pinning is allowed
as migration debt and should be visible to Warden.

### Examples and testing

Examples remain contract tests. A versioned trail can carry examples on current
and on historical entries. `testAll(app)` runs current plus live historical
entries, including deprecated entries. Archived entries remain inspectable but
are not default runtime/example targets.

Revision examples validate historical shapes and pass through `transpose:`.
Fork examples run against the fork's blazed trail.

### CLI namespace

Before versioning implementation depends on command names, Trails adopts this
top-level CLI namespace:

- `trails create`
- `trails compile`
- `trails validate`
- `trails diff`
- `trails doctor`
- `trails revise`
- `trails deprecate`

The old current-facing grammar is retired. Do not add aliases or compatibility
periods for `trails version`, `trails sunset`, `trails mark`, `trails fork`, or
`trails archive`.

`trails topo compile` promotes to `trails compile`. `trails validate` is the
read-only sibling. `trails topo verify` is retired by that shape.

M1 implements the namespace settlement. Later M3 work implements lifecycle and
diff behavior on top of the settled namespace.

### Relationship to ADR-0016

ADR-0016 explored a `mark()` helper name in draft persistence thinking. That
reservation is not the versioning grammar. Versioning uses projected `marker:`
identities and `trails revise` / `trails deprecate` operator verbs.

## Consequences

### Positive

- Versioned trails still read like trails: current fields stay top-level.
- The common schema-compatibility case is explicit and pure through
  `transpose:`.
- Behavioral compatibility stays honest through fork entries with their own
  blazed trail.
- The graph can expose stable content-addressed identities without making
  authors manage hashes.
- Runtime resolution, examples, and `testAll` all share the same
  `(trail, version)` model.
- The CLI namespace is settled before implementation adds user-facing
  versioning commands.

### Tradeoffs

- Historical entries repeat `input` and `output`, even when they match current.
  The repetition is intentional freeze materialization.
- Marker canonicalization accepts a bounded schema subset in v1 rather than
  attempting to serialize every Zod feature.
- Revision transforms are one-hop to current. Multi-hop transpose chains are
  deferred until there is implementation evidence that they are worth their
  complexity.
- Version-pinned composes are allowed for migrations but become visible debt.

### Risks

- If marker canonicalization grows by accident beyond the bounded subset, it
  can create unstable contract identities. The implementation must reject
  unsupported schema features clearly.
- If lifecycle behavior leaks into M2, the stack can blur M2 with M3. Archived
  runtime rejection is allowed, but lifecycle commands, negotiation, and force
  semantics remain later work.
- If docs keep ADR-0044 command names alive as current guidance, agents will
  build the wrong surface. ADR-0044 must be marked superseded and active docs
  must point here.

## References

- [ADR-0003: Unified Trail Primitive](0003-unified-trail-primitive.md)
- [ADR-0006: Shared Execution Pipeline](0006-shared-execution-pipeline.md)
- [ADR-0008: Deterministic Surface Derivation](0008-deterministic-trailhead-derivation.md)
- [ADR-0013: Tracing](0013-tracing.md)
- [ADR-0016: Schema-Derived Persistence](0016-schema-derived-persistence.md)
- [ADR-0017: The Serialized Topo Graph](0017-serialized-topo-graph.md)
- [ADR-0024: Typed Trail Composition](0024-typed-trail-composition.md)
- [ADR-0026: Error Taxonomy as Transport-Independent Behavior Contract](0026-error-taxonomy-as-transport-independent-behavior-contract.md)
- [ADR-0035: Surface APIs Render the Graph](0035-surface-apis-render-the-graph.md)
- [ADR-0044: Trail Versioning](0044-trail-versioning.md)
- [ADR-0046: Lock v3 Artifact Family](0046-lock-v3-artifact-family.md)
- [ADR-0047: Stable Release Line Discipline](0047-stable-release-line-discipline.md)
