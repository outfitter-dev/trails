# @ontrails/testing

Contract-driven testing utilities for Trails. Write examples for agent fluency -- get test cases for free.

## Installation

```bash
bun add -d @ontrails/testing
```

Peer dependencies: `@ontrails/core`, `@ontrails/cli`, `@ontrails/mcp`, `@ontrails/logging`, `zod`.

## Quick Start

```typescript
import { testExamples } from '@ontrails/testing';
import { app } from '../app';

testExamples(app);
```

One line. The entire topo is tested. Every trail, every example: input validation, implementation execution, output verification.

```
 PASS  src/__tests__/app.test.ts
  greet
    example: Basic greeting
    example: Loud greeting
  entity.show
    example: Show entity by name
```

## API Overview

### `testExamples(app, ctx?)`

The headline one-liner. For each trail with `examples`, generates `describe`/`test` blocks using the Bun test runner.

Per example:

1. Validates `example.input` against the trail's Zod schema
2. Calls the implementation with validated input
3. Applies progressive assertion (see below)
4. Validates output against the trail's output schema (if present)

Trails with no examples produce no tests.

The runtime implementation is always awaited, so `testExamples()` behaves the same for sync-authored and async-authored trails.

### `testTrail(trail, scenarios, ctx?)`

Custom scenarios for edge cases, boundary values, and regressions that do not belong in agent-facing examples:

```typescript
import { testTrail } from '@ontrails/testing';
import { ValidationError, NotFoundError } from '@ontrails/core';

testTrail(showTrail, [
  { description: 'empty name', input: { name: '' }, expectOk: true },
  { description: 'missing name', input: {}, expectErr: ValidationError },
  {
    description: 'exact match',
    input: { name: 'Alpha' },
    expectValue: { name: 'Alpha', type: 'concept' },
  },
  {
    description: 'not found',
    input: { name: 'missing' },
    expectErr: NotFoundError,
    expectErrMessage: 'not found',
  },
]);
```

### `testHike(hike, scenarios, ctx?)`

Tests a hike's composition graph -- follow chains, failure injection, and multi-trail interactions:

```typescript
import { testHike } from '@ontrails/testing';

testHike(onboardHike, [
  { description: 'successful onboard', input: { name: 'Delta', type: 'tool' }, expectOk: true },
  { description: 'fails when add fails', input: { name: 'Alpha' }, expectErr: AlreadyExistsError },
]);
```

Where `testTrail` exercises a single trail in isolation, `testHike` exercises the follow graph and verifies that upstream failures propagate correctly.

### `testContracts(app, ctx?)`

Catches implementation-schema drift. Runs every example through the implementation, then validates the result against the trail's `output` schema. Reports detailed Zod errors on mismatch.

```typescript
import { testContracts } from '@ontrails/testing';

testContracts(app);
// Fails if any implementation returns data that doesn't match its declared output schema
```

### `testDetours(app)`

Structural validation of detour declarations. Verifies every detour target trail exists in the topo. No implementation execution needed.

```typescript
import { testDetours } from '@ontrails/testing';

testDetours(app);
// Fails: Trail "entity.show" has detour target "entity.search" which does not exist in the topo
```

### Progressive Assertion

What `testExamples` checks depends on what the example declares:

**Full match** -- example has `expected`:

```typescript
{
  name: 'Found',
  input: { name: 'Alpha' },
  expected: { name: 'Alpha', type: 'concept' },
}
```

Asserts `result.isOk()` and `result.value` deep-equals `expected`.

**Schema-only match** -- example has no `expected` and no `error`:

```typescript
{ name: 'Returns something valid', input: { name: 'Alpha' } }
```

Asserts `result.isOk()` and validates against the trail's output schema.

**Error match** -- example has `error`:

```typescript
{ name: 'Not found', input: { name: 'missing' }, error: 'NotFoundError' }
```

Asserts `result.isErr()` and `instanceof` check.

### Test Context and Mocks

```typescript
import { createTestContext, createTestLogger } from '@ontrails/testing';

// TrailContext with sensible test defaults
const ctx = createTestContext({
  requestId: 'test-001',
  env: { TRAILS_ENV: 'test' },
});

// Logger that captures entries in memory
const logger = createTestLogger();
logger.info('hello');
logger.entries; // All captured records
logger.assertLogged('info', 'hello'); // Passes if any entry matches
logger.clear(); // Reset
```

### Surface Harnesses

**CLI harness** -- execute commands in-process and capture stdout/stderr:

```typescript
import { createCliHarness } from '@ontrails/testing';

const harness = createCliHarness({ app });
const result = await harness.run('entity show --name Alpha --output json');

expect(result.exitCode).toBe(0);
expect(result.json).toMatchObject({ name: 'Alpha' });
```

**MCP harness** -- invoke tools directly without transport:

```typescript
import { createMcpHarness } from '@ontrails/testing';

const harness = createMcpHarness({ app });
const result = await harness.callTool('myapp_entity_show', { name: 'Alpha' });

expect(result.isError).toBe(false);
```

## Exports

```typescript
import {
  testExamples,
  testTrail,
  testHike,
  testContracts,
  testDetours,
  createTestContext,
  createTestLogger,
  createCliHarness,
  createMcpHarness,
} from '@ontrails/testing';
```

## Further Reading

- [Testing Guide](../../docs/testing.md)
- [Getting Started](../../docs/getting-started.md)
