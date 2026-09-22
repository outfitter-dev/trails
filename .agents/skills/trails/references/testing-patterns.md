# Testing Patterns Reference

## `testAll(graph)` -- One-Liner Contract Suite

Runs topo validation + example execution + contract checks + detour verification in a single `describe('contract')` block.

```typescript
import { testAll } from '@ontrails/testing';
import { graph } from '../src/app.js';

testAll(graph);
```

With mutable state, pass a factory to get a fresh context per test:

```typescript
testAll(graph, () => ({
  resources: {
    'store.main': createStore([
      { name: 'Alpha', tags: ['core'], type: 'concept' },
    ]),
  },
}));
```

## `testExamples(graph)` -- Example Assertions

Runs every trail's examples with progressive assertion. Accepts the same `ctxOrFactory` second arg as `testAll`.

```typescript
testExamples(graph);
```

## `testTrail(trail, scenarios)` -- Edge Cases

Test individual trails with custom scenarios. Use for boundary values, error paths, and regressions that don't belong in agent-facing examples.

```typescript
import { NotFoundError, ValidationError } from '@ontrails/core';
import { testTrail } from '@ontrails/testing';
import { show } from '../src/trails/entity.js';

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
], {
  resources: { 'store.main': testStore },
});
```

### Scenario Assertions

| Field | Behavior |
|-------|----------|
| `expectOk: true` | Asserts `result.isOk()` and validates against output schema |
| `expectValue: { sum: 3 }` | Deep-equals the result value |
| `expectErr: NotFoundError` | Asserts `result.isErr()` and error is instanceof |
| `expectErrMessage: "not found"` | Asserts error message contains substring |

## `testComposes` for Composition Chain Testing

Use `testComposes` for trails with `composes`, tracking composition chains and supporting failure injection.

```typescript
import { AlreadyExistsError } from '@ontrails/core';
import { testComposes } from '@ontrails/testing';
import { onboardTrail } from '../src/trails/onboard.js';
import { graph } from '../src/app.js';

testComposes(onboardTrail, [
  {
    description: 'composes add then relate',
    input: { name: 'Alpha' },
    expectOk: true,
    expectComposed: ['entity.add', 'entity.relate'],
  },
  {
    description: 'counts compose calls',
    input: { name: 'Beta' },
    expectOk: true,
    expectComposedCount: { 'entity.add': 1, 'entity.relate': 2 },
  },
  {
    description: 'handles downstream failure',
    input: { name: 'Gamma' },
    injectFromExample: { 'entity.add': 'Duplicate name' },
    expectErr: AlreadyExistsError,
  },
], { trails: graph.trails });
```

