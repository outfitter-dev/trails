---
id: 44
slug: trail-versioning
title: Trail Versioning
status: superseded
superseded_by: ['48']
created: 2026-04-09
updated: 2026-05-19
accepted: 2026-05-06
owners: ['[galligan](https://github.com/galligan)']
depends_on: [3, 6, 8, 13, 17, 24, 26, 35]
---

# ADR-0044: Trail Versioning

> **Status update (2026-05-19):** Superseded by
> [ADR-0048: Trail Versioning v3](0048-trail-versioning-v3.md).
> This ADR remains historical source material for the per-trail versioning
> premise, but its `.v*.ts` discovery, `version.current` object, `adapt:`
> transforms, sunset lifecycle, and `trails version` command grammar are no
> longer current doctrine.

## Context

### Software evolves per trail, not per app

The trail is the unit of contract.[^adr-3] It follows that the trail is the
unit of versioning. A topo is a collection of trails at different contract
versions, not a single app-wide `/v1` or `/v2` object. Some trails may have
evolved to v3 while others remain at their implicit v1.

Per-trail versioning matches how capabilities actually change. It is closer to
GraphQL's field-level evolution model than REST's big-bang version folders. It
also keeps the framework's promise intact: define one trail contract, derive
the surfaces, and avoid duplicate hand-authored compatibility logic.

### Version changes have two shapes

Most version changes are schema changes. A field is renamed, a required field
is added, an output shape expands, or a field becomes structured. The current
blaze can still handle the work once old input is adapted into the
current shape and current output is adapted back into the old shape.

Less often, a version change is behavioral. The algorithm changes, the data
source changes, side effects change, or a resource interaction cannot be
adapted as pure data. Those versions need their own blaze.

The model needs to make the common schema-only case compact without hiding the
rare behavioral case behind fragile branches in one `blaze` function.

### Surfaces negotiate version at the boundary

ADR-0008 establishes deterministic surface derivation.[^adr-8] Versioning adds
one more derived dimension. HTTP, MCP, CLI, and future WebSocket surfaces each
negotiate requested versions through their native protocol conventions, then
pass the resolved version into the shared execution pipeline.[^adr-6]

The blaze does not inspect the requested version. Version is a
surface and execution concern, not business logic.

### Durable graph artifacts must record version state

ADR-0017 defines the serialized topo graph as the resolved record of a Trails
app.[^adr-17] Version information belongs there too: supported versions,
current version, deprecation metadata, sunset state, examples, and derived
surface projections for each supported version.

## Decision

### The versioned unit is the trail

The framework versions individual trails, not apps, topos, packs, or surfaces.

A trail with no `version` field is v1. When a developer adds versioning to an
existing trail, the current behavior becomes v1 and the edited unsuffixed file
becomes the new current version. Existing consumers keep working when the
previous version is preserved.

### Version numbers are integers

Trail versions are positive integers starting at `1`. They always increase.

Semver is not the internal model. There is no useful "patch" version for a
single trail contract, date versions are not reliably ordered, and named
versions cannot drive adapter ordering or deprecation checks. If a surface wants
to render version `3` as `v2.1`, that is a surface presentation decision. The
framework model stays integer-based.

### At most two active versions are allowed by default

A trail may have at most two active, non-deprecated versions at one time.
Deprecated versions do not count against the active limit.

The default states are:

- One active version: stable, no migration in progress.
- Two active versions: current plus previous, with an active migration.

Three active versions means a second migration began before the first finished.
The warden reports this as an error unless the app explicitly raises the limit:

```typescript
governance: {
  maxActiveVersions: 3,
}
```

The escape hatch exists for unusual ecosystems with many long-lived consumers,
but the framework's default posture is to finish one migration before starting
another.

### The `version` field owns version metadata

All version declaration data lives under a trail's `version` field.

No versioning, implicit v1:

```typescript
const createUser = trail('user.create', {
  input: z.object({ name: z.string() }),
  blaze: async (input) => {
    return Result.ok({ id: 'u_1', name: input.name });
  },
});
```

Simple file-based version bump:

```typescript
const createUser = trail('user.create', {
  version: 2,
  input: z.object({ name: z.string(), email: z.string().email() }),
  blaze: async (input) => {
    return Result.ok({ id: 'u_1', name: input.name, email: input.email });
  },
});
```

`version: 2` declares the current version. The framework discovers adjacent
`.v*.ts` files for previous versions. If `user-create.v1.ts` exists, v1 is
supported.

