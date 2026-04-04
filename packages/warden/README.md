# @ontrails/warden

AST-based code convention rules for Trails. 13 lint rules that catch contract violations at development time, plus lock drift detection and CI formatters.

Structural checks (cross target existence, declared provision existence, recursive crossing, example schema validation) live in `validateTopo()` from `@ontrails/core`. Warden handles the code-level rules that need AST analysis.

## Usage

From the Trails CLI:

```bash
trails warden              # Run all checks
trails warden --exit-code  # Non-zero exit on errors or drift
trails warden --lint-only  # Skip drift detection
trails warden --drift-only # Skip lint rules
```

Or programmatically:

```typescript
import { runWarden, formatWardenReport } from '@ontrails/warden';

const report = await runWarden(app, { exitCode: true });
console.log(formatWardenReport(report));
```

## Rules

| Rule | Severity | What it catches |
| --- | --- | --- |
| `no-throw-in-implementation` | error | `throw` inside blaze bodies |
| `implementation-returns-result` | error | Blaze functions returning raw values instead of `Result` |
| `context-no-trailhead-types` | error | Trailhead type imports (`Request`, `McpSession`) in trail files |
| `no-sync-result-assumption` | error | Missing `await` on `.blaze()` results |
| `valid-detour-refs` | error | Detour targets that do not exist in the topo |
| `no-throw-in-detour-target` | error | `throw` inside detour target trails |
| `no-direct-implementation-call` | warn | Direct `.blaze()` calls bypassing `ctx.cross()` |
| `no-direct-impl-in-route` | warn | Direct `.blaze()` calls inside trail bodies with `crosses` |
| `prefer-schema-inference` | warn | Redundant field overrides already derivable from the schema |
| `cross-declarations` | error/warn | `ctx.cross()` calls that drift from declared `crosses: [...]` |
| `provision-declarations` | error/warn | `provision.from(ctx)` / `ctx.provision()` usage that drifts from declared `provisions: [...]` |
| `provision-exists` | error | Declared or referenced provision IDs that do not resolve in project context |
| `valid-describe-refs` | warn | `@see` refs in `.describe()` that do not resolve |

## Drift detection

Warden integrates with `@ontrails/schema` to detect when the topo has changed without updating the lock file:

```typescript
import { checkDrift } from '@ontrails/warden';

const drift = await checkDrift(app);
if (drift.stale) {
  console.log('lock file is stale -- regenerate with `trails topo export`');
}
```

## CI integration

Add to lefthook for pre-push enforcement:

```yaml
pre-push:
  commands:
    warden:
      blaze: trails warden --exit-code
      tags: governance
```

CI formatters for structured output:

```typescript
import { formatGitHubAnnotations, formatJson, formatSummary } from '@ontrails/warden';
```

## Trail-based API

Every built-in warden rule is also available as a composable trail. This makes rules queryable, testable, and invocable through any Trails trailhead.

```typescript
import { wardenTopo, runWardenTrails } from '@ontrails/warden';

// Inspect the warden rule trails
console.log(wardenTopo.ids()); // ['warden.rule.no-throw-in-implementation', ...]

// Run all rule trails against a source file
const diagnostics = await runWardenTrails(filePath, sourceCode, {
  knownTrailIds: myApp.ids(),
  knownProvisionIds: myApp.provisionIds(),
});
```

To wrap a custom rule as a trail, use `wrapRule` (imported from `@ontrails/warden/trails/wrap-rule`). This is the same factory used internally to build all built-in rule trails.

## API

| Export | What it does |
| --- | --- |
| `runWarden(app, options?)` | Run all rules and drift checks, return a report |
| `formatWardenReport(report)` | Human-readable report |
| `checkDrift(app)` | Check if the lock file matches the current topo |
| `wardenRules` | Registry of all built-in rules |
| `wardenTopo` | `Topo` of all built-in rule trails (one per rule) |
| `runWardenTrails(filePath, sourceCode, options?)` | Dispatch all rule trails for a file, collect diagnostics |
| `formatGitHubAnnotations(report)` | GitHub Actions annotation format |
| `formatJson(report)` | Machine-readable JSON |
| `formatSummary(report)` | Compact summary line |

See the [API Reference](../../docs/api-reference.md) for the full list.

## Installation

```bash
bun add -d @ontrails/warden
```
