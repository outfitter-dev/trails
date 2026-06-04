# Connector to Adapter Migration Guide

How to migrate consumers from the retired `connector` vocabulary to the canonical `adapter` vocabulary. This is a clean cut: Trails does not ship compatibility aliases for connector-era public names, source paths, or package subpaths.

This guide is temporary. Deprecate it after first-party Trails projects and downstream consumers have migrated. Until then, treat it as the rename checklist for current-facing docs, APIs, package README files, and workspace paths.

## Overview

`adapter` is now the public package and subpath category for code that bridges Trails to a named external library, framework, tool, platform, format, or ecosystem. Historical prose may still mention `connector`, but current APIs, generated examples, package docs, and workspace paths use `adapter`.

`integration` remains ordinary English, not a taxonomy bucket. `facet` remains reserved for projection slices of authored contracts or surfaces.

## Rename Map

| Old | New | Action |
| --- | --- | --- |
| `AuthConnector` | `AuthAdapter` | Update auth adapter implementations and imports from `@ontrails/permits`. |
| `authConnectorSchema` | `authAdapterSchema` | Update schema imports and tests. |
| `JwtConnectorOptions` | `JwtAdapterOptions` | Update JWT option type imports from `@ontrails/permits/jwt`. |
| `createJwtConnector(options)` | `createJwtAdapter(options)` | Update JWT auth factory imports from `@ontrails/permits/jwt`. |
| auth resource config `{ connector: 'jwt' \| 'none' }` | `{ adapter: 'jwt' \| 'none' }` | Rename the discriminant in auth resource config and test fixtures. |
| `createOtelConnector(options)` | `createOtelAdapter(options)` | Update OTel trace sink factory imports from `@ontrails/tracing/otel` or `@ontrails/tracing`; the exporter option is required. |
| `OtelConnectorOptions` | `OtelAdapterOptions` | Update OTel option type imports. |
| `StoreConnectorOptions` | `StoreAdapterOptions` | Update store adapter option type imports from `@ontrails/store`. |
| workspace root `connectors/` | `adapters/` | Update local workspace paths and regenerate `bun.lock` with `bun install`. |
| `@ontrails/cli/commander` | `@ontrails/commander` | Move active Commander consumers to the dedicated adapter package. |
| public taxonomy term `connector` | `adapter` | Rewrite current-facing package, subpath, and API prose. Keep historical, migration, and changelog mentions when clearly marked. |

Built-in adapter subpaths remain intentionally scoped to their owning package when they are dependency-light:

- `@ontrails/permits/jwt` remains the JWT auth adapter subpath.
- `@ontrails/tracing/otel` remains the OpenTelemetry trace adapter subpath.

Do not extract `@ontrails/jwt` or `@ontrails/otel` as part of this migration.

## Adapter Kit And Surface Projection Evidence

`@ontrails/adapter-kit` checks adapter package readiness. It verifies package placement, owner target metadata, public exports, dependency direction, and conformance tests. That is **contract-content conformance**: the adapter package claims a target and proves it can be built and reviewed as that target.

Surface facets introduce a separate kind of question: whether a surface adapter can support a grouped affordance over already-resolved trails. That is **surface-projection conformance**. It should consume resolved projection evidence such as the facet ID, member trail IDs, effective visibility, description, member-set hash, and `{ trail, output }` correlation shape.

Do not add facet authoring configuration to adapter-kit. Adapter-kit may expose raw evidence such as `adapterType` and target conformance paths; the surface or governance layer that already has the resolved projection should validate any future grouped-affordance claim. No adapter target is required to support grouping unless it explicitly claims that capability.

## Code Imports

Prefer direct imports of the canonical names:

```typescript
import type { AuthAdapter } from '@ontrails/permits';
import { authAdapterSchema } from '@ontrails/permits';
import { createJwtAdapter } from '@ontrails/permits/jwt';
import type { JwtAdapterOptions } from '@ontrails/permits/jwt';
import { createOtelAdapter } from '@ontrails/tracing/otel';
import type { OtelAdapterOptions } from '@ontrails/tracing/otel';
```

Remove imports of `AuthConnector`, `authConnectorSchema`, `JwtConnectorOptions`, `createJwtConnector`, `OtelConnectorOptions`, and `createOtelConnector`.

## Auth Resource Config

Rename the auth resource discriminant:

```diff
 authResource.create({
-  connector: 'jwt',
+  adapter: 'jwt',
   secret: process.env.JWT_SECRET,
 });
```

The same rename applies to the no-auth shape:

```diff
-{ connector: 'none' }
+{ adapter: 'none' }
```

## Workspace Paths

The workspace-root package directory moves from `connectors/` to `adapters/`. After moving the directories and updating the root workspace glob, regenerate the lockfile:

```bash
bun install
```

Do not hand-edit `bun.lock`; the lockfile should record path-only workspace changes without version drift.

## Commander Adapter

The CLI contract model stays in `@ontrails/cli`. Commander-specific runtime materialization moves to the dedicated `@ontrails/commander` adapter package by direct cutover:

```diff
-import { surface } from '@ontrails/cli/commander';
+import { surface } from '@ontrails/commander';
```

There is no long-lived `@ontrails/cli/commander` compatibility subpath after the cutover.

## Documentation And History

Treat remaining `connector` mentions by role:

- **Substitution-class:** current-facing package/API/docs prose that should say
  `adapter`, `backend`, or `surface`.
- **Mention-class:** migration notes, quotes, or explicitly historical context.
- **Accepted-history:** ADR slugs, changelogs, and release notes that record the
  old term as it existed when written.

Do not run a broad automatic prose rewrite. Some sentences need `adapter`, some need `backend`, some need `surface`, and some should remain historical.

## Changesets And Publishing

Changesets in this cutover are version and changelog metadata only. Package publication later uses the repo's Bun publish flow:

```bash
bun run publish:check
bun run publish:packages
```

Do not use `changeset publish` or `npm publish` for this migration.
