# Stage 05 — @ontrails/testing

> Contract-driven testing utilities. Write examples for agent fluency -- get test cases for free.

---

## Overview

`@ontrails/testing` provides testing utilities that harvest what trail definitions already declare. The headline: `testExamples(app, ctx)` -- one line, the entire topo is tested. Every trail, every example, input validation, implementation execution, output validation. If you wrote good examples for agent fluency, you've already written your test suite.

The package also provides `testScenarios()` for custom scenarios, `testContracts()` for output schema verification, `testDetours()` for detour target validation, mock factories, and surface harnesses for CLI and MCP integration testing.

---

## Prerequisites

- **Stage 01 complete** -- `@ontrails/core` ships `trail()`, `hike()`, `event()`, `topo()`, `TrailContext`, `Result`, error taxonomy, and the `examples` field on `Trail`.
- **Stage 02 complete** -- `@ontrails/cli` ships `buildCliCommands()` and the Commander adapter (needed for `createCliHarness`).
- **Stage 03 complete** -- `@ontrails/mcp` ships `buildMcpTools()` and `blaze()` (needed for `createMcpHarness`).
- **Stage 04 complete** -- `@ontrails/logging` ships `createLogger()` (needed for `createTestLogger`).

---

## Implementation Guide

### Package Setup

```text
packages/testing/
  package.json
  tsconfig.json
  src/
    index.ts                  # Public API
    examples.ts               # testExamples
    trail.ts                  # testScenarios
    contracts.ts              # testContracts
    detours.ts                # testDetours
    assertions.ts             # Progressive assertion logic
    context.ts                # createTestContext
    logger.ts                 # createTestLogger
    harness-cli.ts            # createCliHarness
    harness-mcp.ts            # createMcpHarness
    types.ts                  # TestScenario, TestResult, etc.
    __tests__/
      examples.test.ts
      trail.test.ts
      contracts.test.ts
      detours.test.ts
      assertions.test.ts
      context.test.ts
      logger.test.ts
      harness-cli.test.ts
      harness-mcp.test.ts
```

**package.json:**

```json
{
  "name": "@ontrails/testing",
  "exports": {
    ".": "./src/index.ts"
  },
  "peerDependencies": {
    "@ontrails/core": "workspace:*",
    "@ontrails/cli": "workspace:*",
    "@ontrails/mcp": "workspace:*",
    "@ontrails/logging": "workspace:*"
  }
}
```

### `testExamples(app, ctx)` -- The Headline One-Liner

```typescript
export function testExamples(
  app: Topo,
  ctx?: Partial<TrailContext>
): void;
```

Iterates every trail in the topo. For each trail with `examples`, generates a `describe` block with individual `test` calls per example. Uses Bun's test runner API directly (`describe`, `test`, `expect`).

**What it does per example:**

1. **Input validation** -- Parse `example.input` against `trail.input` schema. Fail if input is invalid (the example itself is broken).
2. **Execute implementation** -- Call `trail.implementation(validatedInput, mergedCtx)` where `mergedCtx` is `createTestContext()` merged with the provided `ctx`. This is the normalized runtime function, so tests work the same for sync-authored and async-authored trails.
3. **Progressive assertion** (see below):
   - If `example.expected` is present: assert `result.isOk()` and `result.value` deep-equals `example.expected`.
   - If `example.error` is present: assert `result.isErr()` and `result.error` is an instance of the named error class.
   - If neither: assert `result.isOk()` and, if `trail.output` schema exists, validate `result.value` against it.
4. **Output schema validation** -- If `trail.output` exists and result is ok, validate `result.value` against `trail.output` schema regardless of which assertion tier ran.

**Generated test names:**

```text
describe("entity.show") {
  test("example: Show entity by name") { ... }
  test("example: Entity not found returns NotFoundError") { ... }
}
describe("search") {
  test("example: Basic search") { ... }
}
```

