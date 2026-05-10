# Beta 15

Planned release: `1.0.0-beta.15`.

Beta 15 is a release-readiness pass for the Trails CLI and package publishing flow. It keeps the current CLI package shape in place while making generated projects easier to publish and run outside the monorepo.

## Highlights

### Trails CLI release readiness

`@ontrails/trails` now derives its printed version from package metadata instead of a hard-coded string. This keeps `trails --version` aligned with the package that was actually published.

The project scaffolder now emits publishable package ranges instead of workspace-only dependency ranges. Generated apps should be able to install and run without being inside the Trails monorepo.

### HTTP scaffolding

The `trails create` and `trails add surface` flows can generate the HTTP surface alongside CLI and MCP. The generated HTTP entrypoint uses `@ontrails/hono` over the framework HTTP surface model.

```bash
trails create my-app --surfaces cli http
trails add surface http
```

The CLI surface uses the dedicated Commander adapter package:

```ts
import { surface } from '@ontrails/commander';
```

Older generated projects that still import the retired `@ontrails/cli/commander`
subpath should migrate to `@ontrails/commander`.

### Generated project toolchain

Generated projects now include the dev dependencies needed by their emitted scripts, including TypeScript, Ultracite, oxlint, and Bun types. The generated Warden hook no longer passes unsupported flags.

### Safer CLI trails

Destructive developer/topo trails now declare scoped permits so the CLI app dogfoods the same authorization model expected from user-authored Trails apps.

### Publish matrix cleanup

The package publishing script now includes the Vite adapter. Active Changesets prerelease metadata has also been cleaned up so beta.15 status checks report the intended release plan.

### Observability cleanup

`@ontrails/logging` has been retired before v1. Use `@ontrails/observe` for log and trace sink contracts, built-in console/file/memory sinks, sink composition, and trace rendering. Keep `@ontrails/tracing` for intrinsic tracing compatibility, tracing query/status trails, the SQLite dev store, sampling helpers, and the supported `@ontrails/tracing/otel` adapter subpath. Use `@ontrails/logtape` when forwarding Trails log records to an existing LogTape-shaped logger.

## Migration from beta.14

Beta 15 is not a broad API migration. Most existing Trails apps can upgrade by bumping package versions and aligning generated project files with the current scaffolder.

### Surface API cutover (ADR-0035)

The published `CHANGELOG.md` for `@ontrails/cli` and `@ontrails/mcp` attributes the lexicon work to ADR-0023, but the surface-API renames listed here are governed by [ADR-0035: Surface APIs Render the Graph](../adr/0035-surface-apis-render-the-graph.md). Both ADRs landed in the beta.15 cut.

| Old (beta.14) | New (beta.15) | Where |
| --- | --- | --- |
| `import { trailhead } from '@ontrails/cli/commander'` | `import { surface } from '@ontrails/commander'` | CLI entry |
| `import { trailhead } from '@ontrails/mcp'` | `import { surface } from '@ontrails/mcp'` | MCP entry |
| `trailhead(app)` / `await trailhead(app)` | `surface(app)` / `await surface(app)` | Both |
| `TrailheadCliOptions` | `CreateProgramOptions` | `@ontrails/commander` |
| `TrailheadMcpOptions` | `CreateServerOptions` | `@ontrails/mcp` |
| MCP options `serverInfo: { name, version }` | flat `name`, `version` on the options object | `@ontrails/mcp` |
| MCP options `transport: ...` | dropped (stdio-only) | `@ontrails/mcp` |
| Hono surface options `serve: false` | dropped (always serves) | `@ontrails/hono` |
| `CliHarnessOptions.app` / `McpHarnessOptions.app` | `.graph` | `@ontrails/testing` |

### Lexicon (ADR-0023)

| Old (beta.14) | New (beta.15) |
| --- | --- |
| `provision()` factory + `provisions: [...]` field | `resource()` + `resources: [...]` |
| `gate(...)` | `layer(...)` |
| `loadout(...)` | `profile(...)` |
| `tracker` package + `Track`/`TrackRecord` types | `@ontrails/tracing` + `TraceRecord` |

| If you have | Do this for beta 15 |
| --- | --- |
| `workspace:^` or `workspace:*` ranges in a generated app | Replace them with published `^1.0.0-beta.15` ranges |
| Generated scripts but no local toolchain dev dependencies | Add TypeScript, Ultracite, oxlint, and Bun types |
| A generated Warden hook using `--exit-code` | Remove the unsupported flag |
| A project that wants HTTP | Add `@ontrails/http` and `@ontrails/hono`, then add `src/http.ts` |
| `@ontrails/logging` | Migrate to `@ontrails/observe`; use `@ontrails/logtape` for LogTape forwarding |
| `@ontrails/tracker` | Migrate to `@ontrails/tracing` |
| `@ontrails/crumbs` | Remove it unless you have a private compatibility reason |
| `@ontrails/cli/commander` | Migrate to `@ontrails/commander` |

### Package versions

Upgrade `@ontrails/*` packages together. Trails packages are versioned in lockstep, so do not mix beta.14 and beta.15 packages in the same app.