Version object with adapters or metadata:

```typescript
const createUser = trail('user.create', {
  version: {
    current: 3,
    1: { deprecated: { sunset: '2026-06-01', successor: 2 } },
    2: {
      input: z.object({ name: z.string(), email: z.string().email() }),
      output: z.object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
      }),
      adapt: {
        input: (v2) => ({ ...v2, verified: false }),
        output: (v3) => ({ id: v3.id, name: v3.name, email: v3.email }),
      },
    },
  },
  input: z.object({
    name: z.string(),
    email: z.string().email(),
    verified: z.boolean(),
  }),
  output: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    verified: z.boolean(),
  }),
  blaze: async (input) => {
    return Result.ok({ id: 'u_1', ...input });
  },
});
```

When `version` is an object, `current` is the active current version and
numbered keys describe previous supported versions. A numbered entry can be:

- A schema adapter: `{ input, output, adapt }`.
- A separate inline blaze: `{ input, output, blaze }`.
- Metadata for a file-based version: `{ deprecated }`.

If both a numbered inline entry and a `.v*.ts` file exist for the same version,
the inline entry takes precedence. If neither exists, that version is not
supported.

### Schema changes use adapters

Schema-only changes use adapters. The framework validates old input against
the old schema, adapts it to the current schema, runs the current blazed trail,
then adapts current output back to the old output schema.

```typescript
const createUser = trail('user.create', {
  version: {
    current: 2,
    1: {
      input: z.object({ name: z.string() }),
      output: z.object({ id: z.string(), name: z.string() }),
      adapt: {
        input: (v1) => ({
          ...v1,
          email: `${v1.name.toLowerCase()}@placeholder.local`,
        }),
        output: (v2) => ({ id: v2.id, name: v2.name }),
      },
    },
  },
  input: z.object({ name: z.string(), email: z.string().email() }),
  output: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  blaze: async (input) => {
    // Always receives current-shaped input and returns current-shaped output.
  },
});
```

The developer rule is simple: if the compatibility step is a pure data
transformation, use an adapter. If compatibility requires business logic,
alternate resource usage, or different side effects, use a version file.

### Behavioral changes use `.v*.ts` files

Behavioral versions live in adjacent files:

```text
src/trails/
  entity-search.ts       # v2 current
  entity-search.v1.ts    # v1 previous behavior
```

The unsuffixed file is always current. `.v1.ts`, `.v2.ts`, and later suffixed
files are previous versions. A suffixed version file is a standard trail file
with its own schemas, examples, metadata, and `blaze`.

The framework discovers `.v*.ts` files only when the main trail declares a
version greater than v1. If a `.v*.ts` file exists without a version declaration
on the main trail, the warden reports it as an orphan.

### The copy-and-evolve workflow is canonical

The CLI workflow preserves the old contract before the developer edits the
current file:

1. `user-create.ts` exists at implicit v1.
2. The developer runs `trails version user.create`.
3. The CLI copies `user-create.ts` to `user-create.v1.ts` unchanged.
4. The CLI adds `version: 2` to `user-create.ts`.
5. The developer edits `user-create.ts` for the new current contract.

The `.v1.ts` file keeps its original variable names. Version identity is in the
file convention and the trail metadata, not in manually renamed local symbols.

### Version resolution is part of execution

Surface connectors extract or default the requested version and pass it into
execution:

```text
surface extracts requested version
  -> executeTrail(trail, input, { version })
  -> resolve version:
      if requested is current:
        validate current input, run current blazed trail, validate current output
      if requested is previous and an adapter exists:
        validate version input, adapt input, run current blazed trail, adapt output
      if requested is previous and a file blaze exists:
        validate version input, run versioned blazed trail, validate version output
      otherwise:
        return Result.err(VersionNotSupportedError)
```

The blaze receives exactly the input shape declared by the version being run.
The current blaze never branches on requested version.

### Each surface negotiates version in its own idiom

Surface connectors expose versioning options using protocol-native strategies:

| Surface | Strategy | Example | Default |
| --- | --- | --- | --- |
| HTTP | Path segment | `/v1/user/create` | `latest` |
| HTTP | Header | `X-API-Version: 2` | `latest` |
| HTTP | Query parameter | `?version=2` | `latest` |
| MCP | Tool parameter | `_version: 1` | `latest` |
| MCP | Tool name suffix | `myapp_user_create_v1` | `latest` |
| CLI | Global flag | `--api-version 1` | `latest` |
| WebSocket | Message envelope | `{ "version": 1 }` | `latest` |

