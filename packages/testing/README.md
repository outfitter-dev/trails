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
| `testTrail(trail, scenarios)` | Custom scenarios for edge cases and error paths |
| `testHike(hike, scenarios)` | Test composition graphs -- follow chains, failure injection |
| `testContracts(topo, ctx?)` | Validate implementation output against declared schemas |
| `testDetours(topo)` | Verify every detour target exists in the topo |
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

## testHike

Where `testTrail` exercises a single trail, `testHike` exercises the follow graph:

```typescript
import { testHike } from '@ontrails/testing';

testHike(onboardHike, [
  { description: 'happy path', input: { name: 'Delta', type: 'tool' }, expectOk: true },
  { description: 'add fails', input: { name: 'Alpha' }, expectErr: AlreadyExistsError },
]);
```

## Surface harnesses

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
