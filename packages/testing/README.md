# @ontrails/testing

Contract-driven testing for Trails. Add examples to your trails, then `testAll(app)` runs them as assertions, validates output schemas, checks composition graphs, and verifies structural integrity. One line of test code, full governance.

## Usage

```typescript
import { testAll } from '@ontrails/testing';
import { app } from '../app';

testAll(app);
```

That single call covers example execution, contract validation, detour checks, and topo validation. For most apps, this is all you need.

If you want finer control:

```typescript
import { testExamples, testContracts, testDetours } from '@ontrails/testing';

testExamples(app);   // Run every trail's examples as tests
testContracts(app);  // Validate outputs against declared schemas
testDetours(app);    // Verify detour targets exist
```

## API

| Export | What it does |
| --- | --- |
| `testAll(topo, ctx?)` | Single-line governance suite: validation + examples + contracts + detours |
| `testExamples(topo, ctx?)` | Run trail examples as `describe`/`test` blocks |
| `testTrail(trail, scenarios)` | Custom scenarios for edge cases, error paths, and cross chains |
| `testContracts(topo, ctx?)` | Validate output against declared schemas |
| `testDetours(topo)` | Verify every detour target exists in the topo |
| `createCrossContext(options?)` | Mock `CrossFn` for testing composite trails; returns preconfigured `Result` values keyed by trail ID |
| `createTestContext(options?)` | `TrailContext` with sensible test defaults |
| `createTestLogger()` | Logger that captures entries in memory for assertions |
| `createCliHarness(options)` | Execute CLI commands in-process, capture stdout/stderr |
| `createMcpHarness(options)` | Invoke MCP tools directly without transport |

See the [API Reference](../../docs/api-reference.md) for the full list.

## testTrail

For edge cases that do not belong in agent-facing examples:

```typescript
import { testTrail } from '@ontrails/testing';
import { ValidationError, NotFoundError } from '@ontrails/core';

testTrail(showTrail, [
  { description: 'empty name', input: { name: '' }, expectOk: true },
  { description: 'missing name', input: {}, expectErr: ValidationError },
  { description: 'not found', input: { name: 'missing' }, expectErr: NotFoundError },
]);
```

## Testing composition (trails with crosses)

`testTrail` works the same for trails with `crosses` -- it exercises the crossing graph:

```typescript
import { testTrail } from '@ontrails/testing';

testTrail(onboardTrail, [
  { description: 'happy path', input: { name: 'Delta', type: 'tool' }, expectOk: true },
  { description: 'add fails', input: { name: 'Alpha' }, expectErr: AlreadyExistsError },
]);
```

When you need to isolate a composite trail and stub out its dependencies, use `createCrossContext`:

```typescript
import { createCrossContext, createTestContext } from '@ontrails/testing';
import { Result } from '@ontrails/core';

const cross = createCrossContext({
  responses: {
    'entity.add': Result.ok({ id: '1', name: 'Delta', type: 'tool' }),
    'search': Result.ok({ results: [] }),
  },
});
const ctx = { ...createTestContext(), cross };
const result = await onboardTrail.run({ name: 'Delta', type: 'tool' }, ctx);
```

Calls to unregistered trail IDs return `Result.err` with a descriptive message, so missing stubs fail loudly.

## Trailhead harnesses

```typescript
import { createCliHarness, createMcpHarness } from '@ontrails/testing';

// CLI
const cli = createCliHarness({ app });
const result = await cli.run('entity show --name Alpha --output json');
expect(result.exitCode).toBe(0);

// MCP
const mcp = createMcpHarness({ app });
const tool = await mcp.callTool('myapp_entity_show', { name: 'Alpha' });
expect(tool.isError).toBe(false);
```

## Installation

```bash
bun add -d @ontrails/testing
```
