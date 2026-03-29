# Testing Patterns Reference

## `testAll(app)` -- One-Liner Governance Suite

Runs topo validation + example execution + contract checks + detour verification in a single `describe('governance')` block.

```typescript
import { testAll } from '@ontrails/testing';
import { app } from '../src/app.js';

testAll(app);
```

With mutable state, pass a factory to get a fresh context per test:

```typescript
testAll(app, () => ({
  store: createStore([
    { name: 'Alpha', tags: ['core'], type: 'concept' },
  ]),
}));
```

## `testExamples(app)` -- Example Assertions

Runs every trail's examples with progressive assertion. For trails with `follow`, also verifies every declared follow ID was called. Accepts the same `ctxOrFactory` second arg as `testAll`.

```typescript
testExamples(app);
```

## `testTrail(trail, scenarios)` -- Edge Cases

Test individual trails with custom scenarios. Use for boundary values, error paths, and regressions that don't belong in agent-facing examples.

```typescript
import { NotFoundError, AlreadyExistsError, ValidationError } from '@ontrails/core';
import { testTrail } from '@ontrails/testing';
import { show, add } from '../src/trails/entity.js';

testTrail(show, [
  {
    description: 'Case sensitivity -- exact name required',
    input: { name: 'alpha' },
    expectErr: NotFoundError,
  },
  {
    description: 'Missing required field',
    input: {},
    expectErr: ValidationError,
    expectErrMessage: 'Required',
  },
], { store });
```

### Scenario Assertions

| Field | Behavior |
|-------|----------|
| `expectOk: true` | Asserts `result.isOk()` and validates against output schema |
| `expectValue: { sum: 3 }` | Deep-equals the result value |
| `expectErr: NotFoundError` | Asserts `result.isErr()` and error is instanceof |
| `expectErrMessage: "not found"` | Asserts error message contains substring |

## `testTrail` for Composition -- Follow Chain Testing

`testTrail` also works for trails with `follow`, tracking follow chains and supporting failure injection.

```typescript
import { testTrail } from '@ontrails/testing';
import { onboardTrail } from '../src/trails/onboard.js';

testTrail(onboardTrail, [
  {
    description: 'follows add then relate',
    input: { name: 'Alpha' },
    expectOk: true,
    expectFollowed: ['entity.add', 'entity.relate'],
  },
  {
    description: 'counts follow calls',
    input: { name: 'Beta' },
    expectOk: true,
    expectFollowedCount: { 'entity.add': 1, 'entity.relate': 2 },
  },
  {
    description: 'handles downstream failure',
    input: { name: 'Gamma' },
    injectFromExample: { 'entity.add': 'Duplicate name' },
    expectErr: AlreadyExistsError,
  },
]);
```

Composition-specific fields: `expectFollowed` (ordered trail IDs), `expectFollowedCount` (counts per ID), `injectFromExample` (inject error from a followed trail's error example by name). Pass `options.trails` map to enable injection lookups.

## `testContracts(app)` / `testDetours(app)`

`testContracts` verifies every trail's implementation output matches its declared output schema -- catches drift. `testDetours` checks that every detour target references a trail that exists in the topo. Both are included in `testAll` automatically; use standalone when debugging a specific failure.

```typescript
import { testContracts, testDetours } from '@ontrails/testing';
testContracts(app);  // schema drift detection
testDetours(app);    // structural detour validation
```

## Progressive Assertion Modes

Applied automatically per example based on which fields are present:

```typescript
// Full match -- `expected` triggers deep equals
{ name: 'Add', input: { a: 1, b: 2 }, expected: { sum: 3 } }

// Schema-only -- no `expected` or `error`, validates against output schema
{ name: 'List entities', input: { type: 'concept' } }

// Error match -- `error` string matches class name from core taxonomy
{ name: 'Not found', input: { name: 'nope' }, error: 'NotFoundError' }
```

Error class names: `ValidationError`, `NotFoundError`, `AlreadyExistsError`, `ConflictError`, `AuthError`, `PermissionError`, `TimeoutError`, `NetworkError`, `RateLimitError`, `InternalError`, `AmbiguousError`, `CancelledError`, `AssertionError`.

## Test Context

```typescript
import { createTestContext, createTestLogger } from '@ontrails/testing';

const ctx = createTestContext();
// ctx.requestId = 'test-request-001', ctx.env = { TRAILS_ENV: 'test' }

const logger = createTestLogger();
logger.info('seeded store', { count: 3 });
logger.assertLogged('info', 'seeded store');
logger.find(r => r.level === 'error'); // filtered entries
logger.clear(); // reset captured entries
```

## Surface Harnesses

### CLI Harness

```typescript
import { createCliHarness } from '@ontrails/testing';

const cli = createCliHarness({ app });
const result = await cli.run('entity show --name Alpha --output json');
expect(result.exitCode).toBe(0);
expect(result.json).toEqual({ name: 'Alpha', type: 'concept' });
```

`CliHarnessResult`: `exitCode`, `stdout`, `stderr`, `json` (parsed if `--output json`).

### MCP Harness

```typescript
import { createMcpHarness } from '@ontrails/testing';

const mcp = createMcpHarness({ app });
const result = await mcp.callTool('myapp_entity_show', { name: 'Alpha' });
expect(result.isError).toBe(false);
```

`McpHarnessResult`: `content`, `isError`.

## Recommended Test Structure

```text
src/__tests__/
  governance.test.ts    # testAll(app) -- the one-liner
  entity.test.ts        # testTrail edge cases per domain
  onboard.test.ts       # testTrail composition scenarios
  cli.test.ts           # CLI harness integration
  mcp.test.ts           # MCP harness integration
```

- `governance.test.ts` is the minimum. One file, one line, full coverage of examples and contracts.
- Add `*.test.ts` files per domain when edge cases accumulate beyond what examples cover.
- Surface harness tests are optional but valuable for verifying flag parsing, output formatting, and tool naming.
