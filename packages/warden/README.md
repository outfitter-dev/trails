# @ontrails/warden

AST-based code convention rules for Trails. Built-in lint rules catch contract
violations at development time, alongside lock drift detection and CI
formatters.

Structural checks (cross target existence, declared resource existence,
recursive crossing, example schema validation) live in `validateTopo()` from
`@ontrails/core`. Warden handles the code-level rules that need AST analysis.

For rule-home boundaries and authoring doctrine, see the
[Warden guide](../../docs/warden.md) and
[Rule Design](../../docs/rule-design.md).

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

Built-in rules are registered in `wardenRules` and `wardenTopoRules`; use those
registries or `wardenTopo.ids()` for the current rule list instead of copying a
static table into docs.

Rules cover several families:

- blaze and `Result` contract checks
- cross, fire, resource, and detour declaration drift
- draft-state containment
- source-static guardrails such as surface-type leakage
- topo-aware checks that need the resolved graph or resource mock shape

When adding or auditing rules, follow [Rule Design](../../docs/rule-design.md):
name the invariant, import owner-held framework data, choose the narrowest
Warden tier, and collapse families only when the data model, traversal, and
diagnostic shape are shared.

## Drift detection

Warden integrates with `@ontrails/schema` to detect when the topo has changed without updating the lock file:

```typescript
import { checkDrift } from '@ontrails/warden';

const drift = await checkDrift(process.cwd(), graph);
if (drift.stale) {
  console.log('lock file is stale -- regenerate with `trails topo compile`');
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

Parser helpers for rule authoring and repo-local tooling live on the dedicated
AST entrypoint:

```typescript
import { findStringLiterals, parse, walk } from '@ontrails/warden/ast';
```

## Trail-based API

Every built-in warden rule is also available as a composable trail. This makes
rules queryable, testable, and invocable through any Trails surface.

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

To wrap a custom rule as a trail, use `wrapRule` (imported from
`@ontrails/warden/trails/wrap-rule`). This is the same factory used internally
to build all built-in rule trails.

## API

| Export | What it does |
| --- | --- |
| `runWarden(options?)` | Run all rules and drift checks, return a report |
| `formatWardenReport(report)` | Human-readable report |
| `checkDrift(rootDir, topo?)` | Check if the lock file matches the current topo |
| `wardenRules` | Registry of all built-in rules |
| `builtinWardenRuleMetadata` | Tier, scope, lifecycle, and invariant metadata for built-in rules |
| `getWardenRuleMetadata(ruleOrName)` | Resolve inline or built-in metadata for a Warden rule |
| `listWardenRuleMetadata()` | List built-in rule metadata entries |
| `wardenTopo` | `Topo` of all built-in rule trails (one per rule) |
| `runWardenTrails(filePath, sourceCode, options?)` | Dispatch file-scoped rule trails for a file, collect diagnostics |
| `runTopoAwareWardenTrails(topo)` | Dispatch built-in topo-aware rule trails once for a resolved topo |
| `formatGitHubAnnotations(report)` | GitHub Actions annotation format |
| `formatJson(report)` | Machine-readable JSON |
| `formatSummary(report)` | Compact summary line |

AST parser helpers are exported from `@ontrails/warden/ast`, not the root
runtime barrel. The stable authoring surface includes `parse`, `walk`,
`walkScope`, `offsetToLine`, `findTrailDefinitions`, `findBlazeBodies`,
`findContourDefinitions`, `isBlazeCall`, and string-literal helpers.

See the [API Reference](../../docs/api-reference.md) for the full list.

## Installation

```bash
bun add -d @ontrails/warden
```
