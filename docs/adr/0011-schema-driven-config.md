---
id: 11
slug: schema-driven-config
title: Schema-Driven Config
status: accepted
created: 2026-03-30
updated: 2026-04-01
owners: ['[galligan](https://github.com/galligan)']
---

# ADR-0011: Schema-Driven Config

## Context

### The gap

Real apps need config. Database URLs, API keys, feature flags, sampling rates, JWT secrets, connection pool sizes. Today, services read raw environment variables via `svc.env`:

```typescript
const db = service('db.main', {
  create: (svc) => Result.ok(openDatabase(svc.env?.DATABASE_URL)),
});
```

This works. It's also manual parsing with no validation, no defaults, no documentation, and no type safety. Every service duplicates the same pattern: read a string from `process.env`, hope it's there, cast it to the right type, move on.

Config feeds everything in a Trails app. Service factories need connection strings. Auth layers need JWT secrets. Crumbs need sampling rates. The question isn't whether config needs a system — it's whether the system can follow the Trails pattern: author a typed contract, derive the rest.

### What config touches

Config is upstream of everything that runs:

- **Services** — `svc.config.db.url` instead of `svc.env?.DATABASE_URL`
- **Auth** — JWT secrets, issuer URLs, token lifetimes
- **Crumbs** — sampling rates, enabled/disabled, export targets
- **Layers** — transaction boundaries, caching TTLs, rate limits

Today none of these have a typed contract. Each reads raw strings from the environment and parses them independently.

### Why TypeScript config

Bun runs TypeScript natively. A `.ts` config file gives autocomplete at authoring time, computed values, shared constants, comments, and type safety — with zero build step. JSON, TOML, and YAML are also supported — Bun imports all three natively with zero parsing dependencies.

### Config is a general-purpose primitive

Trails apps aren't just configured — they ship configuration to their users. A CLI tool built on Trails needs the same config story that Trails itself has: schema declaration, file discovery, multi-format parsing, validation, example generation, and diagnostics.

`appConfig` is that primitive. Trails uses it for `trails.config.ts`. Apps use it for their own config files (`.myapprc.toml`, `myapp.config.json`, etc.). One system, dogfooded from day one.

## Decision

### `appConfig` as the foundational primitive

`appConfig` declares a config contract: name, schema, supported formats, and file conventions. From that declaration, the framework derives discovery, parsing, validation, example generation, and diagnostics.

`defineConfig` (used in `trails.config.ts`) is built on `appConfig` — it's `appConfig('trails', ...)` with the framework's own schema and conventions. App authors use the same API:

```typescript
import { appConfig, deprecated } from '@ontrails/config';
import { z } from 'zod';

export const config = appConfig('myapp', {
  schema: z.object({
    output: z.string().describe('Output directory').default('./output'),
    verbose: z.boolean().default(false),
    sources: z.array(sourceSchema).default([]),
    legacyMode: deprecated(z.boolean(), 'Use `sources` with the new format instead').default(false),
  }),
  formats: ['toml', 'jsonc', 'yaml'],  // supported formats, first is default for generation
  dotfile: true,                         // .myapprc.toml vs myapprc.toml
});
```

The declaration controls everything: schema, file conventions, format preferences. `jsonc` enables comments in generated JSON files; `json` generates plain JSON without comments. The developer chooses.

From this declaration, the framework derives:

- **Discovery** — `config.resolve()` searches for `.myapprc.toml`, `.myapprc.jsonc`, `.myapprc.yaml` (walking up from cwd or a specified path). Bun native imports handle parsing with zero dependencies.
- **Example generation** — `config.generateExample('toml')` produces a commented example file derived from the schema. Defaults shown, required fields marked, `.describe()` text as comments, `.deprecated()` fields annotated with migration guidance. Value constraints (min/max, regex patterns, enum options) are rendered as inline comments.
- **JSON Schema generation** — `config.jsonSchema()` produces a standard JSON Schema derived from the Zod schema. Shippable as a generated artifact (`.trails/generated/myapp.schema.json`), publishable to a URL, or bundled in the package. IDEs that support `$schema` references get autocomplete and validation for free — the same experience developers get from `biome.json` or `tsconfig.json`.
- **Introspection** — `config.describe()` returns a structured catalog of every field: path, type, default, description, deprecated status, env binding, and value constraints. Powers `myapp config options` on CLI and agent inspection via MCP. No config file needs to exist — this describes what's possible, not what's configured.
- **Validation / doctor** — `config.check(path?)` finds the config, parses it, validates through the Zod schema, and returns structured diagnostics: which fields are valid, which are missing, which use defaults, which are deprecated. CLI renders a human-readable checklist. Agents consume the structured form.
- **Init** — `config.init(dir?, format?)` writes the example file to the target directory. One command to bootstrap a config file for end users.