Trails with no examples produce no tests (not a failure -- they just don't participate in example-driven testing).

### `testScenarios(trail, scenarios, ctx)` -- Single Trail Custom Scenarios

```typescript
export interface TestScenario {
  /** Description shown in test output. */
  readonly description?: string;
  /** Input to pass to the implementation. */
  readonly input: unknown;
  /** Assert the result is ok. */
  readonly expectOk?: boolean;
  /** Assert the result value equals this. */
  readonly expectValue?: unknown;
  /** Assert the result is an error of this type. */
  readonly expectErr?: new (...args: unknown[]) => Error;
  /** Assert the result error has this message (substring match). */
  readonly expectErrMessage?: string;
}

export function testScenarios(
  trail: Trail<unknown, unknown>,
  scenarios: readonly TestScenario[],
  ctx?: Partial<TrailContext>
): void;
```

Generates a `describe` block for the trail with one `test` per scenario. This is the escape hatch for edge cases, boundary values, and regression tests that don't belong in `examples` (which are agent-facing documentation).

**Per scenario:**

1. If `trail.input` schema exists, validate `scenario.input` against it. If validation fails and `expectErr` is `ValidationError`, that's a pass (testing invalid input rejection). Otherwise, fail.
2. Execute the implementation. As with `testExamples()`, this always hits the normalized runtime function, so sync-authored trails do not need special handling in tests.
3. Apply assertions based on which `expect*` fields are set:
   - `expectOk: true` -- assert `result.isOk()`.
   - `expectValue` -- assert `result.isOk()` and deep-equal the value.
   - `expectErr` -- assert `result.isErr()` and `instanceof` check.
   - `expectErrMessage` -- assert `result.isErr()` and message contains substring.

### `testContracts(app, ctx)` -- Output Schema Verification

```typescript
export function testContracts(
  app: Topo,
  ctx?: Partial<TrailContext>
): void;
```

For every trail that has both `examples` (with `expected` or schema-only) and an `output` schema:

1. Run each example's input through the implementation.
2. If result is ok, validate `result.value` against `trail.output` schema.
3. On schema parse failure, report which fields are wrong, what's missing, and what was expected (using Zod's error detail via `formatZodIssues()` from `@ontrails/core`).

This catches the compile-time-for-runtime gap. TypeScript checks types at compile time, but the implementation could return `{ name: "foo" }` when the output schema says `{ title: string }`.

### `testDetours(app)` -- Detour Target Validation

```typescript
export function testDetours(app: Topo): void;
```

For every trail in the topo that has `detours`:

1. Collect all target trail IDs from the detour declarations.
2. Verify each target exists in the topo.
3. Fail with a clear message if a target is missing: `Trail "entity.show" has detour target "entity.search" which does not exist in the topo`.

No implementation execution needed -- this is pure structural validation against the topo.

### Progressive Assertion

Three assertion tiers, determined by what the example declares:

#### Full Match (example has `expected`)

```typescript
function assertFullMatch(
  result: Result<unknown, Error>,
  expected: unknown
): void {
  expect(result.isOk()).toBe(true);
  if (result.isOk()) {
    expect(result.value).toEqual(expected);
  }
}
```

#### Schema-Only Match (example has no `expected` and no `error`)

```typescript
function assertSchemaMatch(
  result: Result<unknown, Error>,
  outputSchema: z.ZodType | undefined
): void {
  expect(result.isOk()).toBe(true);
  if (result.isOk() && outputSchema) {
    const parsed = outputSchema.safeParse(result.value);
    if (!parsed.success) {
      throw new Error(
        `Output does not match schema: ${formatZodIssues(parsed.error.issues)}`
      );
    }
  }
}
```

#### Error Match (example has `error`)

