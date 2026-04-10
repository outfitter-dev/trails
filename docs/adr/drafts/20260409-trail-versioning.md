---
slug: trail-versioning
title: Trail Versioning
status: draft
created: 2026-04-09
updated: 2026-04-09
owners: ['[galligan](https://github.com/galligan)']
depends_on: [3, 8, 17]
---

# ADR: Trail Versioning

## Context

### Software evolves per-capability, not per-app

The trail is the unit of contract[^1]. It follows that the trail is the unit of versioning. An app is a collection of trails at various versions — some at v3 while others have never changed from v1. Per-trail versioning is closer to GraphQL's per-field evolution model than REST's big-bang `/v1/` to `/v2/` migration. It matches how software actually evolves.

### Versioning has two shapes

Most version changes are schema changes: a field gets renamed, a required field is added, the output shape expands. The implementation logic stays the same — it just works with different input/output shapes. These are common and mechanical.

Less often, a version change is a behavioral change: a different algorithm, a different data source, different side effects. No adapter can paper over genuine behavioral differences.

The framework needs to handle both without forcing the rare case's complexity onto the common one.

### Trailheads must negotiate transparently

ADR-0008[^2] establishes deterministic trailhead derivation — the same trail produces the same CLI command, MCP tool name, and HTTP route every time. Versioning adds a dimension: each trailhead must negotiate which version a consumer wants, using its native idiom (HTTP headers, CLI flags, MCP parameters), then feed that version into a single execution pipeline. The trail implementation never sees the version number.

### The lockfile must capture version state

ADR-0017[^3] defines the serialized topo graph as the single resolved record of the system. Version information — which versions exist, which are deprecated, which have sunset — belongs in the lockfile alongside schemas, trailhead projections, and crossing declarations.

## Decision

### The versioned unit is the trail

Not the app. Not the topo. Individual trails evolve at their own pace. A trail with no `version` field is v1. Always. When a developer adds versioning to an existing trail, the current behavior is retroactively v1 and the new behavior is v2. No breaking change for existing consumers. No flag day.

### Version numbers are integers

Starting at 1, always incrementing. Semver is overkill — what is a patch version for a trail contract? Date-based versions are not reliably orderable. Named versions cannot be compared. The framework needs to answer "is this older than that?" constantly (adapter chains, deprecation ordering, trailhead fallback logic). Integers make that comparison free.

If a team wants to present trail versions as semver on their HTTP trailhead (mapping `version: 3` to `v2.1` in the URL), that is a trailhead rendering concern. The internal model stays simple.

### At most two active versions

A trail supports at most two active (non-deprecated) versions at any time. Deprecated versions do not count against the limit.

Two versions means the developer is always in one of two states:

- **One version** — stable, no migration in progress
- **Two versions** — current + previous, actively migrating consumers

Three active versions means a second migration started before the first finished. The warden errors (not warns) if a third active version is added without deprecating one first.

The escape hatch exists in `trails.config.ts`:

```typescript
governance: {
  maxActiveVersions: 3,  // override the default of 2
}
```

### The `version` field

Everything version-related lives under one field on the trail spec. The shape depends on complexity:

**No versioning (implicit v1):**

```typescript
const createUser = trail('user.create', {
  input: z.object({ name: z.string() }),
  blaze: async (input) => { /* ... */ },
});
```

**Simple version bump (file-based, no inline adapters):**

```typescript
const createUser = trail('user.create', {
  version: 2,
  input: z.object({ name: z.string(), email: z.string().email() }),
  blaze: async (input) => { /* current implementation */ },
});
```

`version: 2` tells the framework the current version. It discovers adjacent `.v*.ts` files automatically. If `user-create.v1.ts` exists, v1 is supported. No additional declaration needed.

**Version with inline adapters or metadata:**