### Two paths: derived and expert

The Trails-native developer declares a Zod schema and gets discovery, parsing, validation, examples, JSON Schema, introspection, and doctor for free. Everything derives from the schema.

The expert who wants full control can provide custom validators, custom example generators, or custom format handlers through extension points on `appConfig`. The framework calls their code at the right time — during validation, during generation, during introspection — but doesn't force the derived path. Both paths produce the same shaped output so surfaces, the warden, and agents don't care which path was used.

### Config fields as trail input defaults

Config fields can serve as defaults for trail inputs. A trail that accepts an `output` input can declare that its default comes from config:

```typescript
const generate = trail('report.generate', {
  input: z.object({
    output: z.string().default(config.ref('output')),
    format: z.enum(['json', 'html']).default('html'),
  }),
  // ...
});
```

`config.ref('output')` creates a lazy reference resolved at invocation time. The trail input schema still validates independently — config provides the default, not the type. CLI users see the config value as the default in `--help`. Agents see it in survey. Override per-invocation via flags or input, or change it in the config file to change the default everywhere.

### `defineConfig` is `appConfig` for Trails itself

The config entry point is `trails.config.ts` at the project root:

```typescript
import { defineConfig, env, secret } from '@ontrails/config';
import { z } from 'zod';

export default defineConfig({
  schema: z.object({
    db: z.object({
      url: secret(env(z.string(), 'DATABASE_URL')),
      poolSize: env(z.number(), 'DB_POOL_SIZE').default(10),
    }),
    auth: z.object({
      jwtSecret: secret(env(z.string(), 'JWT_SECRET')),
      issuer: z.string().default('https://auth.example.com'),
    }),
    crumbs: z.object({
      enabled: z.boolean().default(true),
      samplingRate: z.number().default(1.0),
    }),
  }),
  base: {
    db: { url: 'sqlite://dev.db' },
  },
  loadouts: {
    production: { db: { poolSize: 20 } },
    test: { db: { url: 'sqlite://:memory:', poolSize: 1 } },
  },
});
```

Zod gives type safety at authoring time. `defineConfig()` infers the full config type from the schema. Loadouts are typed as `DeepPartial<SchemaInput>` — TypeScript knows what fields exist.

### Collapsed loadout model

Resolution stack (later overrides earlier):

1. **Schema defaults** — `z.number().default(10)`
2. **App-authored config** — `base` merged with the selected loadout, keyed by `TRAILS_ENV`
3. **Local overrides** — `.trails/config/local.ts`, gitignored, per-developer
4. **Environment variables** — auto-mapped from `.env()` bindings on schema fields

Five layers were considered. **CLI flag derivation from config was explicitly rejected.** Config flags would conflict with trail input flags on the same CLI surface. Environment variables are the command-line override mechanism.

Loadouts are deep-partial overrides of `base`, not self-contained configs. Shared config lives in `base` once. Environment-specific deltas live in `loadouts`. Author the minimum new information.

### `env()` on the schema field

Env var bindings are co-located with the field definition via wrapper functions:

```typescript
url: secret(env(z.string(), 'DATABASE_URL')),
poolSize: env(z.number(), 'DB_POOL_SIZE').default(5),
```

> **Note:** Zod 4 metadata (`globalRegistry` + `.meta()`) supports arbitrary keys but not custom chainable methods. Wrapper functions (`env()`, `secret()`, `deprecated()`) compose via `.meta()` merging. All metadata helpers must be called **before** `.default()`, `.optional()`, or other transforms — these create wrapper schemas that don't carry inner metadata forward.

No separate mapping file that drifts from the schema. The warden lints env bindings for collisions. Survey reports them alongside field metadata. One source of truth.

### Composable config from services

Services declare their own config schemas via the reserved `config` field from ADR-0009:

```typescript
const entityStore = service('entity.store', {
  config: z.object({
    url: env(z.string(), 'ENTITY_STORE_URL'),
    poolSize: z.number().default(5),
  }),
  create: (svc) => Result.ok(openStore(svc.config.url)),
});
```

The framework composes service config schemas under their service IDs. The app's `trails.config.ts` fills in the values:

```typescript
export default defineConfig({
  base: {
    'entity.store': { url: 'sqlite://dev.db' },
  },
});
```

If every field has a default, the service works with zero config. Install a pack, its services declare what they need, the framework tells you what's missing at startup.

### Config enriches ServiceContext

`ServiceContext` gains a typed `config` field. `svc.config.url` instead of `svc.env?.DATABASE_URL` with manual `parseInt` for numbers. Validated, defaulted, typed. The `env` field remains as a fallback for one-off values that don't warrant schema definition.

### Config as runtime bootstrap, not topo

Config does NOT live on `topo()`. Topo is the contract graph — trails, events, services. Config is deployment state. Mixing the two conflates what a system can do with how a specific deployment is configured.

Config is resolved in `trailhead()` / `run()` options:

```typescript
await trailhead(app, { config });
await run(app, 'search', input, { config });
```

Resolution order:

1. Resolve and validate config
2. Attach config to `ServiceContext`
3. Resolve services (factories read `svc.config` instead of `svc.env`)
4. Compose layers
5. Execute

Config resolution is synchronous and deterministic. Service factories that follow may be sync or async — connecting to a remote database, validating credentials, or performing any other async initialization. The boundary is clean: config is fully resolved before any factory runs, and factories receive typed, validated config through `svc.config`.

### `explain()` for debuggability

Structured output showing which source won for each field:

```typescript
const resolved = await resolveConfig(definition, { loadout: 'production' });
resolved.explain();
```

Returns machine-readable provenance — each entry shows the field path, the winning source, whether it's redacted, and every candidate that was considered. The CLI renders human-readable output from this. Survey consumes the structured form. Both derive from one source.

### `secret()` as Zod metadata

`secret()` wraps a Zod schema with metadata. It doesn't change validation or type inference:

```typescript
jwtSecret: secret(z.string())  // still infers as string, validates as string
```

Secrets are redacted in `survey --config` output and `explain()` traces. Explicit annotation is primary. Naming heuristics (`_SECRET`, `_TOKEN`, `_KEY`) are a fallback safety net, not a substitute.

### `TRAILS_ENV`

Any string matching a loadout key. Unset means base config only — no loadout applied.

Testing auto-resolves the `test` loadout when `TRAILS_ENV=test` (the default in test context). `testExamples(app)` ignores local overrides — tests must be hermetic.

`TRAILS_ENV` is independent from `NODE_ENV`. Opt-in alignment via `envFromNodeEnv` on `defineConfig()` for teams that want a single knob.

### Generated artifacts

Every `appConfig` declaration generates three artifact types:

**Example config files** in any supported format. For `defineConfig` (Trails' own config), the framework also generates `.trails/generated/.env.example` from composed service config schemas:

```bash
# DATABASE_URL=           # required, string, secret
# DB_POOL_SIZE=10         # optional, default: 10
# JWT_SECRET=             # required, string, secret
```

For app-facing config, `config.generateExample('toml')` produces format-appropriate output with descriptions, constraints, and deprecation notices:

```toml
# Output directory
# output = "./output"

# verbose = false

# DEPRECATED: Use `sources` with the new format instead
# legacy_mode = false

# [[sources]]
# name = ""          # required
# base_url = ""      # required, must be a valid URL
```

JSONC format includes the same comments. Plain JSON omits them — the developer's `formats` declaration controls this.

**JSON Schema** at `.trails/generated/<name>.schema.json`. Derived from the Zod schema. Publishable to a URL or bundled in the package's `exports`. IDEs with `$schema` support get autocomplete and inline validation — the config file lights up like `tsconfig.json` does.

**Introspection output** — not a file, but a queryable structure. `config.describe()` returns the full field catalog. CLI renders it as `myapp config options`. Survey includes it. Agents query it via MCP.

Add a field to the schema, all three update. Remove a field, all three update. The warden flags when generated files are stale. Always current, never hand-maintained.

### Config doctor

`config.check()` returns structured diagnostics for any `appConfig` — including Trails' own:

```text
myapp config check

  .myapprc.toml

  ✓ File found at ./.myapprc.toml
  ✓ Valid TOML syntax
  ✗ sources[2].base_url — required field missing
  ⚠ output — using default "./output" (not set in file)
  ✓ 4 of 5 fields valid
```

The same structured output feeds CLI rendering, agent inspection, and the warden. A trail can expose `config.check` as a first-class operation — queryable, testable, surfaceable on MCP for agents that need to diagnose config issues programmatically.

### Validation error UX

Auto-derived from the schema and env mapping:

```text
Config validation failed:

  db.url is required but missing.
  Set DATABASE_URL or add db.url to trails.config.ts

  auth.jwtSecret is required but missing.
  Set JWT_SECRET or add auth.jwtSecret to trails.config.ts
```

The framework knows the field path, the env binding, and the config file location. It tells you exactly what to do. No stack traces for missing config.

### Config files are sync and deterministic

No async. No top-level await. No network calls in v1. Computed values from `process.env` are fine. Remote secret managers are a future provider concern.

This keeps config resolution predictable and fast. The entire config tree resolves before any service factory runs.

## Consequences

### Positive

- **One schema defines everything.** Type, validation, defaults, env mapping, secret annotation, deprecation, descriptions, and value constraints — all co-located on the field definition.
- **Services get typed config.** `svc.config.url` instead of raw env parsing and manual type coercion.
- **Generated artifacts never drift.** Example files, JSON Schema, `.env.example` — all derived from the same schemas that validate at runtime.
- **`explain()` makes debugging config trivial.** Structured provenance answers "where did this value come from?" without guessing.
- **`describe()` makes introspection trivial.** Agents and CLI users can enumerate every config option without reading source code or documentation.
- **JSON Schema gives IDE support for free.** Autocomplete and inline validation in config files, same experience as established tools.
- **Composable config follows the pack model.** Install a pack, its services declare their config needs. The framework tells you what's missing.
- **`config.ref()` connects config to trail inputs.** Config values serve as defaults for trail inputs without coupling the two schemas. One source of truth for defaults, overridable per-invocation.
- **`appConfig` is the same primitive Trails uses.** Not a second-class utility — the framework's own config runs on the same system apps use.

### Tradeoffs

- **`env()` and `secret()` use Zod's metadata API.** Implementation depends on Zod 4's `globalRegistry` and `.meta()`. Wrapper functions compose metadata before transforms. If Zod's metadata model changes, this surface breaks.
- **Composable config adds schema merging complexity.** Multiple services contributing config schemas means the framework must handle namespace scoping and conflict detection.
- **No CLI flag derivation from config.** Environment variables are the only command-line override mechanism. Teams that want flags must set env vars or use wrapper scripts.

### What this does NOT decide

- **Remote config providers.** Vault, AWS SSM, GCP Secret Manager — these are future provider adapters, not v1.
- **Config change detection / hot reload.** Restart-on-change via `bun --watch` is sufficient for development. Runtime reload is a different problem.
- **Config watching in development.** File watchers on `trails.config.ts` are deferred. The restart model is simple and correct.
- **Config migration and auto-fix.** When a schema evolves (fields renamed, deprecated fields removed, new required fields added), `config.check()` can report the problems. Automatically rewriting a user's config file to match the new schema — renaming keys, removing deprecated fields, adding new defaults — is a future capability. The schema diffing infrastructure will be there (two JSON Schemas, structural comparison), but the rewriting tool ships after the Trails versioning model is settled.
- **Config versioning model.** How a Trails app declares schema versions, how users pin to a version, and how the framework negotiates between them. This is tied to the broader Trails API versioning story and will be addressed in a dedicated ADR.

## References

- [ADR-0000: Core Premise](0000-core-premise.md) — "one write, many reads" and "derive by default" — config derives discovery, validation, examples, and introspection from a single schema declaration
- [ADR-0009: Services as a First-Class Primitive](0009-first-class-services.md) — services declare config schemas via the reserved `config` field; config enriches `ServiceContext`
- [ADR-0010: Trails-Native Infrastructure Pattern](0010-native-infrastructure.md) — config is the first infrastructure package following the service + layer + trails trifecta
- [ADR-0013: Crumbs](0013-crumbs.md) — crumbs consume config for sampling rates and export targets