Composition-specific fields: `expectComposed` (ordered trail IDs), `expectComposedCount` (counts per ID), `injectFromExample` (inject error from a composed trail's error example by name). Pass `options.trails` map to enable injection lookups.

## `testContracts(graph)` / `testDetours(graph)`

`testContracts` verifies successful trail results against declared output schemas -- catches drift. `testDetours` validates detour constructor, `recover`, and shadowing semantics. Both are included in `testAll` automatically; use standalone when debugging a specific failure.

```typescript
import { testContracts, testDetours } from '@ontrails/testing';
testContracts(graph);  // schema drift detection
testDetours(graph);    // detour contract validation
```

## Resource Mocking

Resources with a `mock` factory auto-resolve during `testAll`, `testExamples`, and `testContracts` — no configuration needed.

```typescript
// Zero-config: mock factories on resource definitions are used automatically
testAll(graph);
```

Override explicitly when you need specific behavior:

```typescript
testAll(graph, () => ({
  resources: { 'db.main': createSpecialTestDb() },
}));
```

Pass a factory (the `() => ({...})` form) when overrides contain mutable state. This gives each test a fresh instance and prevents test pollution from shared in-memory stores.

The same override mechanism works with `run()`:

```typescript
run(graph, 'search', input, {
  resources: { 'db.main': testDb },
});
```

If a resource definition omits `mock`, `testAll` requires an explicit override for any trail that uses it. Define `mock` on resource definitions to keep the zero-config `testAll(graph)` promise. When a dependency cannot be mocked safely, mark it with `unmockable: { reason }`; testing helpers skip auto-mock resolution for that resource and require explicit overrides for examples or contracts that need it.

## Progressive Assertion Modes

Applied automatically per example based on which fields are present:

```typescript
// Full match -- `expected` triggers deep equals
{ name: 'Add', input: { a: 1, b: 2 }, expected: { sum: 3 } }

// Partial match -- `expectedMatch` asserts a subset and ignores generated fields
{ name: 'Create', input: { name: 'Alpha' }, expectedMatch: { name: 'Alpha' } }

// Schema-only -- no `expected`, `expectedMatch`, or `error`, validates against output schema
{ name: 'List entities', input: { type: 'concept' } }

// Error match -- `error` string matches class name from core taxonomy
{ name: 'Not found', input: { name: 'nope' }, error: 'NotFoundError' }
```

Error class names: `ValidationError`, `AmbiguousError`, `NotFoundError`, `VersionNotSupportedError`, `AlreadyExistsError`, `ConflictError`, `AuthError`, `PermissionError`, `PermitError`, `TimeoutError`, `NetworkError`, `RateLimitError`, `InternalError`, `DerivationError`, `RecoverableCompletionError`, `AssertionError`, `CancelledError`, `RetryExhaustedError`.

## `createComposeContext()` -- Mock Compose for Composite Trails

When unit-testing a composite trail in isolation (without a full topo), use `createComposeContext()` to provide preconfigured `Result` responses for each `ctx.compose()` call:

```typescript
import { Result } from '@ontrails/core';
import { createComposeContext, testTrail } from '@ontrails/testing';

const compose = createComposeContext({
  responses: {
    'entity.add': Result.ok({ id: '1', name: 'Alpha' }),
    'entity.relate': Result.ok({ linked: true }),
  },
});

testTrail(onboardTrail, [
  {
    description: 'uses mocked composes',
    input: { name: 'Alpha' },
    expectOk: true,
  },
], { compose });
```

Calls to IDs not registered in `responses` return `Result.err` with a descriptive message, making missing mocks visible immediately.

## `run()` -- Headless Testing Against a Topo

For integration-style tests that verify the full pipeline (validation, layers, and the trail implementation) without opening a surface, use `run()` from `@ontrails/core`:

```typescript
import { run } from '@ontrails/core';
import { graph } from '../src/app.js';

const result = await run(graph, 'entity.show', { name: 'Alpha' });
expect(result.isOk()).toBe(true);
```

`run()` returns `Result.err(NotFoundError)` if the trail ID is not in the topo, making it useful for verifying topo completeness as well.

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

Surface harnesses are opt-in subpaths. Keep root `@ontrails/testing` for contract helpers; import surface helpers from the subpath for the peer package you are exercising.

### CLI Harness

```typescript
import { createCliHarness } from '@ontrails/testing/cli';

const cli = createCliHarness({ graph });
const result = await cli.run('entity show --name Alpha --output json');
expect(result.exitCode).toBe(0);
expect(result.json).toEqual({ name: 'Alpha', type: 'concept' });
```

`CliHarnessResult`: `exitCode`, `stdout`, `stderr`, `json` (parsed if `--output json`).

### MCP Harness

```typescript
import { createMcpHarness } from '@ontrails/testing/mcp';

const mcp = createMcpHarness({ graph });
const result = await mcp.callTool('myapp_entity_show', { name: 'Alpha' });
expect(result.isError).toBe(false);
```

`McpHarnessResult`: `content`, `isError`.

### HTTP Harness

```typescript
import { createHttpHarness } from '@ontrails/testing/http';

const http = createHttpHarness({ graph });
const response = await http.get('/entity/show', { name: 'Alpha' });
expect(response.status).toBe(200);
expect(response.data).toEqual({ name: 'Alpha', type: 'concept' });
```

The HTTP harness runs derived routes in-process; it does not open a network port.

## Surface Parity

`testSurfaceParity()` runs eligible examples through CLI, MCP, and HTTP and compares normalized success payloads and normalized TrailsError category/code pairs.

```typescript
import { testSurfaceParity } from '@ontrails/testing/surface-parity';

testSurfaceParity(graph, {
  exclusions: [
    {
      example: 'generates unique id',
      reason: 'generated values intentionally differ per surface run',
      trailId: 'entity.add',
    },
  ],
});
```

Use `@ontrails/testing/established` for `testAllEstablished()` when an established app should run root contract checks plus CLI, MCP, and HTTP rendering validation in one call.

## Recommended Test Structure

```text
src/__tests__/
  contract.test.ts      # testAll(graph) -- the one-liner
  entity.test.ts        # testTrail edge cases per domain
  onboard.test.ts       # testComposes composition scenarios
  cli.test.ts           # CLI harness integration
  mcp.test.ts           # MCP harness integration
  http.test.ts          # HTTP harness integration
  surface-parity.test.ts # optional cross-surface example parity
```

- `contract.test.ts` is the minimum. One file, one line, full coverage of examples and contracts.
- Add `*.test.ts` files per domain when edge cases accumulate beyond what examples cover.
- Surface harness tests are optional but valuable for verifying flag parsing, output formatting, tool naming, route derivation, and cross-surface parity.