```typescript
const createUser = trail('user.create', {
  version: {
    current: 3,
    1: { deprecated: '2026-06-01' },
    2: {
      input: z.object({ name: z.string(), email: z.string().email() }),
      adapt: {
        input: (v2) => ({ ...v2, verified: false }),
        output: (v3) => ({ id: v3.id, name: v3.name, email: v3.email }),
      },
    },
  },
  input: z.object({ name: z.string(), email: z.string().email(), verified: z.boolean() }),
  blaze: async (input) => { /* v3 implementation */ },
});
```

When `version` is an object, `current` is the active version and numbered keys are previous versions. Entries can be:

- **An adapter** — `{ input, output, adapt }` for schema-only changes
- **A separate implementation** — `{ input, output, blaze }` for behavioral changes declared inline
- **Just metadata** — `{ deprecated: '2026-06-01' }` for file-based versions that need lifecycle annotations

If a numbered key exists in the `version` object AND a `.v*.ts` file exists, the inline entry takes precedence. If there is no inline entry and no file, the version is not supported.

### Two kinds of version change

#### Schema changes (the common case)

A field gets renamed. A new required field is added. The output shape changes. The implementation logic is the same — it just works with different input/output shapes.

Inline adapters handle these. An adapter transforms old input to the current shape, runs the current implementation, and transforms current output back to the old shape. One implementation, multiple schema versions:

```typescript
const createUser = trail('user.create', {
  version: {
    current: 2,
    1: {
      input: z.object({ name: z.string() }),
      output: z.object({ id: z.string(), name: z.string() }),
      adapt: {
        input: (v1) => ({ ...v1, email: `${v1.name.toLowerCase()}@placeholder.local` }),
        output: (v2) => ({ id: v2.id, name: v2.name }),
      },
    },
  },
  input: z.object({ name: z.string(), email: z.string().email() }),
  output: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  blaze: async (input) => {
    // Always receives current-shaped input.
    // Always returns current-shaped output.
    // Does not know about v1.
  },
});
```

The implementation stays clean — no version branching inside `blaze`. The adapter is explicit, readable, and testable in isolation. Output adapters that drop fields are honest: v1 consumers get less data, and that is visible in the adapter.

**Decision rule for developers:** if the adapter is a pure data transformation, use an adapter. If it would need to replicate business logic or call different resources, use a separate file.

#### Behavioral changes (the rare case)

Sometimes a version change is a logic change — a different algorithm, a different data source, different side effects. These use adjacent files. The previous version's full trail definition lives in a `.v*.ts` file:

```text
src/trails/
  entity-search.ts        <- v2 (current)
  entity-search.v1.ts     <- v1 (previous, different behavior)
```

The `.v1.ts` file is a standard trail file with its own schemas and its own `blaze` function. The framework discovers it because the main file declares `version: 2`. The file's existence is the declaration.

### File conventions

- The unsuffixed file is always current.
- `.v1.ts`, `.v2.ts`, etc. are previous versions.
- The framework discovers `.v*.ts` files when the main trail declares `version` > 1.
- If a `.v*.ts` file exists but the main trail has no `version` declaration, the warden flags it as an orphan.

### The copy-and-evolve workflow

The primary workflow requires no renaming and no version-qualifying variable names:

1. `user-create.ts` exists at v1 (no version declaration — implicitly v1)
2. Developer runs `trails version user.create`
3. CLI copies `user-create.ts` to `user-create.v1.ts` (exact copy, untouched)
4. CLI adds `version: 2` to the trail definition in `user-create.ts`
5. Developer edits `user-create.ts` — changes schemas, updates implementation
6. Done. The old behavior is preserved in the `.v1.ts` file as-is.

The `.v1.ts` file keeps its original variable names. The version is in the file convention, not in variable names.

### Version resolution in the execution pipeline

Version negotiation is a boundary concern. It happens at the trailhead, not in the implementation:

