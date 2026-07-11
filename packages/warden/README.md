# @ontrails/warden

AST-based code convention rules for Trails. Built-in lint rules catch contract violations at development time, alongside lock drift detection and CI formatters.

Structural checks (compose target existence, declared resource existence, recursive composition, example schema validation) live in `validateTopo()` from `@ontrails/core`. Warden handles the code-level rules that need AST analysis.

For rule-home boundaries and authoring doctrine, see the [Warden guide](../../docs/warden.md) and [Warden Rules](../../docs/contributing/warden-rules.md).

## Usage

From the Trails CLI:

```bash
bunx trails warden # Run all checks
```

Or programmatically:

```typescript
import { runWarden, formatWardenReport } from '@ontrails/warden';

const report = await runWarden({ topo: graph });
console.log(formatWardenReport(report));
```

## Rules

Built-in rules are registered in `wardenRules` and `wardenTopoRules`; use those registries or `wardenTopo.ids()` for the current rule list instead of copying a static table into docs.

Rules cover several families:

- implementation and `Result` contract checks
- compose, fire, resource, and detour declaration drift
- draft-state containment
- source-static guardrails such as surface-type leakage
- topo-aware checks that need the resolved graph or resource mock shape

When adding or auditing rules, follow [Warden Rules](../../docs/contributing/warden-rules.md): name the invariant, import owner-held framework data, choose the narrowest Warden tier, and collapse families only when the data model, traversal, and diagnostic shape are shared.

## Project-local rules

Projects can carry local Warden rules in `.trails/rules.ts` or direct `.trails/rules/*.ts` files. `runWarden()` and `trails warden` load those files by default for lint runs, then run those rules alongside the built-in registries. Drift-only runs do not import project-local rule modules. Embedders that need only built-in or explicitly provided rules can pass `projectRules: false`.

Warden does not recursively discover nested `.trails/rules` files. Use nested files as private helpers and re-export from a direct entrypoint when a local rule grows. Rule ids must be unique across every project-local module. The retired `trails/warden/rules` location reports a migration diagnostic instead of loading.

Warden uses the shared Trails project-root resolver when a caller does not pass `rootDir` or `--root-dir`, so commands launched from nested directories still load the nearest root `trails.config.*` and its `.trails/rules*` files. An explicit root always wins over discovery.

This is the right home for repo-specific migration checks or governance that has not earned a place in `@ontrails/warden` itself.

## Scope

Use `warden.scope.exclude` in `trails.config.*` to keep generated, scratch, or local planning paths outside Warden governance while leaving durable project paths in scope.

```json
{
  "warden": {
    "scope": {
      "exclude": [".scratch/**", ".agents/notes/**"]
    }
  }
}
```

For a single run, pass one or more root-relative globs:

```bash
warden --scope-exclude '.scratch/**' --scope-exclude '.agents/notes/**'
```

Scope is a governance boundary, not a migration scan boundary. Regrade uses its own `scope.exclude` / `--exclude` controls for migration plans.

A rule module may export `rule`, `rules`, `sourceRule`, `sourceRules`, `topoRule`, or `topoRules`. Rules without explicit metadata receive default repo-local source-static or topo-aware metadata so short migration rules can run without extra ceremony. Project-aware source rules that provide `checkWithContext()` default to repo-local project-static metadata.

```typescript
export const rule = {
  name: 'local-contract-check',
  severity: 'error',
  description: 'Local contract examples keep their migration marker.',
  check(sourceCode, filePath) {
    return sourceCode.includes('deprecatedMarker')
      ? [
          {
            filePath,
            line: 1,
            message: 'Replace deprecatedMarker before release.',
            rule: 'local-contract-check',
            severity: 'error',
          },
        ]
      : [];
  },
};
```

## Drift detection

Warden integrates with `@ontrails/topographer` to detect when the topo has changed without updating the lock file:

```typescript
import { checkDrift } from '@ontrails/warden';

const drift = await checkDrift(process.cwd(), graph);
if (drift.stale) {
  console.log('lock file is stale -- regenerate with `trails compile`');
}
```

## CI integration

Add to lefthook for pre-push enforcement:

```yaml
pre-push:
  commands:
    warden:
      run: bunx trails warden
      tags: governance
```

CI formatters for structured output:

```typescript
import {
  formatGitHubAnnotations,
  formatJson,
  formatSummary,
} from '@ontrails/warden';
```

Parser helpers for rule authoring and repo-local tooling live on the dedicated AST entrypoint:

```typescript
import { findStringLiterals, parse, walk } from '@ontrails/warden/ast';
```

## Trail-based API

Every built-in warden rule is also available as a composable trail. This makes rules queryable, testable, and invocable through any Trails surface.

```typescript
import {
  runTopoAwareWardenTrails,
  runWardenTrails,
  wardenTopo,
} from '@ontrails/warden';

// Inspect the warden rule trails
console.log(wardenTopo.ids()); // ['warden.rule.no-throw-in-implementation', ...]

// Run all rule trails against a source file
const diagnostics = await runWardenTrails(filePath, sourceCode, {
  knownTrailIds: myApp.ids(),
  knownResourceIds: myApp.resourceIds(),
});

// Run built-in topo-aware rule trails once against the resolved graph
const topoDiagnostics = await runTopoAwareWardenTrails(myApp);
```

To wrap a custom rule as a trail, import `wrapRule` from the root package entrypoint:

```typescript
import { wrapRule } from '@ontrails/warden';
```

This is the same factory used internally to build all built-in rule trails.

## API

| Export | What it does |
| --- | --- |
| `runWarden(options?)` | Run all rules and drift checks, return a report |
| `formatWardenReport(report)` | Human-readable report |
| `checkDrift(rootDir, topo?, options?)` | Check if the lock file matches the current topo; pass `{ overlays }` from the app module so the comparison graph carries the overlay content compile embeds. Stale results name `driftedOverlayNamespaces` when overlays diverge |
| `wardenRules` | Registry of all built-in rules |
| `builtinWardenRuleMetadata` | Tier, scope, lifecycle, and invariant metadata for built-in rules |
| `getWardenRuleMetadata(ruleOrName)` | Resolve inline or built-in metadata for a Warden rule |
| `listWardenRuleMetadata()` | List built-in rule metadata entries |
| `wardenTopo` | `Topo` of all built-in rule trails (one per rule) |
| `runWardenTrails(filePath, sourceCode, options?)` | Dispatch file-scoped rule trails for a file, collect diagnostics |
| `runTopoAwareWardenTrails(topo)` | Dispatch built-in topo-aware rule trails once for a resolved topo |
| `loadProjectWardenRules(rootDir)` | Load rule modules from `.trails/rules.ts` or direct `.trails/rules/*.ts` children |
| `formatGitHubAnnotations(report)` | GitHub Actions annotation format |
| `formatJson(report)` | Machine-readable JSON |
| `formatSummary(report)` | Compact summary line |
| `wrapRule(rule)` | Wrap a custom rule as a trail (same factory used for all built-in rule trails) |

AST parser helpers are exported from `@ontrails/warden/ast`, not the root runtime barrel. The stable authoring surface includes `parse`, `walk`, `walkScope`, `walkWithParents`, `walkWithScopeContext`, `offsetToLine`, `offsetToLineColumn`, source-edit helpers, `findTrailDefinitions`, `findImplementationBodies`, `findContourDefinitions`, `isImplementationCall`, and string-literal helpers.

`runWarden({ tier })` can narrow a run to `source-static`, `project-static`, `topo-aware`, `drift`, or `advisory`. Omit `tier` for the default full run.

See the [API Reference](../../docs/api-reference.md) for the full list.

## Installation

```bash
bun add -d @ontrails/warden
```
