# Testing

Trails takes a contract-driven approach to testing. Write examples for agent fluency -- get test cases for free.

## The Core Idea

When you add `examples` to a trail, you are writing both agent documentation and a test suite. `testExamples(graph)` runs every example as an assertion. No separate test files for the happy path.

```typescript
const search = trail('search', {
  input: z.object({ query: z.string(), limit: z.number().default(10) }),
  output: z.array(ResultSchema),
  intent: 'read',
  examples: [
    {
      name: 'Basic search',
      input: { query: 'auth' },
      expected: [{ id: '1', content: 'JWT auth' }],
    },
    {
      name: 'Empty result',
      input: { query: 'nonexistent' },
      expected: [],
    },
  ],
  blaze: searchImpl,
});
```

Those examples serve six consumers at once:

| Consumer               | What it does                            |
| ---------------------- | --------------------------------------- |
| `testExamples(graph)` | Runs every example as a test            |
| Agents (via MCP)       | Learns input/result shapes by example   |
| Agents (via survey)    | Sees what the trail does with real data |
| Guide                  | Generates usage documentation           |
| MCP apps               | Pre-fills forms with example inputs     |
| Warden                 | Verifies examples parse against schemas |

## TDD Workflow

Red -> Green -> Refactor, with examples as the starting point:

1. **Define the trail** with input schema, output schema, and examples
2. **Run tests** -- examples fail because there is no implementation yet (red)
3. **Implement** until examples pass (green)
4. **Refactor** while tests stay green
5. **Add edge-case tests** with `testTrail()` for scenarios that should not appear in agent-facing examples

## `testAll(graph)`

One line runs the full governance suite -- structural validation, example execution, contract checks, and detour verification:

```typescript
import { testAll } from '@ontrails/testing';
import { graph } from '../app';

testAll(graph);
```

When trails declare resources, the testing helpers respect them in two ways:

- Resources with a `mock` factory auto-resolve during `testAll`, `testExamples`, and `testContracts`.
- Explicit `resources` overrides let you inject a specific test double when you need one.

```typescript
import { resource, Result } from '@ontrails/core';
import { testAll } from '@ontrails/testing';
import { graph } from '../app';

const db = resource('db.main', {
  create: () => Result.ok(connectToDatabase()),
  mock: () => createInMemoryDb(),
});

// `db` must be part of `graph`'s topo for auto-resolution to work.
testAll(graph); // auto-resolves db.main from db.mock()

testAll(graph, () => ({
  resources: { 'db.main': createInMemoryDb() },
}));
```

Pass a factory when your explicit overrides contain mutable state, so each test gets a fresh instance.

Generates a `governance` describe block containing:

- **Topo validation** via `validateTopo` (crosses exist, no recursive crossing, event origins, example schema validation, output schema presence)
- **Example execution** via `testExamples`
- **Contract checks** via `testContracts`
- **Detour verification** via `testDetours`

For most apps, `testAll` is the only test call you need. Reach for the individual helpers below when you need finer control.

## `testExamples(graph)`

One line tests the entire app:

```typescript
import { testExamples } from '@ontrails/testing';
import { graph } from '../app';

testExamples(graph);
```

For each trail with examples, generates a `describe` block with individual `test` calls:

```text
describe("entity.show") {
  test("example: Show entity by name") { ... }
  test("example: Entity not found returns NotFoundError") { ... }
}
describe("search") {
  test("example: Basic search") { ... }
}
```

Trails with no examples produce no tests -- they simply do not participate in example-driven testing.

The implementation is always awaited at runtime, so `testExamples()` behaves the same for sync-authored and async-authored trails.

## Progressive Assertion

What `testExamples` checks depends on what the example declares:

### Full Match

Example has an `expected` field:

```typescript
examples: [
  {
    name: 'Found',
    input: { name: 'Alpha' },
    expected: { name: 'Alpha', type: 'concept' },
  },
];
```

Asserts `result.isOk()` and `result.value` deep-equals `expected`.

### Partial Match

Example has `expectedMatch` — asserts the output contains the declared fields with matching values, ignoring extra keys. Ideal for composite trails where some output fields are generated or unpredictable:

```typescript
examples: [
  {
    name: 'Fork preserves content',
    input: { id: 'g1' },
    expectedMatch: {
      content: '# Hello',
      forkedFrom: 'g1',
    },
    // id, createdAt, etc. are NOT asserted — they're generated
  },
];
```

Asserts `result.isOk()` and that `result.value` is a superset of `expectedMatch`. Scalars match strictly, objects match recursively (extra keys ignored), arrays match as order-independent subsets.

### Schema-Only Match

Example has no `expected`, no `expectedMatch`, and no `error`:

```typescript
examples: [{ name: 'Returns something valid', input: { name: 'Alpha' } }];
```

Asserts `result.isOk()` and, if the trail has an `output` schema, validates `result.value` against it.

### Error Match

Example has `error`:

```typescript
examples: [
  {
    name: 'Not found',
    input: { name: 'missing' },
    error: 'NotFoundError',
  },
];
```

Asserts `result.isErr()` and `result.error instanceof NotFoundError`.

## `testTrail(trail, scenarios)`

For edge cases, boundary values, and regression tests that do not belong in agent-facing examples:

```typescript
import { testTrail } from '@ontrails/testing';

testTrail(showTrail, [
  { description: 'empty name returns ok', input: { name: '' }, expectOk: true },
  {
    description: 'missing name fails validation',
    input: {},
    expectErr: ValidationError,
  },
  {
    description: 'exact match',
    input: { name: 'Alpha' },
    expectValue: { name: 'Alpha', type: 'concept' },
  },
  {
    description: 'error message check',
    input: { name: 'missing' },
    expectErr: NotFoundError,
    expectErrMessage: 'not found',
  },
]);
```

For trails with `crosses`, use `testTrail` the same way -- it exercises the crossing graph and verifies that upstream failures propagate correctly:

```typescript
import { testTrail } from '@ontrails/testing';

testTrail(onboardTrail, [
  {
    description: 'successful onboard',
    input: { name: 'Delta', type: 'tool' },
    expectOk: true,
  },
  {
    description: 'fails when add fails',
    input: { name: 'Alpha' },
    expectErr: AlreadyExistsError,
  },
]);
```

## `testContracts(graph)`

Catches implementation-schema drift. Runs every example through the implementation, then validates the result against the trail's `output` schema. Reports detailed Zod errors on mismatch.

```typescript
import { testContracts } from '@ontrails/testing';

testContracts(graph);
// Fails if any implementation returns data that doesn't match its declared output schema
```

TypeScript checks types at compile time, but the implementation could return `{ name: "foo" }` when the output schema says `{ title: string }`. `testContracts` catches this at runtime.

## `testDetours(graph)`

Structural validation. Verifies every detour target trail exists in the topo. No implementation execution needed.

```typescript
import { testDetours } from '@ontrails/testing';

testDetours(graph);
// Fails: Trail "entity.show" has detour target "entity.search" which does not exist in the topo
```

## `scenario(name, graph, steps)`

Multi-step journey testing for flows that span multiple trail invocations. Scenarios live in test files alongside `testAll` — they test how trails compose, not what individual trails do.

```typescript
import { ref, scenario } from '@ontrails/testing';

scenario('Fork flow', graph, [
  {
    cross: createGist,
    input: { description: 'Original', content: '# Hello' },
    as: 'original',
  },
  {
    cross: forkGist,
    input: { id: ref('original.id') },
    as: 'forked',
    expectedMatch: {
      content: '# Hello',
      forkedFrom: ref('original.id'),
    },
  },
]);
```

Each step executes through the normal pipeline (validation, layers, resources, tracing). `ref()` resolves cross-step references from prior step outputs. If a step fails, the scenario reports which step and why.

`expectedMatch` on steps uses the same subset matching as trail examples. `expected` is also supported for exact matching.

## Test Context and Mocks

### `createTestContext(overrides?)`

Creates a `TrailContext` with sensible test defaults:

```typescript
import { createTestContext } from '@ontrails/testing';

const ctx = createTestContext({
  requestId: 'test-001',
  env: { TRAILS_ENV: 'test' },
});
```