```text
Trailhead extracts requested version
  -> executeTrail(trail, input, { version })
  -> resolve version:
      if version === current -> validate input, run current impl, return output
      if version < current && adapter exists -> validate with version schema,
          adapt input, run current impl, adapt output, return
      if version < current && file-based impl exists -> validate with version schema,
          run version impl, return
      if version not supported -> Result.err(VersionNotSupportedError)
```

The implementation never sees the version. It receives its declared input shape and returns its declared output shape. The execution pipeline handles the translation.

### Trailhead negotiation strategies

Each trailhead negotiates version in its own idiom. The trailhead configuration declares the strategy:

| Trailhead | Strategy | Example | Default |
| --- | --- | --- | --- |
| HTTP | Path segment | `/v1/user/create`, `/v2/user/create` | `latest` |
| HTTP | Header | `X-API-Version: 2` | `latest` |
| HTTP | Query param | `?version=2` | `latest` |
| MCP | Tool parameter | Optional `_version` param on all tools | `latest` |
| MCP | Tool name suffix | `user.create@1` alongside `user.create` | `latest` |
| CLI | Global flag | `--api-version 1` | `latest` |
| WebSocket | Message envelope | Version in the message payload | `latest` |

Configuration on the trailhead builder:

```typescript
trailhead(app, {
  http: {
    versioning: 'path',       // or 'header', 'query'
    defaultVersion: 'latest', // or a specific number
    fallback: 'latest',       // if requested version doesn't exist, use latest
    // or: 'error',           // strict: error if requested version doesn't exist
  },
  mcp: {
    versioning: 'parameter',  // or 'suffix'
    defaultVersion: 'latest',
  },
});
```

When `versioning: 'path'`, the trailhead auto-generates routes for all supported versions. No manual route registration. `fallback: 'latest'` enables gradual migration. `fallback: 'error'` enables strict version contracts.

### Crossing chains run at current

When trail A crosses trail B, B runs at its current version. Version negotiation is a trailhead boundary concern — once inside the execution pipeline, everything runs at current.

The escape hatch is explicit version pinning:

```typescript
const result = await ctx.cross('other.trail', input, { version: 1 });
```

This exists for migration scenarios. The warden flags version-pinned crosses as a maintenance concern — they should eventually be removed.

Why not inherit the version from the trailhead request? If a consumer requests v1 of trail A, and trail A crosses trail B, the consumer requested v1 of A's contract. A's implementation handles the adaptation. Everything downstream is A's internal concern. Cascading version context through crossing chains would create invisible compatibility constraints.

### Deprecation is a lifecycle

Deprecation metadata lives on the version file or inline entry, not on the main trail:

```typescript
// user-create.v1.ts
export const createUser = trail('user.create', {
  deprecated: {
    sunset: '2026-06-01',
    successor: 2,
    migration: `
      - Add required \`email\` field to input
      - Output now includes \`email\` in response
    `,
  },
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string(), name: z.string() }),
  blaze: async (input) => { /* v1 behavior */ },
});
```

For inline adapter versions:

```typescript
version: {
  current: 2,
  1: {
    deprecated: '2026-06-01',
    input: z.object({ name: z.string() }),
    adapt: { input: addEmailDefault, output: dropEmail },
  },
},
```

### Trailheads derive deprecation behavior automatically

The trail contract carries deprecation metadata. Each trailhead renders it in its own idiom, with zero per-trailhead configuration:

| Trailhead | Deprecation behavior |
| --- | --- |
| **HTTP** | `Deprecation: true` header (RFC 8594), `Sunset` header, `Link` header pointing to successor |
| **MCP** | Tool description updated with notice; `_meta` includes deprecation status, sunset date, and successor |
| **CLI** | Warning to stderr with countdown to sunset; `--help` shows migration notes inline |
| **WebSocket** | Deprecation metadata in response envelope; version upgrade suggestion in handshake |

After sunset, behavior is configurable: keep serving with a stronger warning, or return the trailhead-appropriate error (HTTP 410 Gone, `VersionNotSupportedError` elsewhere).

### The full deprecation lifecycle

1. Trail ships at v1. No version declaration needed.
2. Developer evolves: `trails version user.create` copies the file and bumps the version.
3. Developer marks v1 deprecated: `trails deprecate user.create@1 --sunset 2026-06-01`.
4. Trailheads automatically emit deprecation signals. Tracing records version usage.
5. Developer monitors migration: `trails doctor` shows the traffic split and countdown.
6. After sunset, developer removes: `trails sunset user.create@1`.
7. Consumers requesting v1 get `VersionNotSupportedError` with a pointer to v2.

Tracing[^4] records every trail invocation with the requested version. This connects directly to the deprecation lifecycle — `trails doctor` shows how many consumers are still using deprecated versions, and the warden flags high traffic on deprecated versions approaching sunset.

### Error taxonomy gains `VersionNotSupportedError`

Returned when a consumer requests a version that does not exist or has been sunset. The error carries:

- The requested version
- The supported versions
- Whether the version was sunset (with the sunset date and successor pointer)

### Examples are per-version

A trail's examples at v2 validate v2 behavior. V1 examples validate the v1 adapter or v1 implementation. `testAll` runs examples for all supported versions, not just current.

For file-based versions, examples live in the `.v*.ts` file. For inline adapter versions, examples go in the version entry:

```typescript
version: {
  current: 2,
  1: {
    input: z.object({ name: z.string() }),
    adapt: { input: addEmailDefault, output: dropEmail },
    examples: [
      { input: { name: 'Alice' } },
    ],
  },
},
```

If a version has no examples, the warden warns. Untested versions are unverified versions.

### Lockfile representation

The lockfile gains version information on trail nodes. A versioned trail is one node with multiple entry points, not multiple nodes:

```json
{
  "user.create": {
    "version": 2,
    "supports": [1, 2],
    "versions": {
      "1": { "type": "file", "deprecated": "2026-06-01" },
      "2": { "type": "current" }
    },
    "trailheads": {
      "http": { "method": "POST", "path": "/v2/user/create" },
      "mcp": { "name": "myapp_user_create" }
    }
  }
}
```

The topo is still a single graph. Versions do not create separate topos.

### Warden rules

| Rule | Severity | Description |
| --- | --- | --- |
| `version-gap` | error | v3 exists but v2 does not (unless v2 was explicitly sunset and removed) |
| `adapter-completeness` | error | Input adapter exists but output schema changed without output adapter |
| `deprecated-without-sunset` | warning | Version marked deprecated but no sunset date |
| `past-sunset` | warning | Sunset date has passed but version is still present |
| `version-pinned-cross` | warning | `ctx.cross(..., { version })` found — should be temporary |
| `untested-version` | warning | Supported version has no examples |
| `orphan-version-file` | warning | `.v*.ts` file exists but main trail has no version declaration |
| `max-active-versions` | error | More than `maxActiveVersions` non-deprecated versions exist |
| `high-traffic-deprecated` | warning | Tracing shows > threshold % traffic on deprecated version near sunset |

### Resources do not version independently

A resource interface is an internal contract between the framework and the implementation. When a resource interface evolves, its consumers update. If a v1 trail implementation needs the old resource interface, it imports or references it directly in the `.v1.ts` file. Versioning complexity lives on the trail, where it belongs.

## Non-goals

- **Whole-app versioning.** Per-trail versioning exists because trails evolve independently. Building sugar for coordinated big-bang versioning signals the wrong pattern. If a team wants to label their app "v2," that is metadata on the topo, not a versioning mechanism.
- **Automatic adapter generation.** Given v1 and v2 schemas, the framework could generate adapters for simple cases (field additions, renames). Plausible but deferred — explicit adapters are safer initially.
- **Consumer version pinning via API keys.** Letting consumers pin to a version via API key or client configuration is an app-level concern, not a framework concern.

## Consequences

### Positive

- **Trails evolve independently.** No flag days. No big-bang migrations. Each trail moves at its own pace.
- **One implementation, multiple schemas.** Inline adapters mean the developer maintains one `blaze` function. Previous schemas are handled by pure data transformations.
- **Deprecation is data-driven.** Tracing provides the traffic data. The warden provides the governance. The developer makes removal decisions with evidence, not guesses.
- **Trailhead negotiation is derived.** Version routes, headers, tool parameters, and CLI flags are auto-generated from the trail contract. No manual wiring per version per trailhead.
- **The lockfile captures the full picture.** Version state is visible in one diffable artifact. CI catches version-related contract changes.

### Tradeoffs

- **File proliferation.** Long-lived trails accumulate `.v*.ts` files. The deprecation lifecycle and `trails sunset` command are the cleanup mechanism, but teams that delay sunset accumulate files.
- **Adapter correctness is manual.** The developer writes the adapter. If the adapter is wrong — silently dropping a field, incorrectly defaulting a value — the framework cannot catch it without examples. This is why untested versions trigger a warden warning.
- **Two-version limit is opinionated.** Teams with many long-lived consumers may push back. The escape hatch exists (`maxActiveVersions`), but the default assumes disciplined migration.

### Risks

- **Adapter chains.** If v1 adapts to v2 and v2 adapts to v3, performance degrades and debugging becomes harder. The two-active-version limit mitigates this by preventing deep adapter chains from forming organically.
- **Version-pinned crosses.** If teams use version pinning in `ctx.cross()` as a permanent pattern rather than a migration tool, it creates invisible compatibility constraints. The warden warning is the guardrail.

## Non-decisions

- **Version negotiation for `mount()`.** When apps compose via `mount`, how do version requests propagate across process boundaries? Tied to the mount protocol design.
- **Changelog generation from version diffs.** The framework has v1 and v2 schemas. A diff could produce "Added: email (required). Removed: legacy_mode." Useful, deferred.
- **Config auto-migration.** `config.fix()` rewriting config files between schema versions is deferred until the versioning model is implemented and validated.
- **Cross-contract compatibility with `crossInput`.** How `crossInput`[^5] changes interact with versioning. If a trail adds a required `crossInput` field, all callers must update. The interaction between versioning and typed composition is future work.

## References

- [ADR-0003: Unified Trail Primitive](../0003-unified-trail-primitive.md) — the trail as the single unit of work, the unit that versioning targets
- [ADR-0008: Deterministic Trailhead Derivation](../0008-deterministic-trailhead-derivation.md) — derivation rules that versioned trailhead projections extend
- [ADR-0017: The Serialized Topo Graph](../0017-serialized-topo-graph.md) — the lockfile that captures version state
- [ADR-0013: Tracing](../0013-tracing.md) — runtime recording that powers version traffic monitoring
- [ADR-0002: Built-In Result Type](../0002-built-in-result-type.md) — the Result and error taxonomy that gains `VersionNotSupportedError`
- [ADR-0024: Typed Trail Composition](../0024-typed-trail-composition.md) — `crossInput` and its interaction with versioning
- [Tenets: The trail is the product](../../tenets.md) — the governing principle; if the trail is the unit of contract, it is the unit of versioning

[^1]: [ADR-0003: Unified Trail Primitive](../0003-unified-trail-primitive.md) — the trail as the single primitive
[^2]: [ADR-0008: Deterministic Trailhead Derivation](../0008-deterministic-trailhead-derivation.md) — deterministic derivation rules
[^3]: [ADR-0017: The Serialized Topo Graph](../0017-serialized-topo-graph.md) — the lockfile as resolved state
[^4]: [ADR-0013: Tracing](../0013-tracing.md) — runtime recording primitive
[^5]: [ADR-0024: Typed Trail Composition](../0024-typed-trail-composition.md) — the `crossInput` field