```typescript
function assertErrorMatch(
  result: Result<unknown, Error>,
  expectedError: new (...args: unknown[]) => Error,
  expectedMessage?: string
): void {
  expect(result.isErr()).toBe(true);
  if (result.isErr()) {
    expect(result.error).toBeInstanceOf(expectedError);
    if (expectedMessage) {
      expect(result.error.message).toContain(expectedMessage);
    }
  }
}
```

### `createTestContext(overrides?)` -- Mock Context Factory

```typescript
export interface TestContextOptions {
  readonly requestId?: string;
  readonly logger?: Logger;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly signal?: AbortSignal;
}

export function createTestContext(
  overrides?: TestContextOptions
): TrailContext;
```

Creates a `TrailContext` suitable for testing:

- `requestId`: defaults to a deterministic test ID (`"test-request-001"`).
- `logger`: defaults to `createTestLogger()` (captures entries, does not print).
- `cwd`: defaults to `process.cwd()`.
- `env`: defaults to `{ TRAILS_ENV: "test" }`.
- `signal`: defaults to a non-aborted `AbortController` signal.

### `createTestLogger()` -- Logger with Entry Capture

```typescript
export interface TestLogger extends Logger {
  /** All log records captured during the test. */
  readonly entries: readonly LogRecord[];
  /** Clear captured entries. */
  clear(): void;
  /** Find entries matching a predicate. */
  find(predicate: (record: LogRecord) => boolean): readonly LogRecord[];
  /** Assert that at least one entry matches. */
  assertLogged(level: LogLevel, messageSubstring: string): void;
}

export function createTestLogger(options?: {
  level?: LogLevel;
}): TestLogger;
```

The test logger captures all log records in an array instead of writing to console or file. Useful for asserting that implementations log expected messages.

### `createCliHarness(app)` -- CLI Integration Testing

```typescript
export interface CliHarnessOptions {
  readonly app: Topo;
}

export interface CliHarness {
  /** Execute a CLI command string and capture output. */
  run(command: string): Promise<CliHarnessResult>;
}

export interface CliHarnessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Parsed JSON output if --output json was used. */
  readonly json?: unknown;
}

export function createCliHarness(options: CliHarnessOptions): CliHarness;
```

Builds CLI commands from the app's topo using `buildCliCommands()` and the Commander adapter. Executes commands in-process (no subprocess). Captures stdout/stderr via stream interception.

**Usage:**

```typescript
const harness = createCliHarness({ app });
const result = await harness.run('entity show --name Alpha --output json');
expect(result.exitCode).toBe(0);
expect(result.json).toMatchObject({ name: 'Alpha' });
```

### `createMcpHarness(app)` -- MCP Integration Testing

```typescript
export interface McpHarnessOptions {
  readonly app: Topo;
}

export interface McpHarness {
  /** Call an MCP tool by name with arguments. */
  callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<McpHarnessResult>;
}

export interface McpHarnessResult {
  readonly content: unknown;
  readonly isError: boolean;
}

export function createMcpHarness(options: McpHarnessOptions): McpHarness;
```

Builds MCP tools from the app's topo using `buildMcpTools()`. Invokes tools directly (no transport). Returns the MCP tool response.

### `app.forTesting(overrides)` -- Service Replacement

This method lives on the `Topo` type returned by `topo()` (defined in `@ontrails/core`), but the testing package documents and exercises it.

```typescript
interface Topo {
  forTesting(overrides: Record<string, unknown>): Topo;
}
```

Creates a copy of the app with selective service replacement. Override values can be:

- An object with config keys -- real service with test configuration.
- An implementation object -- full mock replacement.
- `"memory"` or `"noop"` -- built-in test doubles.

**Usage:**

```typescript
const testApp = app.forTesting({
  db: { url: 'sqlite://test.db' },
  search: mockSearchService,
  cache: 'memory',
});

testExamples(testApp, createTestContext());
```

### Package Exports Summary

