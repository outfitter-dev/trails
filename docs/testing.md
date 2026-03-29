# Testing

Trails takes a contract-driven approach to testing. Write examples for agent fluency -- get test cases for free.

## The Core Idea

When you add `examples` to a trail, you are writing both agent documentation and a test suite. `testExamples(app)` runs every example as an assertion. No separate test files for the happy path.

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
  run: searchImpl,
});
```

Those examples serve six consumers at once:

| Consumer               | What it does                            |
| ---------------------- | --------------------------------------- |
| `testExamples(app)` | Runs every example as a test            |
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

## `testAll(app)`

One line runs the full governance suite -- structural validation, example execution, contract checks, and detour verification:

```typescript
import { testAll } from '@ontrails/testing';
import { app } from '../app';

testAll(app);
```

Generates a `governance` describe block containing:

- **Topo validation** via `validateTopo` (follow targets exist, no recursive follow, event origins, example schema validation, output schema presence)
- **Example execution** via `testExamples`
- **Contract checks** via `testContracts`
- **Detour verification** via `testDetours`

For most apps, `testAll` is the only test call you need. Reach for the individual helpers below when you need finer control.

## `testExamples(app)`

One line tests the entire app:

```typescript
import { testExamples } from '@ontrails/testing';
import { app } from '../app';

testExamples(app);
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

### Schema-Only Match

Example has no `expected` and no `error`:

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

For trails with `follow`, use `testTrail` the same way -- it exercises the follow graph and verifies that upstream failures propagate correctly:

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

## `testContracts(app)`

Catches implementation-schema drift. Runs every example through the implementation, then validates the result against the trail's `output` schema. Reports detailed Zod errors on mismatch.

```typescript
import { testContracts } from '@ontrails/testing';

testContracts(app);
// Fails if any implementation returns data that doesn't match its declared output schema
```

TypeScript checks types at compile time, but the implementation could return `{ name: "foo" }` when the output schema says `{ title: string }`. `testContracts` catches this at runtime.

## `testDetours(app)`

Structural validation. Verifies every detour target trail exists in the topo. No implementation execution needed.

```typescript
import { testDetours } from '@ontrails/testing';

testDetours(app);
// Fails: Trail "entity.show" has detour target "entity.search" which does not exist in the topo
```

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

Defaults: deterministic request ID, test logger (captures entries), non-aborted signal.

### `createFollowContext(options?)`

Creates a mock `FollowFn` for testing composite trails that call `ctx.follow()`. Pre-configure responses per trail ID:

```typescript
import { createFollowContext, createTestContext } from '@ontrails/testing';
import { Result } from '@ontrails/core';

const follow = createFollowContext({
  responses: {
    'user.get': Result.ok({ name: 'Alice' }),
    'user.validate': Result.ok({ valid: true }),
  },
});

const ctx = { ...createTestContext(), follow };
const result = await onboardTrail.run({ name: 'Delta' }, ctx);

expect(result.isOk()).toBe(true);
```

Calls to unregistered trail IDs return an error Result. If you need real execution instead of mocked responses, use `dispatch()` from `@ontrails/core`.

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

const harness = createCliHarness({ app });
const result = await harness.run('entity show --name Alpha --output json');

expect(result.exitCode).toBe(0);
expect(result.json).toMatchObject({ name: 'Alpha' });
```

### MCP Harness

Invoke MCP tools directly without transport:

```typescript
import { createMcpHarness } from '@ontrails/testing';

const harness = createMcpHarness({ app });
const result = await harness.callTool('myapp_entity_show', { name: 'Alpha' });

expect(result.isError).toBe(false);
```

## Recommended Test Structure

```text
src/
  trails/
    entity.ts          # Trail definitions with examples
    search.ts
  __tests__/
    governance.test.ts # testAll(app) -- full governance suite
    entity.test.ts     # testTrail(show, [...]) -- edge cases
    cli.test.ts        # CLI harness integration tests
    mcp.test.ts        # MCP harness integration tests
```

The examples on trails cover the happy path. Test files cover edge cases, error paths, and integration scenarios.
