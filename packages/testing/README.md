# @ontrails/testing

Contract-driven testing for Trails. Add examples to your trails, then `testAll(graph)` runs them as assertions, validates output schemas, checks composition graphs, and verifies structural integrity. One line of test code, full contract coverage.

## Usage

```typescript
import { testAll } from '@ontrails/testing';
import { graph } from '../app';

testAll(graph);
```

That single call covers example execution, contract validation, detour checks, and topo validation. For most apps, this is all you need.

If you want finer control:

```typescript
import { testExamples, testContracts, testDetours } from '@ontrails/testing';

testExamples(graph);   // Run every trail's examples as tests
testContracts(graph);  // Validate outputs against declared schemas
testDetours(graph);    // Validate detour constructor, recover, and ordering semantics
```

## API

| Export | What it does |
| --- | --- |
| `testAll(topo, ctx?)` | Single-line contract suite: validation + examples + contracts + detours |
| `testExamples(topo, ctx?)` | Run trail examples as `describe`/`test` blocks |
| `testTrail(trail, scenarios)` | Custom scenarios for edge cases, error paths, and cross chains |
| `testContracts(topo, ctx?)` | Validate output against declared schemas |
| `testDetours(topo)` | Validate detour constructor, recover, and shadowing semantics |
| `createCrossContext(options?)` | Mock `CrossFn` for testing composite trails; returns preconfigured `Result` values keyed by trail ID |
| `createTestContext(options?)` | `TrailContext` with sensible test defaults |
| `createTestLogger()` | Logger that captures entries in memory for assertions |

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
import { createCrossContext, testTrail } from '@ontrails/testing';
import { Result } from '@ontrails/core';

const cross = createCrossContext({
  responses: {
    'entity.add': Result.ok({ id: '1', name: 'Delta', type: 'tool' }),
    'search': Result.ok({ results: [] }),
  },
});
testTrail(onboardTrail, [
  {
    description: 'uses mocked crosses',
    input: { name: 'Delta', type: 'tool' },
    expectOk: true,
  },
], { cross });
```

Calls to unregistered trail IDs return `Result.err` with a descriptive message, so missing stubs fail loudly.

## Surface Harnesses

Surface harnesses live on explicit subpaths so projects that only import
contract helpers from `@ontrails/testing` do not need CLI, MCP, or HTTP peers.
Install the peer package for the subpath you use:

- `@ontrails/testing/cli` requires `@ontrails/cli`
- `@ontrails/testing/mcp` requires `@ontrails/mcp`
- `@ontrails/testing/http` requires `@ontrails/http`
- `@ontrails/testing/established` and `@ontrails/testing/surface-parity`
  require all three shipped surface peers

```typescript
import { createCliHarness } from '@ontrails/testing/cli';
import { createHttpHarness } from '@ontrails/testing/http';
import { createMcpHarness } from '@ontrails/testing/mcp';

// CLI
const cli = createCliHarness({ graph });
const result = await cli.run('entity show --name Alpha --output json');
expect(result.exitCode).toBe(0);

// MCP
const mcp = createMcpHarness({ graph });
const tool = await mcp.callTool('myapp_entity_show', { name: 'Alpha' });
expect(tool.isError).toBe(false);

// HTTP
const http = createHttpHarness({ graph });
const response = await http.get('/entity/show', { name: 'Alpha' });
expect(response.status).toBe(200);
```

Use `testAllEstablished()` from `@ontrails/testing/established` when an
established app should run the root contract suite and validate CLI, MCP, and
HTTP projections in one call.

## Surface Parity

`testSurfaceParity()` is a focused gate for established apps that want to prove
their examples behave the same through every shipped surface.

```typescript
import { testSurfaceParity } from '@ontrails/testing/surface-parity';
import { graph } from '../app';

const createDeterministicTestDb = () => ({});

testSurfaceParity(graph, {
  createResources: () => ({
    'db.main': createDeterministicTestDb(),
  }),
  exclusions: [
    {
      example: 'Creates generated data',
      reason: 'output includes generated IDs that intentionally differ per surface run',
      trailId: 'entity.add',
    },
  ],
});
```

The helper compares normalized success payloads and normalized TrailsError
category/code pairs. CLI command names, MCP tool names, HTTP method/path values,
transport envelopes, activation consumers, internal trails, and planned
WebSocket work stay outside the equality check. Use `createResources` when
examples need deterministic fixtures for each surface invocation, and use
exclusions for intentional semantic differences that should not be silently
skipped.

## Installation

```bash
bun add -d @ontrails/testing@beta
```