When a surface derives versioned routes or tools, it does so from the trail's
supported version set through that surface's graph rendering layer.[^adr-35] The
developer does not manually register one endpoint per version.

Surface configuration may also choose fallback behavior:

- `latest`: if the requested version is not supported by a trail, use current.
- `error`: if the requested version is not supported, return
  `VersionNotSupportedError`.

The strict `error` mode is for stable external contracts. The `latest` fallback
is for gradual migrations where some trails have not evolved.

### Cross chains run current by default

When trail A crosses trail B, B runs at its current version. Version negotiation
is a surface boundary concern. Once execution is inside the graph, internal
composition uses current contracts.

The migration escape hatch is explicit pinning:

```typescript
const result = await ctx.cross('other.trail', input, { version: 1 });
```

The warden reports version-pinned crosses as maintenance debt. They are allowed
for migrations, but they should not become permanent architecture.

Version context does not cascade through cross chains. If a consumer requests
v1 of trail A, the consumer requested A's v1 contract. A owns that
compatibility. Downstream trails remain A's internal blaze detail.

### Deprecation is a lifecycle

Deprecation metadata lives on the previous version, either in the version file
or in the inline version entry:

```typescript
// user-create.v1.ts
export const createUser = trail('user.create', {
  deprecated: {
    sunset: '2026-06-01',
    successor: 2,
    migration: [
      'Add required email field to input.',
      'Read email from the output instead of joining profile data.',
    ],
  },
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string(), name: z.string() }),
  blaze: async (input) => {
    return Result.ok({ id: 'u_1', name: input.name });
  },
});
```

The lifecycle:

1. Trail ships at implicit v1.
2. `trails version user.create` copies the old file and bumps current.
3. `trails deprecate user.create@1 --sunset 2026-06-01` records lifecycle
   metadata.
4. Surfaces emit deprecation signals automatically.
5. Tracing records version usage.
6. Operators monitor migration with `trails doctor`.
7. `trails sunset user.create@1` removes the previous version.

After sunset, the app can keep serving the version with stronger warnings or
return the surface-appropriate `VersionNotSupportedError`.

### Surfaces derive deprecation behavior

The trail contract carries deprecation metadata once. Each surface renders it
without per-surface per-trail configuration:

| Surface | Deprecation behavior |
| --- | --- |
| HTTP | `Deprecation`, `Sunset`, and successor `Link` headers |
| MCP | Tool description notice and `_meta` deprecation fields |
| CLI | Warning to stderr and migration notes in help |
| WebSocket | Deprecation metadata in the response envelope |

Deprecation is not passive. Tracing records requested versions, and the warden
can flag deprecated versions that still carry high traffic near sunset.[^adr-13]

### `VersionNotSupportedError` joins the taxonomy

The error taxonomy gains `VersionNotSupportedError`.[^adr-26] It is returned
when a requested version does not exist, is not supported for a specific trail,
or has been removed after sunset.

The error carries:

- Requested version.
- Supported versions.
- Whether the requested version was sunset.
- Sunset date and successor, when known.

Surface connectors map the error through their usual error projection rules.

### Examples are per version

Examples validate every supported version. `testAll` runs current examples and
previous-version examples, whether the previous version is implemented by a
`.v*.ts` file or by an inline adapter.[^adr-24]

For file-based versions, examples live in the `.v*.ts` file. For inline adapter
versions, examples live on the numbered version entry:

```typescript
version: {
  current: 2,
  1: {
    input: z.object({ name: z.string() }),
    adapt: { input: addEmailDefault, output: dropEmail },
    examples: [{ input: { name: 'Alice' } }],
  },
},
```

A supported version without examples is a warden warning. Untested versions are
unverified versions.

### The lockfile records supported versions

A versioned trail remains one graph node with multiple supported contract
entry points. Versions do not create separate topos.

```json
{
  "user.create": {
    "version": 2,
    "supports": [1, 2],
    "versions": {
      "1": { "type": "file", "deprecated": { "sunset": "2026-06-01" } },
      "2": { "type": "current" }
    },
    "surfaces": {
      "http": { "method": "POST", "path": "/v2/user/create" },
      "mcp": { "name": "myapp_user_create" }
    }
  }
}
```

The lockfile makes version changes diffable. CI can see when a version was
added, deprecated, sunset, or accidentally orphaned.

### Warden rules