Defaults: deterministic request ID, test logger (captures entries), a non-aborted `abortSignal`.

If you need a resource override at the context level, pass it through `resources` to `testAll()` / `testExamples()` / `testContracts()`, or attach it to `extensions` under the resource ID when calling a single trail helper like `testTrail()`. `testTrail()` accepts a raw context object, so resource injection there bypasses the normal pipeline resolution step and goes directly through `extensions`.

### `createCrossContext(options?)`

Creates a mock `CrossFn` for testing composite trails that call `ctx.cross()`. Pre-configure responses per trail ID:

```typescript
import { createCrossContext, createTestContext } from '@ontrails/testing';
import { Result } from '@ontrails/core';

const cross = createCrossContext({
  responses: {
    'user.get': Result.ok({ name: 'Alice' }),
    'user.validate': Result.ok({ valid: true }),
  },
});

const ctx = { ...createTestContext(), cross };
const result = await onboardTrail.blaze({ name: 'Delta' }, ctx);

expect(result.isOk()).toBe(true);
```

Calls to unregistered trail IDs return an error Result. If you need real execution instead of mocked responses, use `run()` from `@ontrails/core`.

### `createTestLogger()`

A logger that captures entries in memory:

```typescript
import { createTestLogger } from '@ontrails/testing';

const logger = createTestLogger();
// ...run some code that logs...

logger.assertLogged('info', 'Entity created'); // passes if any entry matches
logger.entries; // all captured records
logger.clear(); // reset
```

## Surface Harnesses

### CLI Harness

Execute CLI commands in-process and capture stdout/stderr:

```typescript
import { createCliHarness } from '@ontrails/testing';

const harness = createCliHarness({ graph });
const result = await harness.run('entity show --name Alpha --output json');

expect(result.exitCode).toBe(0);
expect(result.json).toMatchObject({ name: 'Alpha' });
```

### MCP Harness

Invoke MCP tools directly without transport:

```typescript
import { createMcpHarness } from '@ontrails/testing';

const harness = createMcpHarness({ graph });
const result = await harness.callTool('myapp_entity_show', { name: 'Alpha' });

expect(result.isError).toBe(false);
```

## Testing with Infrastructure Resources

The config, permits, and tracing packages each provide test-friendly primitives that work with `testAll(graph)` and `testExamples(graph)` without external dependencies.

**Config test profile.** Use `defineConfig()` with a `test` profile that uses safe defaults (port 0, debug enabled, in-memory stores). When the `TRAILS_ENV` environment variable is set to `test`, the test profile is selected automatically during resolution. Services with `config` schemas receive the test profile values through `svc.config`.

**Synthetic permit creation.** `createTestPermit()` creates a `Permit` with exactly the scopes you specify -- no admin privileges, no wildcards. `createPermitForTrail()` reads a trail's `permit` declaration and creates a permit with exactly the declared scopes, so tests exercise the real authorization path without a running auth provider:

```typescript
import { createTestPermit, createPermitForTrail } from '@ontrails/permits';

const permit = createTestPermit({ scopes: ['entity:read'] });
const trailPermit = createPermitForTrail(showTrail);
```

**Tracing memory sink.** Tracing is intrinsic to `executeTrail` — every trail execution produces a `TraceRecord` automatically. Register `createMemorySink()` to capture records in memory for assertion:

```typescript
import { createMemorySink, registerTraceSink, clearTraceSink } from '@ontrails/tracing';

const sink = createMemorySink();
registerTraceSink(sink);
try {
  // ...run trails...
  expect(sink.records).toHaveLength(1);
} finally {
  clearTraceSink();
}
```

## Recommended Test Structure

```text
src/
  trails/
    entity.ts          # Trail definitions with examples
    search.ts
  __tests__/
    governance.test.ts # testAll(graph) -- full governance suite
    entity.test.ts     # testTrail(show, [...]) -- edge cases
    cli.test.ts        # CLI harness integration tests
    mcp.test.ts        # MCP harness integration tests
```

The examples on trails cover the happy path. Test files cover edge cases, error paths, and integration scenarios.
