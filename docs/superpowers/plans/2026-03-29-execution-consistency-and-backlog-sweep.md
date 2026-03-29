# Execution Consistency and Backlog Sweep

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize trail execution into a shared pipeline, add build-time collision detection, wire AbortSignal, add headless `dispatch()`, and clear remaining backlog items — as a 10-PR Graphite stack.

**Architecture:** Extract a shared `executeTrail()` function in `@ontrails/core` that encapsulates validate → context → layers → run. All surfaces (CLI, MCP, HTTP) and `dispatch()` call this instead of reimplementing. Build-time collision detection returns `Result` consistently. Warden rules become composable trails.

**Tech Stack:** TypeScript, Bun, Zod, `@ontrails/*` packages, `bun:test`

**Linear project:** [Execution consistency and backlog sweep](https://linear.app/outfitter/project/execution-consistency-and-backlog-sweep-74057f6927af)

**Graphite stack order** (bottom → top, each task = one branch/PR):

| # | Branch | Linear | Milestone |
|---|--------|--------|-----------|
| 1 | `trl-49-add-trailresultt-utility-type` | TRL-49 | Core Utilities |
| 2 | `trl-51-add-topoids-and-topocount-accessors` | TRL-51 | Core Utilities |
| 3 | `trl-52-buildmcptools-collision-result` | TRL-52 | Build-Time Safety |
| 4 | `trl-55-http-route-collision-detection` | TRL-55 | Build-Time Safety |
| 5 | `trl-56-centralize-executetrail` | TRL-56 | Execution Pipeline |
| 6 | `trl-53-cli-exception-catching` | TRL-53 | Execution Pipeline |
| 7 | `trl-54-http-abortsignal-wiring` | TRL-54 | Execution Pipeline |
| 8 | `trl-50-add-dispatch` | TRL-50 | Execution Pipeline |
| 9 | `trl-57-http-openapi-fixes` | TRL-57 | Polish and Dogfooding |
| 10 | `trl-38-dogfood-warden` | TRL-38 | Polish and Dogfooding |

---

## Task 1: `TrailResult<T>` utility type [TRL-49]

**Files:**

- Modify: `packages/core/src/type-utils.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/__tests__/type-utils.test.ts`
- Modify: `docs/api-reference.md`

- [ ] **Step 1: Write the compile-time test**

Add a new describe block to `packages/core/src/__tests__/type-utils.test.ts`:

```typescript
describe('TrailResult', () => {
  test('extracts Result<Output, Error> from a trail', () => {
    const t = trail('test.result', {
      input: z.object({ q: z.string() }),
      output: z.object({ answer: z.string() }),
      run: (input) => Result.ok({ answer: input.q }),
    });

    type Expected = Result<{ answer: string }, Error>;
    type Actual = TrailResult<typeof t>;

    // Compile-time check: assignment works in both directions
    const _check1: Expected = {} as Actual;
    const _check2: Actual = {} as Expected;

    // Runtime: type exists and is usable
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test type-utils`
Expected: FAIL — `TrailResult` is not exported.

- [ ] **Step 3: Add the type**

In `packages/core/src/type-utils.ts`, add after the existing `TrailOutput` type:

```typescript
/**
 * Extracts the full `Result<Output, Error>` type from a trail definition.
 *
 * @example
 * ```typescript
 * type SearchResult = TrailResult<typeof searchTrail>;
 * // Result<{ results: Item[]; count: number }, Error>
 * ```
 */
export type TrailResult<T extends AnyTrail> = Result<TrailOutput<T>, Error>;
```

Add the `Result` import if not already present — it should be importable from `./result.ts`.

- [ ] **Step 4: Export from index**

In `packages/core/src/index.ts`, add `TrailResult` to the type-utils re-export line.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/core && bun test type-utils`
Expected: PASS

- [ ] **Step 6: Update docs**

In `docs/api-reference.md`, find the type utilities section and add `TrailResult<T>` alongside `TrailInput<T>` and `TrailOutput<T>`.

- [ ] **Step 7: Run full checks**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: All green.

- [ ] **Step 8: Commit**

```bash
gt create trl-49-add-trailresultt-utility-type -am "feat(core): add TrailResult<T> utility type [TRL-49]"
```

---

## Task 2: `topo.ids()` and `topo.count` accessors [TRL-51]

**Files:**

- Modify: `packages/core/src/topo.ts`
- Modify: `packages/core/src/__tests__/topo.test.ts`
- Modify: `docs/api-reference.md`

- [ ] **Step 1: Write the failing tests**

Add a new describe block to `packages/core/src/__tests__/topo.test.ts`:

```typescript
describe('topo accessors', () => {
  test('ids() returns all trail IDs', () => {
    const a = trail('alpha', {
      input: z.object({}),
      output: z.object({}),
      run: () => Result.ok({}),
    });
    const b = trail('beta', {
      input: z.object({}),
      output: z.object({}),
      run: () => Result.ok({}),
    });
    const app = topo('test', { a, b });
    expect(app.ids().sort()).toEqual(['alpha', 'beta']);
  });

  test('count returns number of trails', () => {
    const a = trail('alpha', {
      input: z.object({}),
      output: z.object({}),
      run: () => Result.ok({}),
    });
    const app = topo('test', { a });
    expect(app.count).toBe(1);
  });

  test('empty topo has zero count and empty ids', () => {
    const app = topo('empty');
    expect(app.count).toBe(0);
    expect(app.ids()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test topo`
Expected: FAIL — `ids` and `count` do not exist on Topo.

- [ ] **Step 3: Add accessors to Topo**

In `packages/core/src/topo.ts`, find the `Topo` interface (or the object returned by `createTopo`). The current implementation uses `createTopo(name, trails, events)` which returns an object with `name`, `trails` (Map), `events` (Map), `has()`, `get()`, `list()`.

Add to the returned object:

```typescript
ids: (): string[] => [...trails.keys()],
count: trails.size,
```

If there's a `Topo` interface/type, add the type declarations there too:

```typescript
/** All trail IDs registered in this topo. */
ids(): string[];
/** Number of trails in this topo. */
readonly count: number;
```

Note: `count` must be a getter (not a plain property) since it reads from the map at access time. If the map is frozen after creation, a plain property is fine. Check whether trails are added after `createTopo` — if the map is populated before `createTopo` is called (which it is, per the `topo()` factory at lines 95-111), a plain property works.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun test topo`
Expected: PASS

- [ ] **Step 5: Update docs**

In `docs/api-reference.md`, add `ids()` and `count` to the Topo API section.

- [ ] **Step 6: Run full checks**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: All green.

- [ ] **Step 7: Commit**

```bash
gt create trl-51-add-topoids-and-topocount-accessors -am "feat(core): add topo.ids() and topo.count accessors [TRL-51]"
```

---

## Task 3: `buildMcpTools()` collision returns `Result` [TRL-52]

**Files:**

- Modify: `packages/mcp/src/build.ts` (lines 327-345 `registerTool`, lines 360-373 `buildMcpTools`)
- Modify: `packages/mcp/src/__tests__/build.test.ts` (collision tests around line 374-416)

- [ ] **Step 1: Update collision tests to expect Result**

In `packages/mcp/src/__tests__/build.test.ts`, find the collision tests. Change them from `expect(() => ...).toThrow()` to Result assertions:

```typescript
test('returns error Result on trails that produce the same derived tool name', () => {
  const dotTrail = trail('foo.bar', {
    input: z.object({}),
    output: z.object({}),
    run: () => Result.ok({}),
  });
  const underscoreTrail = trail('foo_bar', {
    input: z.object({}),
    output: z.object({}),
    run: () => Result.ok({}),
  });
  const app = topo('myapp', { dotTrail, underscoreTrail });
  const result = buildMcpTools(app);
  expect(result.isErr()).toBe(true);
  expect(result.error.message).toMatch(/tool-name collision/i);
});

test('returns error Result on hyphen-underscore collision', () => {
  // Same pattern as above with hyphen/underscore variant trails
  const hyphenTrail = trail('foo-bar', {
    input: z.object({}),
    output: z.object({}),
    run: () => Result.ok({}),
  });
  const underscoreTrail = trail('foo_bar', {
    input: z.object({}),
    output: z.object({}),
    run: () => Result.ok({}),
  });
  const app = topo('myapp', { hyphenTrail, underscoreTrail });
  const result = buildMcpTools(app);
  expect(result.isErr()).toBe(true);
  expect(result.error.message).toMatch(/tool-name collision/i);
});

test('returns ok Result when trail names are distinct', () => {
  // Use the existing non-collision test but assert on Result
  const aTrail = trail('search', {
    input: z.object({ q: z.string().describe('Query') }),
    output: z.object({ results: z.array(z.string()) }),
    run: (input) => Result.ok({ results: [input.q] }),
  });
  const app = topo('myapp', { aTrail });
  const result = buildMcpTools(app);
  expect(result.isOk()).toBe(true);
});
```

Also update ALL existing tests that call `buildMcpTools()` — they now return `Result` so every call site needs `.value` unwrapping. Find all instances of `buildMcpTools(app)` or `buildMcpTools(app, options)` in the test file and unwrap with:

```typescript
// Before:
const tools = buildMcpTools(app);

// After:
const toolsResult = buildMcpTools(app);
expect(toolsResult.isOk()).toBe(true);
const tools = toolsResult.value;
```

Or use the testing package's `expectOk()`:

```typescript
import { expectOk } from '@ontrails/testing';
const tools = expectOk(buildMcpTools(app));
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/mcp && bun test build`
Expected: FAIL — `buildMcpTools` still throws and doesn't return Result.

- [ ] **Step 3: Change `buildMcpTools()` return type to `Result`**

In `packages/mcp/src/build.ts`:

1. Change `buildMcpTools()` signature (around line 360) to return `Result<McpToolDefinition[], Error>`:

```typescript
export const buildMcpTools = (
  app: Topo,
  options: BuildMcpToolsOptions = {}
): Result<McpToolDefinition[], Error> => {
```

1. Change `registerTool()` (around line 327) to return `Result<void, Error>` instead of throwing:

```typescript
const registerTool = (
  app: Topo,
  trailItem: Trail<unknown, unknown>,
  layers: readonly Layer[],
  options: BuildMcpToolsOptions,
  nameToTrailId: Map<string, string>,
  tools: McpToolDefinition[]
): Result<void, Error> => {
  const toolName = deriveToolName(app.name, trailItem.id);
  const existingId = nameToTrailId.get(toolName);
  if (existingId !== undefined) {
    return Result.err(
      new ValidationError(
        `MCP tool-name collision: trails "${existingId}" and "${trailItem.id}" both derive the tool name "${toolName}"`
      )
    );
  }
  nameToTrailId.set(toolName, trailItem.id);
  tools.push(buildToolDefinition(app, trailItem, layers, options));
  return Result.ok(undefined);
};
```

1. In the `buildMcpTools()` body, check `registerTool` results and propagate errors:

```typescript
for (const trailItem of app.list()) {
  const registered = registerTool(app, trailItem, layers, options, nameToTrailId, tools);
  if (registered.isErr()) {
    return Result.err(registered.error);
  }
}
return Result.ok(tools);
```

Import `ValidationError` from `@ontrails/core` if not already imported.

- [ ] **Step 4: Update callers of `buildMcpTools`**

Check `packages/mcp/src/blaze.ts` or wherever `buildMcpTools` is called to register tools with the MCP server. The caller needs to unwrap the Result — if it's an error, propagate it (likely the `blaze()` function should return the error or throw at the surface boundary since MCP server startup is a boundary).

Read the MCP `blaze()` function to understand how `buildMcpTools` is called and update accordingly. The blaze function is the surface boundary, so it's acceptable to handle the error there (log + throw, or return early).

- [ ] **Step 5: Update the export type**

If `McpToolDefinition[]` is exported as a return type anywhere, update the type to `Result<McpToolDefinition[], Error>`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/mcp && bun test`
Expected: PASS

- [ ] **Step 7: Run full checks**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: All green.

- [ ] **Step 8: Commit**

```bash
gt create trl-52-buildmcptools-collision-result -am "fix(mcp): return Result from buildMcpTools() on collision instead of throwing [TRL-52]"
```

---

## Task 4: HTTP route collision detection [TRL-55]

**Files:**

- Modify: `packages/http/src/build.ts` (around `buildHttpRoutes()` at line 175)
- Modify: `packages/http/src/__tests__/build.test.ts`

- [ ] **Step 1: Write collision tests**

Add to `packages/http/src/__tests__/build.test.ts`:

```typescript
describe('route collision detection', () => {
  test('returns error on duplicate (path, method) pairs', () => {
    // Two trails that map to the same GET /entity/show
    const show1 = trail('entity.show', {
      input: z.object({}),
      output: z.object({ id: z.string() }),
      intent: 'read',
      run: () => Result.ok({ id: '1' }),
    });
    // A second trail with a different ID but same derived path+method
    // entity_show with intent read → GET /entity/show (same as entity.show)
    const show2 = trail('entity_show', {
      input: z.object({}),
      output: z.object({ id: z.string() }),
      intent: 'read',
      run: () => Result.ok({ id: '2' }),
    });
    const app = topo('test', { show1, show2 });
    const result = buildHttpRoutes(app);
    expect(result.isErr()).toBe(true);
    expect(result.error.message).toMatch(/route.*collision/i);
  });

  test('allows same path with different methods', () => {
    const read = trail('entity.show', {
      input: z.object({}),
      output: z.object({ id: z.string() }),
      intent: 'read',
      run: () => Result.ok({ id: '1' }),
    });
    const write = trail('entity.update', {
      input: z.object({ id: z.string().describe('ID') }),
      output: z.object({ ok: z.boolean() }),
      intent: 'write',
      run: () => Result.ok({ ok: true }),
    });
    const app = topo('test', { read, write });
    const result = buildHttpRoutes(app);
    expect(result.isOk()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/http && bun test build`
Expected: FAIL — `buildHttpRoutes` doesn't return Result or detect collisions.

- [ ] **Step 3: Add collision detection and return Result**

In `packages/http/src/build.ts`, modify `buildHttpRoutes()`:

1. Change the return type to `Result<HttpRouteDefinition[], Error>`.

2. After building all route definitions, check for collisions:

```typescript
const seen = new Map<string, string>();
for (const route of routes) {
  const key = `${route.method} ${route.path}`;
  const existingId = seen.get(key);
  if (existingId !== undefined) {
    return Result.err(
      new ValidationError(
        `HTTP route collision: trails "${existingId}" and "${route.trailId}" both derive ${key}`
      )
    );
  }
  seen.set(key, route.trailId);
}
return Result.ok(routes);
```

Note: check what property holds the trail ID on `HttpRouteDefinition` — it may be `trailId`, `id`, or accessed differently. Read the type definition first.

- [ ] **Step 4: Update callers**

Update `packages/http/src/hono/blaze.ts` — the `registerRoutes()` function calls `buildHttpRoutes()`. It needs to unwrap the Result. Since `blaze()` is the surface boundary, handle the error there.

Also update all tests that call `buildHttpRoutes()` to unwrap the Result:

```typescript
// Before:
const routes = buildHttpRoutes(app);

// After:
const result = buildHttpRoutes(app);
expect(result.isOk()).toBe(true);
const routes = result.value;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/http && bun test`
Expected: PASS

- [ ] **Step 6: Run full checks**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: All green.

- [ ] **Step 7: Commit**

```bash
gt create trl-55-http-route-collision-detection -am "fix(http): detect route path collisions and return Result from buildHttpRoutes() [TRL-55]"
```

---

## Task 5: Centralize `executeTrail` into core [TRL-56]

This is the keystone PR. Extract the duplicated validate → context → layers → run pipeline into `@ontrails/core`.

**Files:**

- Create: `packages/core/src/execute.ts`
- Create: `packages/core/src/__tests__/execute.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/cli/src/build.ts`
- Modify: `packages/mcp/src/build.ts`
- Modify: `packages/http/src/build.ts`

- [ ] **Step 1: Write tests for the shared `executeTrail`**

Create `packages/core/src/__tests__/execute.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { trail } from '../trail';
import { executeTrail } from '../execute';
import { Result } from '../result';
import { createTrailContext } from '../context';
import type { Layer } from '../layer';

describe('executeTrail', () => {
  const greet = trail('greet', {
    input: z.object({ name: z.string().describe('Name') }),
    output: z.object({ message: z.string() }),
    run: (input) => Result.ok({ message: `Hello, ${input.name}!` }),
  });

  test('validates input and executes trail', async () => {
    const result = await executeTrail(greet, { name: 'World' });
    expect(result.isOk()).toBe(true);
    expect(result.value).toEqual({ message: 'Hello, World!' });
  });

  test('returns validation error for invalid input', async () => {
    const result = await executeTrail(greet, { name: 123 });
    expect(result.isErr()).toBe(true);
    expect(result.error.message).toMatch(/expected.*string/i);
  });

  test('composes layers around execution', async () => {
    const calls: string[] = [];
    const layer: Layer = {
      name: 'test-layer',
      wrap: (_t, next) => async (input, ctx) => {
        calls.push('before');
        const r = await next(input, ctx);
        calls.push('after');
        return r;
      },
    };
    const result = await executeTrail(greet, { name: 'World' }, { layers: [layer] });
    expect(result.isOk()).toBe(true);
    expect(calls).toEqual(['before', 'after']);
  });

  test('accepts context overrides', async () => {
    let capturedId = '';
    const t = trail('ctx.test', {
      input: z.object({}),
      output: z.object({}),
      run: (_input, ctx) => {
        capturedId = ctx.requestId;
        return Result.ok({});
      },
    });
    await executeTrail(t, {}, { ctx: { requestId: 'custom-123' } });
    expect(capturedId).toBe('custom-123');
  });

  test('accepts signal override', async () => {
    const controller = new AbortController();
    let capturedSignal: AbortSignal | undefined;
    const t = trail('signal.test', {
      input: z.object({}),
      output: z.object({}),
      run: (_input, ctx) => {
        capturedSignal = ctx.signal;
        return Result.ok({});
      },
    });
    await executeTrail(t, {}, { signal: controller.signal });
    expect(capturedSignal).toBe(controller.signal);
  });

  test('catches thrown exceptions and returns InternalError', async () => {
    const throwing = trail('throw.test', {
      input: z.object({}),
      output: z.object({}),
      run: () => { throw new Error('kaboom'); },
    });
    const result = await executeTrail(throwing, {});
    expect(result.isErr()).toBe(true);
    expect(result.error.message).toContain('kaboom');
  });

  test('accepts a context factory function', async () => {
    let capturedId = '';
    const t = trail('factory.test', {
      input: z.object({}),
      output: z.object({}),
      run: (_input, ctx) => {
        capturedId = ctx.requestId;
        return Result.ok({});
      },
    });
    await executeTrail(t, {}, {
      createContext: () => createTrailContext({ requestId: 'factory-456' }),
    });
    expect(capturedId).toBe('factory-456');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test execute`
Expected: FAIL — `executeTrail` does not exist.

- [ ] **Step 3: Implement `executeTrail`**

Create `packages/core/src/execute.ts`:

```typescript
import type { AnyTrail, TrailContext } from './types';
import type { Layer } from './layer';
import { composeLayers } from './layer';
import { createTrailContext } from './context';
import { validateInput } from './validation';
import { InternalError } from './errors';
import { Result } from './result';

/** Options for trail execution. */
export interface ExecuteTrailOptions {
  /** Partial context overrides merged with defaults. */
  readonly ctx?: Partial<TrailContext>;
  /** AbortSignal for cancellation — takes precedence over ctx.signal. */
  readonly signal?: AbortSignal;
  /** Layers to compose around the trail's run function. */
  readonly layers?: readonly Layer[];
  /** Factory that produces a full base context (overrides default createTrailContext). */
  readonly createContext?: () => TrailContext | Promise<TrailContext>;
}

/**
 * Shared trail execution pipeline: validate → context → layers → run.
 *
 * Every surface (CLI, MCP, HTTP) and `dispatch()` should call this
 * instead of reimplementing the pipeline.
 *
 * Never throws — caught exceptions become `InternalError` results.
 */
export const executeTrail = async (
  trail: AnyTrail,
  rawInput: unknown,
  options?: ExecuteTrailOptions
): Promise<Result<unknown, Error>> => {
  try {
    // 1. Validate input
    const validated = validateInput(trail.input, rawInput);
    if (validated.isErr()) {
      return validated;
    }

    // 2. Build context
    const baseContext =
      options?.createContext !== undefined
        ? await options.createContext()
        : createTrailContext(options?.ctx);

    const ctx: TrailContext =
      options?.signal !== undefined
        ? { ...baseContext, signal: options.signal }
        : baseContext;

    // 3. Compose layers
    const layers = options?.layers ?? [];
    const impl = composeLayers([...layers], trail, trail.run);

    // 4. Execute
    return await impl(validated.value, ctx);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return Result.err(new InternalError(message));
  }
};
```

- [ ] **Step 4: Export from index**

In `packages/core/src/index.ts`, add:

```typescript
export { executeTrail } from './execute';
export type { ExecuteTrailOptions } from './execute';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/core && bun test execute`
Expected: PASS

- [ ] **Step 6: Migrate CLI to use shared `executeTrail`**

In `packages/cli/src/build.ts`:

Replace the local `executeTrail` function (lines ~150-160) and `resolveContext` (lines ~125-137) with an import from core:

```typescript
import { executeTrail } from '@ontrails/core';
```

Update `createExecute` (lines ~163-205) to call the shared `executeTrail`:

```typescript
const result = await executeTrail(t, mergedInput, {
  layers: options?.layers,
  createContext: options?.createContext,
  ctx: ctxOverrides,
});
```

The key change: validation now happens inside `executeTrail`, so `createExecute` should pass the raw merged input, not pre-validate. However, CLI needs to handle prompting BEFORE validation. So the flow becomes:

1. Merge args + flags → `mergedInput`
2. Apply prompting (fills in interactive values)
3. Call `executeTrail(t, mergedInput, ...)` — validates + executes
4. Call `reportResult(...)`

Remove the local `executeTrail` and `resolveContext` functions.

- [ ] **Step 7: Migrate MCP to use shared `executeTrail`**

In `packages/mcp/src/build.ts`:

Replace `executeAndMap` (lines ~220-237) and simplify `createHandler` (lines ~239-255):

```typescript
import { executeTrail } from '@ontrails/core';

const createHandler =
  (
    trail: Trail<unknown, unknown>,
    layers: readonly Layer[],
    options: BuildMcpToolsOptions
  ) =>
  async (args: Record<string, unknown>, extra: McpExtra): Promise<McpToolResult> => {
    const progressCb = createMcpProgressCallback(extra);
    const result = await executeTrail(trail, args, {
      layers,
      createContext: options.createContext,
      signal: extra.signal,
      ctx: progressCb !== undefined ? { progress: progressCb } : undefined,
    });

    if (result.isOk()) {
      return { content: await serializeOutput(result.value) };
    }
    return mcpError(result.error.message);
  };
```

Remove the local `executeAndMap` and `buildTrailContext` functions.

Note: The MCP handler needs both `createContext` factory AND `ctx` overrides (for progress). Check whether `ExecuteTrailOptions` supports both simultaneously. If `createContext` is provided, `ctx` overrides should be merged on top. Verify the `executeTrail` implementation handles this — if not, adjust: when both `createContext` and `ctx` are provided, the implementation should call `createContext()` first then spread `ctx` overrides on top.

- [ ] **Step 8: Migrate HTTP to use shared `executeTrail`**

In `packages/http/src/build.ts`:

Replace `createExecute` (lines ~108-128) and `buildTrailContext` (lines ~85-100):

```typescript
import { executeTrail } from '@ontrails/core';

const createExecute =
  (
    trail: Trail<unknown, unknown>,
    layers: readonly Layer[],
    options: BuildHttpRoutesOptions
  ): HttpRouteDefinition['execute'] =>
  async (input, requestId) => {
    return executeTrail(trail, input, {
      layers,
      createContext: options.createContext,
      ctx: requestId !== undefined ? { requestId } : undefined,
    });
  };
```

Remove the local `buildTrailContext` function.

- [ ] **Step 9: Run all surface tests**

Run: `bun run test`
Expected: All green. If any tests fail, the migration introduced a behavioral change — debug by comparing the old and new context building.

- [ ] **Step 10: Run full checks**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: All green.

- [ ] **Step 11: Commit**

```bash
gt create trl-56-centralize-executetrail -am "refactor(core): extract shared executeTrail pipeline, migrate CLI/MCP/HTTP [TRL-56]"
```

---

## Task 6: CLI exception catching [TRL-53]

With `executeTrail` centralized, CLI already benefits from the try/catch. This task verifies the behavior and adds an explicit test.

**Files:**

- Modify: `packages/cli/src/__tests__/build.test.ts`

- [ ] **Step 1: Write the test**

Add to `packages/cli/src/__tests__/build.test.ts`:

```typescript
test('returns InternalError when run function throws', async () => {
  const throwing = trail('throw.test', {
    input: z.object({}),
    output: z.object({}),
    run: () => { throw new Error('unexpected kaboom'); },
  });
  const app = makeApp(throwing);
  const commands = buildCliCommands(app);
  const cmd = requireCommand(commands);
  const result = await cmd.execute({}, {});
  expect(result.isErr()).toBe(true);
  expect(result.error.message).toContain('unexpected kaboom');
});
```

- [ ] **Step 2: Run the test**

Run: `cd packages/cli && bun test build`

If Task 5's migration was done correctly, this should PASS immediately because `executeTrail` catches exceptions. If it fails, the CLI hasn't been fully migrated to use the shared pipeline.

- [ ] **Step 3: Verify no local try/catch is needed**

Read through `packages/cli/src/build.ts` and confirm there are no remaining execution paths that bypass `executeTrail`. If the CLI's `createExecute` delegates fully to `executeTrail`, no additional changes are needed.

- [ ] **Step 4: Run full checks**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: All green.

- [ ] **Step 5: Commit**

```bash
gt create trl-53-cli-exception-catching -am "test(cli): verify exception catching via centralized executeTrail [TRL-53]"
```

---

## Task 7: HTTP AbortSignal wiring [TRL-54]

**Files:**

- Modify: `packages/http/src/hono/blaze.ts` (the `createHonoHandler` around lines 135-162)
- Modify: `packages/http/src/build.ts` (the `HttpRouteDefinition.execute` signature)
- Modify: `packages/http/src/hono/__tests__/blaze.test.ts`
- Modify: `packages/http/src/__tests__/build.test.ts`

- [ ] **Step 1: Write the integration test**

Add to `packages/http/src/hono/__tests__/blaze.test.ts`:

```typescript
test('passes request AbortSignal to trail context', async () => {
  let capturedSignal: AbortSignal | undefined;
  const t = trail('signal.check', {
    input: z.object({}),
    output: z.object({ ok: z.boolean() }),
    intent: 'read',
    run: (_input, ctx) => {
      capturedSignal = ctx.signal;
      return Result.ok({ ok: true });
    },
  });
  const app = topo('test', { t });
  const honoApp = createHonoApp(app); // or however the test creates the Hono app
  const controller = new AbortController();
  const req = new Request('http://localhost/signal/check', {
    signal: controller.signal,
  });
  await honoApp.request(req);
  // The trail should have received a signal (either the request's or a linked one)
  expect(capturedSignal).toBeDefined();
  expect(capturedSignal?.aborted).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/http && bun test blaze`
Expected: May pass or fail depending on current wiring. If the Hono adapter currently creates a fresh AbortSignal, the test might pass trivially. Adjust the test to verify the signal is the REQUEST's signal, not a default one.

A better test: abort the controller and verify the trail sees `signal.aborted === true`:

```typescript
test('trail sees aborted signal when client disconnects', async () => {
  let capturedSignal: AbortSignal | undefined;
  const t = trail('signal.abort', {
    input: z.object({}),
    output: z.object({ ok: z.boolean() }),
    intent: 'read',
    run: (_input, ctx) => {
      capturedSignal = ctx.signal;
      return Result.ok({ ok: true });
    },
  });
  const app = topo('test', { t });
  const honoApp = createHonoApp(app);
  const controller = new AbortController();
  controller.abort(); // Pre-abort
  const req = new Request('http://localhost/signal/abort', {
    signal: controller.signal,
  });
  await honoApp.request(req);
  expect(capturedSignal?.aborted).toBe(true);
});
```

- [ ] **Step 3: Wire the signal through**

The signal needs to flow from the Hono request through to `executeTrail`. The chain is:

1. **Hono handler** (`createHonoHandler` in `packages/http/src/hono/blaze.ts`) extracts signal from `c.req.raw.signal`
2. Passes it to `route.execute(rawInput, requestId, signal)` — need to add `signal` parameter
3. **Route execute** (`createExecute` in `packages/http/src/build.ts`) passes it to `executeTrail(..., { signal })`

In `packages/http/src/build.ts`, update the `HttpRouteDefinition` execute signature:

```typescript
// Before:
execute: (input: unknown, requestId?: string) => Promise<Result<unknown, Error>>;

// After:
execute: (input: unknown, requestId?: string, signal?: AbortSignal) => Promise<Result<unknown, Error>>;
```

Update `createExecute`:

```typescript
const createExecute =
  (trail, layers, options): HttpRouteDefinition['execute'] =>
  async (input, requestId, signal) => {
    return executeTrail(trail, input, {
      layers,
      createContext: options.createContext,
      ctx: requestId !== undefined ? { requestId } : undefined,
      signal,
    });
  };
```

In `packages/http/src/hono/blaze.ts`, update `createHonoHandler`:

```typescript
const createHonoHandler =
  (route: HttpRouteDefinition) =>
  async (c: HonoContext): Promise<Response> => {
    const rawInput = await readInput(c, route.inputSource);
    if (rawInput === JSON_PARSE_ERROR) {
      return c.json({ error: { ... } }, 400);
    }
    const requestId = c.req.header('X-Request-ID') ?? undefined;
    const signal = c.req.raw.signal;  // <-- Extract signal
    try {
      const result = await route.execute(rawInput, requestId, signal);
      return mapResultToResponse(result, c);
    } catch (error: unknown) {
      return handleCaughtError(error, c);
    }
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/http && bun test`
Expected: PASS

- [ ] **Step 5: Run full checks**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: All green.

- [ ] **Step 6: Commit**

```bash
gt create trl-54-http-abortsignal-wiring -am "fix(http): wire request AbortSignal through to trail context [TRL-54]"
```

---

## Task 8: `dispatch()` for headless execution [TRL-50]

**Files:**

- Create: `packages/core/src/dispatch.ts`
- Create: `packages/core/src/__tests__/dispatch.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `docs/api-reference.md`

- [ ] **Step 1: Write the tests**

Create `packages/core/src/__tests__/dispatch.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { trail } from '../trail';
import { topo } from '../topo';
import { dispatch } from '../dispatch';
import { Result } from '../result';
import { createTrailContext } from '../context';
import type { Layer } from '../layer';

const greet = trail('greet', {
  input: z.object({ name: z.string().describe('Name') }),
  output: z.object({ message: z.string() }),
  run: (input) => Result.ok({ message: `Hello, ${input.name}!` }),
});

const app = topo('test', { greet });

describe('dispatch', () => {
  test('executes a trail by ID with validated input', async () => {
    const result = await dispatch(app, 'greet', { name: 'World' });
    expect(result.isOk()).toBe(true);
    expect(result.value).toEqual({ message: 'Hello, World!' });
  });

  test('returns NotFoundError for unknown trail ID', async () => {
    const result = await dispatch(app, 'nonexistent', {});
    expect(result.isErr()).toBe(true);
    expect(result.error.message).toMatch(/not found/i);
  });

  test('returns validation error for invalid input', async () => {
    const result = await dispatch(app, 'greet', { name: 42 });
    expect(result.isErr()).toBe(true);
  });

  test('composes layers', async () => {
    const calls: string[] = [];
    const layer: Layer = {
      name: 'spy',
      wrap: (_t, next) => async (input, ctx) => {
        calls.push('before');
        const r = await next(input, ctx);
        calls.push('after');
        return r;
      },
    };
    const result = await dispatch(app, 'greet', { name: 'World' }, { layers: [layer] });
    expect(result.isOk()).toBe(true);
    expect(calls).toEqual(['before', 'after']);
  });

  test('accepts context overrides', async () => {
    let capturedId = '';
    const t = trail('ctx.check', {
      input: z.object({}),
      output: z.object({}),
      run: (_input, ctx) => {
        capturedId = ctx.requestId;
        return Result.ok({});
      },
    });
    const ctxApp = topo('test', { t });
    await dispatch(ctxApp, 'ctx.check', {}, { ctx: { requestId: 'dispatch-789' } });
    expect(capturedId).toBe('dispatch-789');
  });

  test('never throws — exceptions become InternalError', async () => {
    const throwing = trail('boom', {
      input: z.object({}),
      output: z.object({}),
      run: () => { throw new Error('kaboom'); },
    });
    const throwApp = topo('test', { throwing });
    const result = await dispatch(throwApp, 'boom', {});
    expect(result.isErr()).toBe(true);
    expect(result.error.message).toContain('kaboom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test dispatch`
Expected: FAIL — `dispatch` does not exist.

- [ ] **Step 3: Implement `dispatch`**

Create `packages/core/src/dispatch.ts`:

```typescript
import type { Topo } from './topo';
import type { TrailContext } from './types';
import type { Layer } from './layer';
import { executeTrail } from './execute';
import { NotFoundError } from './errors';
import { Result } from './result';

/** Options for headless trail dispatch. */
export interface DispatchOptions {
  /** Partial context overrides. */
  readonly ctx?: Partial<TrailContext>;
  /** AbortSignal for cancellation. */
  readonly signal?: AbortSignal;
  /** Layers to compose around execution. */
  readonly layers?: readonly Layer[];
  /** Context factory. */
  readonly createContext?: () => TrailContext | Promise<TrailContext>;
}

/**
 * Dispatch a trail by ID with full validation, layer composition, and error handling.
 *
 * The "no-surface" surface — validates input, creates context, composes layers,
 * runs the trail, returns Result. Never throws.
 *
 * @example
 * ```typescript
 * const result = await dispatch(app, 'search', { query: 'test' });
 * if (result.isOk()) {
 *   console.log(result.value);
 * }
 * ```
 */
export const dispatch = async (
  topo: Topo,
  id: string,
  input: unknown,
  options?: DispatchOptions
): Promise<Result<unknown, Error>> => {
  const trail = topo.get(id);
  if (trail === undefined) {
    return Result.err(new NotFoundError(`Trail "${id}" not found in topo "${topo.name}"`));
  }
  return executeTrail(trail, input, options);
};
```

- [ ] **Step 4: Export from index**

In `packages/core/src/index.ts`, add:

```typescript
export { dispatch } from './dispatch';
export type { DispatchOptions } from './dispatch';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/core && bun test dispatch`
Expected: PASS

- [ ] **Step 6: Update docs**

In `docs/api-reference.md`, add a `dispatch()` section with usage examples.

- [ ] **Step 7: Run full checks**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: All green.

- [ ] **Step 8: Commit**

```bash
gt create trl-50-add-dispatch -am "feat(core): add dispatch() for headless trail execution [TRL-50]"
```

---

## Task 9: Minor HTTP/OpenAPI fixes [TRL-57]

**Files:**

- Modify: `packages/http/src/hono/blaze.ts` (error code consistency)
- Modify: `packages/schema/src/openapi.ts` (empty input body handling)
- Modify: `packages/testing/src/index.ts` and create helper (follow context)
- Modify: `packages/mcp/src/build.ts` (McpToolDefinition trail ref)
- Modify: `apps/trails-demo/src/` (idempotent trail)
- Modify corresponding test files

This is a batch of 5 smaller fixes. Work through them sequentially.

- [ ] **Step 1: Fix error code in Hono adapter**

In `packages/http/src/hono/blaze.ts`, find the JSON parse error response (around line 141-151). Change `code: 'validation'` to `code: 'ValidationError'`:

```typescript
return c.json({
  error: {
    category: 'validation',
    code: 'ValidationError',  // was 'validation'
    message: 'Invalid JSON in request body',
  },
}, 400);
```

Update the corresponding test in `packages/http/src/hono/__tests__/blaze.test.ts` to expect `'ValidationError'`.

- [ ] **Step 2: Fix empty input body in OpenAPI**

In `packages/schema/src/openapi.ts`, find where `requestBody` is generated. When `z.object({})` has no properties (`.shape` keys length is 0), skip `requestBody` entirely instead of marking it required.

```typescript
// Before generating requestBody:
const shape = trail.input._def?.shape?.() ?? trail.input.shape;
const hasProperties = Object.keys(shape).length > 0;
if (!hasProperties) {
  // Skip requestBody for empty input schemas
}
```

Add a test to `packages/schema/src/__tests__/openapi.test.ts`:

```typescript
test('omits requestBody for empty input schema', () => {
  const t = trail('empty.input', {
    input: z.object({}),
    output: z.object({ ok: z.boolean() }),
    intent: 'write',
    run: () => Result.ok({ ok: true }),
  });
  const app = topo('test', { t });
  const spec = generateOpenApiSpec(app);
  const operation = spec.paths['/empty/input']?.post;
  expect(operation?.requestBody).toBeUndefined();
});
```

- [ ] **Step 3: Add `createFollowContext` to testing package**

Create a helper in `packages/testing/src/context.ts` (or a new file `packages/testing/src/follow.ts`):

```typescript
import type { FollowFn } from '@ontrails/core';

export interface FollowContextOptions {
  readonly responses?: Record<string, Result<unknown, Error>>;
}

/**
 * Creates a mock follow function for testing composite trails.
 */
export const createFollowContext = (
  options?: FollowContextOptions
): FollowFn => {
  const responses = options?.responses ?? {};
  return async <O>(id: string, _input: unknown): Promise<Result<O, Error>> => {
    const response = responses[id];
    if (response === undefined) {
      return Result.err(new Error(`No mock response for follow("${id}")`)) as Result<O, Error>;
    }
    return response as Result<O, Error>;
  };
};
```

Export from `packages/testing/src/index.ts`.

Add a test to `packages/testing/src/__tests__/context.test.ts` or a new `follow.test.ts`:

```typescript
test('createFollowContext returns configured responses', async () => {
  const follow = createFollowContext({
    responses: { 'user.get': Result.ok({ name: 'Alice' }) },
  });
  const result = await follow('user.get', { id: '1' });
  expect(result.isOk()).toBe(true);
  expect(result.value).toEqual({ name: 'Alice' });
});

test('createFollowContext returns error for unconfigured trail', async () => {
  const follow = createFollowContext();
  const result = await follow('unknown', {});
  expect(result.isErr()).toBe(true);
});
```

- [ ] **Step 4: Add trail reference to McpToolDefinition**

In `packages/mcp/src/build.ts`, find the `McpToolDefinition` type. Add a `trailId` field:

```typescript
export interface McpToolDefinition {
  // ... existing fields
  readonly trailId: string;
}
```

Update `buildToolDefinition` to include `trailId: trailItem.id`. Update any tests that construct `McpToolDefinition` objects.

- [ ] **Step 5: Add idempotent demo trail**

In `apps/trails-demo/src/`, add a trail with `idempotent: true` to one of the existing module files:

```typescript
export const upsert = trail('demo.upsert', {
  input: z.object({
    key: z.string().describe('Item key'),
    value: z.string().describe('Item value'),
  }),
  output: z.object({ key: z.string(), value: z.string() }),
  intent: 'write',
  idempotent: true,
  run: (input) => Result.ok({ key: input.key, value: input.value }),
});
```

Register it in the topo.

- [ ] **Step 6: Run all tests**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: All green.

- [ ] **Step 7: Commit**

```bash
gt create trl-57-http-openapi-fixes -am "fix(http,schema,mcp,testing): minor fixes — error codes, empty body, follow context, trail ref [TRL-57]"
```

---

## Task 10: Dogfood warden — refactor rules as composable trails [TRL-38]

This is the largest task. Each warden rule becomes a trail with typed input/output and examples.

**Files:**

- Create: `packages/warden/src/trails/` directory with one file per rule
- Create: `packages/warden/src/trails/index.ts` (module barrel)
- Create: `packages/warden/src/__tests__/trails.test.ts`
- Modify: `packages/warden/src/rules/index.ts` (re-export from trails or keep backward compat)
- Modify: `packages/warden/src/warden.ts` or equivalent (use topo + dispatch)

- [ ] **Step 1: Design the trail contract for rules**

Define the shared schema for rule input/output:

```typescript
// packages/warden/src/trails/schema.ts
import { z } from 'zod';

export const ruleInput = z.object({
  filePath: z.string().describe('Path to the source file'),
  sourceCode: z.string().describe('Source code content'),
});

export const diagnosticSchema = z.object({
  rule: z.string().describe('Rule name'),
  severity: z.enum(['error', 'warning', 'info']).describe('Diagnostic severity'),
  message: z.string().describe('Human-readable diagnostic message'),
  line: z.number().optional().describe('Line number if applicable'),
});

export const ruleOutput = z.object({
  diagnostics: z.array(diagnosticSchema).describe('Diagnostics found'),
});

export type RuleInput = z.infer<typeof ruleInput>;
export type RuleOutput = z.infer<typeof ruleOutput>;
```

- [ ] **Step 2: Write tests for one rule trail (no-throw-in-implementation)**

Create `packages/warden/src/__tests__/trails.test.ts`:

```typescript
import { describe, test, expect } from 'bun:test';
import { testTrail } from '@ontrails/testing';
import { noThrowInImplementation } from '../trails';

describe('warden rule trails', () => {
  testTrail(noThrowInImplementation, [
    {
      description: 'clean implementation passes',
      input: {
        filePath: 'clean.ts',
        sourceCode: `trail("greet", { run: (input) => Result.ok({ message: input.name }) });`,
      },
      expectValue: { diagnostics: [] },
    },
    {
      description: 'throw in run detected',
      input: {
        filePath: 'bad.ts',
        sourceCode: `trail("greet", { run: (input) => { throw new Error("bad"); } });`,
      },
      expectOk: true,
      // diagnostics array should have length > 0 — use a custom assertion if needed
    },
  ]);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/warden && bun test trails`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Convert `noThrowInImplementation` rule to a trail**

Create `packages/warden/src/trails/no-throw-in-implementation.ts`:

```typescript
import { z } from 'zod';
import { trail } from '@ontrails/core';
import { Result } from '@ontrails/core';
import { ruleInput, ruleOutput } from './schema';

export const noThrowInImplementation = trail('warden.rule.no-throw-in-implementation', {
  input: ruleInput,
  output: ruleOutput,
  intent: 'read',
  metadata: { category: 'governance' },
  examples: [
    {
      name: 'Clean implementation',
      input: {
        filePath: 'clean.ts',
        sourceCode: 'trail("greet", { run: (input) => Result.ok({ message: input.name }) });',
      },
      expected: { diagnostics: [] },
    },
  ],
  run: (input) => {
    // Port the existing rule logic from packages/warden/src/rules/no-throw-in-implementation.ts
    // The existing check function takes (sourceCode, filePath) and returns WardenDiagnostic[]
    // Adapt to return Result<RuleOutput, Error>
    const { check } = require('../rules/no-throw-in-implementation');
    const diagnostics = check(input.sourceCode, input.filePath);
    return Result.ok({
      diagnostics: diagnostics.map((d: any) => ({
        rule: d.rule,
        severity: d.severity,
        message: d.message,
        line: d.line,
      })),
    });
  },
});
```

**Important:** Don't rewrite the rule logic. Wrap the existing `check` function. This keeps the refactor safe — logic stays the same, only the interface changes.

- [ ] **Step 5: Create the barrel and convert remaining rules**

Create `packages/warden/src/trails/index.ts` that re-exports all rule trails. Repeat the pattern from Step 4 for all 11 rules, wrapping each existing `check` function.

The pattern for each rule trail:

1. Import the existing rule's `check` function
2. Wrap it in a trail with `ruleInput`/`ruleOutput` schemas
3. Add at least one example per rule (clean input → empty diagnostics)
4. Export from the barrel

For `ProjectAwareWardenRule` rules (like `followDeclarations`), extend the input schema:

```typescript
export const projectAwareRuleInput = ruleInput.extend({
  projectRoot: z.string().describe('Project root directory'),
});
```

- [ ] **Step 6: Create the warden topo**

Create `packages/warden/src/trails/topo.ts`:

```typescript
import { topo } from '@ontrails/core';
import * as rules from './index';

export const wardenTopo = topo('warden', rules);
```

- [ ] **Step 7: Update `runWarden` to use dispatch**

In the main warden runner (wherever `runWarden` lives), add an option to use the trail-based rules via `dispatch`:

```typescript
import { dispatch } from '@ontrails/core';
import { wardenTopo } from './trails/topo';

export const runWardenTrails = async (
  filePath: string,
  sourceCode: string
): Promise<WardenDiagnostic[]> => {
  const allDiagnostics: WardenDiagnostic[] = [];
  for (const id of wardenTopo.ids()) {
    const result = await dispatch(wardenTopo, id, { filePath, sourceCode });
    if (result.isOk()) {
      allDiagnostics.push(...(result.value as { diagnostics: WardenDiagnostic[] }).diagnostics);
    }
  }
  return allDiagnostics;
};
```

Keep the existing function-based `runWarden` working alongside the trail-based one for backward compatibility.

- [ ] **Step 8: Add `testAll` for the warden topo**

Add to `packages/warden/src/__tests__/trails.test.ts`:

```typescript
import { testAll } from '@ontrails/testing';
import { wardenTopo } from '../trails/topo';

testAll(wardenTopo);
```

This validates all rule trail examples + contracts in one line.

- [ ] **Step 9: Run all tests**

Run: `cd packages/warden && bun test`
Expected: All existing rule tests still pass. New trail-based tests also pass.

- [ ] **Step 10: Run full checks**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: All green.

- [ ] **Step 11: Commit**

```bash
gt create trl-38-dogfood-warden -am "refactor(warden): refactor rules as composable trails with examples [TRL-38]"
```

---

## Post-Stack Steps

After all 10 branches are created:

- [ ] **Submit the full stack**

```bash
gt top && gt submit --stack --draft --no-interactive
```

- [ ] **Update Linear issues to In Progress / Done as PRs land**

- [ ] **Post project update**

Post a status update on the Linear project with health `onTrack` and a summary of what shipped.