| Rule | Severity | Description |
| --- | --- | --- |
| `version-gap` | error | v3 exists but v2 does not, unless v2 was explicitly sunset and removed |
| `adapter-completeness` | error | Output schema changed but previous-version output adapter is missing |
| `max-active-versions` | error | More than `maxActiveVersions` active versions exist |
| `deprecated-without-sunset` | warning | Version is deprecated without a sunset date |
| `past-sunset` | warning | Sunset date has passed but the version is still present |
| `version-pinned-cross` | warning | `ctx.cross(..., { version })` should be temporary |
| `untested-version` | warning | Supported version has no examples |
| `orphan-version-file` | warning | `.v*.ts` file exists but main trail has no version declaration |
| `high-traffic-deprecated` | warning | Tracing shows deprecated version traffic above the configured threshold near sunset |

### Resources do not version independently

Resources are internal contracts between blazes and infrastructure.
They do not gain independent versioning. If a previous trail version needs an
old resource shape, that previous version file imports or references the
resource it needs. Versioning complexity stays on trails.

## Non-goals

- Whole-app versioning. Apps can publish their own marketing or package version,
  but Trails does not create app-wide contract generations.
- Automatic adapter generation. Schema diffs might eventually generate starter
  adapters, but explicit adapters are safer for the first versioning model.
- Consumer pinning through API keys or account settings. That is app policy, not
  framework contract structure.
- Independent resource versioning.

## Consequences

### Positive

- Trails evolve independently without flag days.
- Schema-only changes keep one current blaze with explicit adapters.
- Behavioral changes remain honest by preserving old blazes in version
  files.
- Surfaces derive version negotiation and deprecation behavior instead of
  requiring per-surface wiring.
- Tracing and warden rules make deprecation evidence-based.
- Lockfile diffs expose version state to CI and review.

### Tradeoffs

- Long-lived migrations can accumulate `.v*.ts` files until versions are sunset.
- Adapter correctness is manual. Examples and warden coverage are required to
  keep compatibility trustworthy.
- The two-active-version default is opinionated. Teams with unusually long
  support windows may need the governance override.

### Risks

- Adapter chains can become difficult to debug if teams defer deprecation too
  long. The active-version limit is the guardrail.
- Version-pinned crosses can create hidden compatibility constraints if treated
  as permanent. The warden warning keeps them visible.
- Surface fallback to `latest` can hide missing version support if used where
  strict compatibility is expected. External APIs should prefer strict `error`
  mode.

## Non-decisions

- Version negotiation across `mount()` boundaries. Cross-app composition has its
  own protocol questions.
- Changelog generation from version diffs.
- Config auto-migration with `config.fix()`.
- How future `crossInput` changes interact with version compatibility.

## References

- [ADR-0003: Unified Trail Primitive](0003-unified-trail-primitive.md)
- [ADR-0006: Shared Execution Pipeline](0006-shared-execution-pipeline.md)
- [ADR-0008: Deterministic Surface Derivation](0008-deterministic-trailhead-derivation.md)
- [ADR-0013: Tracing](0013-tracing.md)
- [ADR-0017: The Serialized Topo Graph](0017-serialized-topo-graph.md)
- [ADR-0024: Typed Trail Composition](0024-typed-trail-composition.md)
- [ADR-0026: Error Taxonomy as Transport-Independent Behavior Contract](0026-error-taxonomy-as-transport-independent-behavior-contract.md)
- [ADR-0035: Surface APIs Render the Graph](0035-surface-apis-render-the-graph.md)
- [Tenets: The trail is the product](../tenets.md)

[^adr-3]: [ADR-0003: Unified Trail Primitive](0003-unified-trail-primitive.md)
[^adr-6]: [ADR-0006: Shared Execution Pipeline](0006-shared-execution-pipeline.md)
[^adr-8]: [ADR-0008: Deterministic Surface Derivation](0008-deterministic-trailhead-derivation.md)
[^adr-13]: [ADR-0013: Tracing](0013-tracing.md)
[^adr-17]: [ADR-0017: The Serialized Topo Graph](0017-serialized-topo-graph.md)
[^adr-24]: [ADR-0024: Typed Trail Composition](0024-typed-trail-composition.md)
[^adr-26]: [ADR-0026: Error Taxonomy as Transport-Independent Behavior Contract](0026-error-taxonomy-as-transport-independent-behavior-contract.md)
[^adr-35]: [ADR-0035: Surface APIs Render the Graph](0035-surface-apis-render-the-graph.md)