```json
{
  "dependencies": {
    "@ontrails/core": "^1.0.0-beta.15",
    "@ontrails/cli": "^1.0.0-beta.15",
    "@ontrails/commander": "^1.0.0-beta.15",
    "@ontrails/mcp": "^1.0.0-beta.15",
    "@ontrails/http": "^1.0.0-beta.15",
    "@ontrails/hono": "^1.0.0-beta.15",
    "@ontrails/drizzle": "^1.0.0-beta.15",
    "@ontrails/tracing": "^1.0.0-beta.15"
  }
}
```

Move CLI imports to `@ontrails/commander`; the old `@ontrails/cli/commander`
subpath is not exported by the beta.15 CLI package. `@ontrails/commander` owns
the Commander runtime dependency, so apps only need a direct `commander`
dependency when they import Commander APIs themselves.

### Existing generated projects

Projects created before beta.15 may contain monorepo-only dependency ranges such as `workspace:^`. Replace those with published semver ranges before publishing or installing outside the Trails monorepo.

```diff
{
  "dependencies": {
-   "@ontrails/core": "workspace:^",
-   "@ontrails/cli": "workspace:^"
+   "@ontrails/core": "^1.0.0-beta.15",
+   "@ontrails/cli": "^1.0.0-beta.15",
+   "@ontrails/commander": "^1.0.0-beta.15"
  }
}
```

Generated projects should also include the toolchain dependencies used by their emitted scripts:

```json
{
  "devDependencies": {
    "@types/bun": "^1.3.11",
    "oxlint": "1.50.0",
    "typescript": "^5.9.3",
    "ultracite": "7.2.3"
  }
}
```

If the project uses generated verification, keep `@ontrails/testing`, `@ontrails/warden`, and `lefthook` in `devDependencies`.

If an older generated project still imports an extracted adapter through an old subpath, prefer the adapter package:

| Old import | Beta 15 import |
| --- | --- |
| `@ontrails/http/hono` | `@ontrails/hono` |
| `@ontrails/store/drizzle` | `@ontrails/drizzle` |

### CLI surface

Generated beta.15 CLI apps should import the Commander adapter package:

```ts
import { surface } from '@ontrails/commander';
```

Generated CLI entrypoints should continue to call:

```ts
await surface(app);
```

### HTTP surface

To add the new generated HTTP surface to an existing project, install the HTTP packages and create `src/http.ts`:

```bash
bun add @ontrails/http@1.0.0-beta.15 @ontrails/hono@1.0.0-beta.15
```

```ts
import { surface } from '@ontrails/hono';

import { app } from './app.js';

await surface(app, { port: 3000 });
```

The Trails CLI can generate the same entrypoint:

```bash
trails add surface http
```

### Observability

Move logging and trace sink imports to `@ontrails/observe`:

```diff
- import { createConsoleSink, createFileSink } from '@ontrails/logging';
+ import { createConsoleSink, createFileSink } from '@ontrails/observe';
```

Use `@ontrails/logtape` for LogTape forwarding:

```ts
import { createLogtapeSink } from '@ontrails/logtape';

const sink = createLogtapeSink({ logger });
```

Use `@ontrails/tracing/otel` for the v1 OpenTelemetry trace adapter:

```ts
import { createOtelAdapter } from '@ontrails/tracing/otel';
```

### Warden hook

If a generated `lefthook.yml` includes an unsupported Warden flag such as `--exit-code`, remove it. The beta.15 scaffold uses:

```yaml
pre-push:
  commands:
    warden:
      run: bunx trails warden
```

If you author destructive trails, keep their contracts explicit: use `intent: 'destroy'` and declare the scoped permit required to run them. Beta 15 applies that pattern to the Trails CLI's own destructive developer/topo trails.

### Retired package names

If an older project still depends on `@ontrails/tracker`, migrate to `@ontrails/tracing`. If it still depends on `@ontrails/crumbs`, remove it unless the project has a private compatibility reason to keep it. These older names are not part of the beta.15 package set.

## Known Follow-Up Work

Beta 15 intentionally does not take on the larger CLI grammar and package-shape changes discussed during release prep. Those belong in follow-up work:

- **Trails CLI improvements** — command grammar and authoring ergonomics for `add trail`, `add surface`, `draft promote`, dry-run plans, and flagless project discovery.
- **Trails CLI schemas** — a framework-level `schema` command in `@ontrails/cli` so CLI apps can expose derived command contracts by default.

## Packages

All `@ontrails/*` packages remain versioned in lockstep as `1.0.0-beta.15`.

New or newly publishable packages in the beta.15 publish flow include:

- `@ontrails/hono`
- `@ontrails/vite`
- `@ontrails/drizzle`
- `@ontrails/observe`
- `@ontrails/logtape`
- `@ontrails/tracing`
- `@ontrails/commander`

Deprecated package names `@ontrails/tracker` and `@ontrails/crumbs` have been retired on npm with `npm deprecate`. Both point at `@ontrails/tracing` in their deprecation messages; new installs surface a visible warning.

`@ontrails/logging` is not part of the beta.15 package set. New apps should not install it.