```typescript
// Contract-driven testing
export { testExamples } from './examples.js';
export { testScenarios } from './trail.js';
export { testContracts } from './contracts.js';
export { testDetours } from './detours.js';

// Mock factories
export { createTestContext } from './context.js';
export { createTestLogger } from './logger.js';

// Surface harnesses
export { createCliHarness } from './harness-cli.js';
export { createMcpHarness } from './harness-mcp.js';

// Types
export type {
  TestScenario,
  TestLogger,
  CliHarness,
  CliHarnessResult,
  McpHarness,
  McpHarnessResult,
} from './types.js';
```

---

## Testing Requirements

The testing package needs its own tests -- it's testing infrastructure, not exempt from verification.

### `examples.test.ts`

Create a small in-memory app with 2-3 trails, each with examples covering all three assertion tiers:

- Trail with full-match example (has `expected`): verify exact equality assertion works.
- Trail with schema-only example (no `expected`): verify schema validation runs.
- Trail with error example (`error`): verify error type assertion works.
- Trail with no examples: verify it's skipped without failure.
- Trail with invalid example input (broken example): verify it produces a clear failure.
- Verify `testExamples` generates individual `test` calls with correct names.

### `trail.test.ts`

- `testScenarios` with `expectOk: true` passes when implementation returns ok.
- `testScenarios` with `expectValue` passes on exact match, fails on mismatch.
- `testScenarios` with `expectErr` passes when error type matches, fails on wrong type.
- `testScenarios` with `expectErrMessage` does substring matching.
- `testScenarios` with invalid input and `expectErr: ValidationError` passes.
- Multiple scenarios on one trail produce individual test cases.

### `contracts.test.ts`

- `testContracts` passes when implementation output matches declared schema.
- `testContracts` fails with clear Zod error detail when output doesn't match schema.
- Trails without output schemas are skipped.
- Trails without examples are skipped.

### `detours.test.ts`

- `testDetours` passes when all detour targets exist in the topo.
- `testDetours` fails with trail ID when a target is missing.
- Trails without detours are skipped.

### `assertions.test.ts`

- Full match assertion: passes on equal, fails on different.
- Schema-only assertion: passes when value parses, fails when it doesn't.
- Error match assertion: passes on correct error type, fails on wrong type.
- Error message assertion: substring matching works.

### `context.test.ts`

- `createTestContext()` with no args produces a valid `TrailContext`.
- Overrides are applied correctly.
- Default logger is a `TestLogger`.

### `logger.test.ts`

- `createTestLogger` captures entries.
- `entries` contains all logged records.
- `clear()` empties the entries array.
- `find()` filters entries by predicate.
- `assertLogged()` passes when matching entry exists, fails when it doesn't.
- `child()` returns a test logger that captures to the same entries array.

### `harness-cli.test.ts`

- CLI harness executes a command and captures stdout.
- Exit code 0 on success, non-zero on error.
- `--output json` flag makes `json` field available on result.
- Unknown command produces appropriate exit code.

### `harness-mcp.test.ts`

- MCP harness calls a tool and returns content.
- `isError` is false on success, true on error.
- Unknown tool name produces an error result.

---

## Definition of Done

- [ ] `testExamples(app, ctx)` tests every trail in the topo with one line of code.
- [ ] `testScenarios(trail, scenarios, ctx)` supports custom scenarios with all assertion types.
- [ ] `testContracts(app, ctx)` catches implementation-schema drift with clear Zod error detail.
- [ ] `testDetours(app)` catches stale detour targets.
- [ ] Progressive assertion works: full match, schema-only, and error match all function in `testExamples`.
- [ ] `createTestContext()` produces a valid context with sensible defaults.
- [ ] `createTestLogger()` captures entries and supports `find()` and `assertLogged()`.
- [ ] `createCliHarness()` executes CLI commands in-process and captures output.
- [ ] `createMcpHarness()` invokes MCP tools directly and returns results.
- [ ] `app.forTesting(overrides)` replaces services without module mocking.
- [ ] The testing package itself has comprehensive tests.
- [ ] All tests pass.
