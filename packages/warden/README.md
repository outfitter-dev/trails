# @ontrails/warden

Governance and contract enforcement for Trails. Lint rules that keep agents (and humans) on trails, surface lock drift detection, and a CLI runner for CI gating.

## Installation

```bash
bun add -d @ontrails/warden
```

Peer dependencies: `@ontrails/core`, `@ontrails/schema`.

## Quick Start

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

## Lint Rules

15 built-in rules under the `trails/` namespace:

| Rule | Severity | What it catches |
| --- | --- | --- |
| `no-throw-in-implementation` | error | `throw` statements inside `implementation` bodies |
| `context-no-surface-types` | error | Surface-specific type imports in trail files |
| `require-output-schema` | warn | MCP/HTTP trails without an `output` schema |
| `prefer-schema-inference` | warn | `fields` overrides that only repeat schema-derived labels or enum options |
| `examples-match-schema` | error | Literal examples missing required keys from `input` or `expected` |
| `follows-matches-calls` | error | Mismatch between `follows` declaration and `ctx.follow()` calls in a hike |
| `no-recursive-follows` | error | Circular `follows` references |
| `follows-trails-exist` | error | Trail IDs in `follows` that do not exist in the topo |
| `valid-describe-refs` | warn | `@see` references inside `.describe()` strings that do not resolve |
| `valid-detour-refs` | error | Detour targets that do not exist in the topo |
| `no-direct-implementation-call` | warn | Direct `.implementation()` calls in application code |
| `no-sync-result-assumption` | error | Missing `await` on `.implementation()` results |
| `implementation-returns-result` | error | Implementations that return raw values instead of `Result` |
| `no-throw-in-detour-target` | error | `throw` inside trails that serve as detour targets |
| `event-origins-exist` | error | Event `from` references that do not exist in the topo |

### Configuration

Add to `.oxlintrc.json`:

```json
{
  "plugins": ["trails"],
  "rules": {
    "trails/no-throw-in-implementation": "error",
    "trails/context-no-surface-types": "error",
    "trails/examples-match-schema": "error",
    "trails/follows-matches-calls": "error",
    "trails/no-recursive-follows": "error",
    "trails/follows-trails-exist": "error",
    "trails/valid-describe-refs": "warn",
    "trails/valid-detour-refs": "error",
    "trails/no-sync-result-assumption": "error",
    "trails/implementation-returns-result": "error",
    "trails/no-throw-in-detour-target": "error",
    "trails/event-origins-exist": "error",
    "trails/require-output-schema": "warn",
    "trails/no-direct-implementation-call": "warn"
  }
}
```

### Key Rules

**`no-throw-in-implementation`** -- Implementations return `Result.err()`, never `throw`. Flags `ThrowStatement` nodes inside `implementation` function bodies.

**`context-no-surface-types`** -- Implementations are pure functions. Importing `Request`, `Response`, `McpSession`, or other surface types couples domain logic to a transport.

**`examples-match-schema`** -- Literal examples should agree with the trail contract. Warden checks required keys on `example.input` and `example.expected`, while `testExamples()` performs the full runtime validation.

**`follows-matches-calls`** -- A hike's `follows` array must match its `ctx.follow()` calls. Undeclared follows are errors; declared-but-unused follows are warnings.

**`prefer-schema-inference`** -- `fields` is for enrichment, not repetition. If a label or enum options are already derivable from the Zod schema, remove the redundant override and let `derive()` supply it.

**`no-direct-implementation-call`** -- Direct `.implementation()` calls bypass validation, tracing, and layers. Application code should use `ctx.follow()` instead.

**`no-sync-result-assumption`** -- Trail implementations normalize to `Promise<Result>`, even when the author wrote a sync body. Callers must `await` before using `.isOk()`, `.value`, or other `Result` APIs.

**`valid-describe-refs`** -- `@see` tags inside schema `.describe()` strings are part of the contract surface. Warden warns when those references drift away from the actual topo.

## Drift Detection

Warden integrates with `@ontrails/schema` to detect when the topo has changed without updating `surface.lock`:

```typescript
import { checkDrift } from '@ontrails/warden';

const drift = await checkDrift(app);
if (drift.stale) {
  console.log(
    'surface.lock is stale -- regenerate with `trails survey generate`'
  );
}
```

The check regenerates the surface map, hashes it, and compares against the committed `surface.lock`.

## CI Integration

Add to lefthook for pre-push enforcement:

```yaml
# lefthook.yml
pre-push:
  commands:
    warden:
      run: trails warden --exit-code
      tags: governance
```

## API

```typescript
import {
  runWarden,
  formatWardenReport,
  checkDrift,
  wardenRules,
} from '@ontrails/warden';
```

## Further Reading

- [Architecture](../../docs/architecture.md)
- [Testing Guide](../../docs/testing.md)
