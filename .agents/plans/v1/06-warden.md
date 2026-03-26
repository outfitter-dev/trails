# Stage 06 — @ontrails/warden

> The governance package that keeps agents on trails. Lint rules, drift checks, and CI gating.

---

## Overview

Warden enforces contract-first discipline at development time. It ships early because agents building with Trails need guardrails from day one. Without warden, the first agent-generated trail will `throw` instead of returning `Result.err()`, put surface types in the implementation, and let `follows` declarations drift.

The package provides:

1. An **oxlint plugin** with 11 Trails-specific lint rules.
2. A **`trails warden` CLI command** that runs lint checks + surface.lock drift detection.
3. **Integration with lefthook** for pre-push enforcement.

---

## Prerequisites

- **Stage 01 complete** -- `@ontrails/core` ships `trail()`, `route()`, `trailhead()`, `Result`, error taxonomy.
- **Stage 02 complete** -- `@ontrails/cli` ships `buildCliCommands()` and the Commander adapter.
- **Stage 07 complete** -- `@ontrails/schema` ships `generateSurfaceMap()`, `hashSurfaceMap()`, `readSurfaceLock()` (warden uses these for drift detection).

**Note on ordering:** The PLAN.md lists warden as stage 06 and schema as stage 07, but warden depends on schema for drift detection. Options: (a) implement schema first, then warden; (b) implement warden's lint rules first (no schema dependency), then add drift detection after schema ships. Option (b) is recommended -- the lint rules are the highest-value deliverable and are independent of schema.

---

## Implementation Guide

### Package Setup

```
packages/warden/
  package.json
  tsconfig.json
  src/
    index.ts                        # Public API
    cli.ts                          # trails warden command
    drift.ts                        # Surface lock drift detection
    rules/
      index.ts                      # Rule registry
      no-throw-in-implementation.ts
      context-no-surface-types.ts
      require-output-schema.ts
      prefer-schema-inference.ts
      examples-match-schema.ts
      follows-matches-calls.ts
      no-recursive-follows.ts
      follows-trails-exist.ts
      valid-describe-refs.ts
      valid-detour-refs.ts
      no-direct-impl-in-route.ts
    __tests__/
      rules/
        no-throw-in-implementation.test.ts
        context-no-surface-types.test.ts
        require-output-schema.test.ts
        prefer-schema-inference.test.ts
        examples-match-schema.test.ts
        follows-matches-calls.test.ts
        no-recursive-follows.test.ts
        follows-trails-exist.test.ts
        valid-describe-refs.test.ts
        valid-detour-refs.test.ts
        no-direct-impl-in-route.test.ts
      cli.test.ts
      drift.test.ts
```

**package.json:**

```json
{
  "name": "@ontrails/warden",
  "exports": {
    ".": "./src/index.ts"
  },
  "peerDependencies": {
    "@ontrails/core": "workspace:*",
    "@ontrails/schema": "workspace:*"
  }
}
```

### oxlint Plugin Setup

oxlint supports custom plugins via the plugin API. The Trails warden plugin registers rules under the `trails/` namespace.

**Plugin registration:**

```typescript
// src/rules/index.ts
export const trailsPlugin = {
  name: "trails",
  rules: {
    "no-throw-in-implementation": noThrowInImplementation,
    "context-no-surface-types": contextNoSurfaceTypes,
    "require-output-schema": requireOutputSchema,
    "prefer-schema-inference": preferSchemaInference,
    "examples-match-schema": examplesMatchSchema,
    "follows-matches-calls": followsMatchesCalls,
    "no-recursive-follows": noRecursiveFollows,
    "follows-trails-exist": followsTrailsExist,
    "valid-describe-refs": validDescribeRefs,
    "valid-detour-refs": validDetourRefs,
    "no-direct-impl-in-route": noDirectImplInRoute,
  },
};
```

**oxlint config (`.oxlintrc.json`):**

```json
{
  "plugins": ["trails"],
  "rules": {
    "trails/no-throw-in-implementation": "error",
    "trails/context-no-surface-types": "error",
    "trails/require-output-schema": "warn",
    "trails/prefer-schema-inference": "warn",
    "trails/examples-match-schema": "error",
    "trails/follows-matches-calls": "error",
    "trails/no-recursive-follows": "error",
    "trails/follows-trails-exist": "error",
    "trails/valid-describe-refs": "warn",
    "trails/valid-detour-refs": "error",
    "trails/no-direct-impl-in-route": "warn"
  }
}
```

### Lint Rules -- Implementation Notes

#### `trails/no-throw-in-implementation`

**Severity:** error

**What it catches:** `throw` statements inside `implementation` function bodies in `trail()` or `route()` calls.

**Detection strategy:**
1. Find calls to `trail(id, spec)` or `route(id, spec)`.
2. Locate the `implementation` property in the spec object literal.
3. Walk the AST of the implementation function body.
4. Flag any `ThrowStatement` node.

**Fix suggestion:** Replace `throw new SomeError(msg)` with `return Result.err(new SomeError(msg))`.

**Edge cases:**
- `throw` inside a `try/catch` within the implementation (for catching third-party library throws) is acceptable. The rule should flag the `throw` but an inline `// eslint-disable-next-line trails/no-throw-in-implementation` can suppress it.
- `throw` in utility functions called from the implementation is not caught (cross-function analysis is out of scope for a lint rule). Warden focuses on the implementation body itself.

#### `trails/context-no-surface-types`

**Severity:** error

**What it catches:** Imports of surface-specific types (`Request`, `Response`, `McpSession`, `McpCallToolRequest`, `IncomingMessage`, `ServerResponse`) within files that define trail implementations.

**Detection strategy:**
1. Check import declarations in files containing `trail()` or `route()` calls.
2. Flag imports from surface-specific modules: `express`, `hono`, `fastify`, `@modelcontextprotocol/sdk`, `node:http`, etc.
3. Also flag imports of specific type names: `Request`, `Response`, `NextFunction`, `McpSession`.

**Why:** Implementations are pure functions. They receive `TrailContext`, not surface-specific request objects. Importing surface types in the implementation file couples the domain logic to a specific transport.

#### `trails/require-output-schema`

**Severity:** warn

**What it catches:** Trails that are blazed on MCP or HTTP surfaces but don't have an `output` schema.

**Detection strategy:**
1. Find `trail(id, spec)` calls.
2. Check if the spec has a `surfaces` property that includes `"mcp"` or `"http"`.
3. If no `output` property exists on the spec, warn.

**Why:** MCP tools and HTTP endpoints without output schemas can't be used for SDK generation, contract testing, or agent planning. CLI-only trails can get away without output schemas (the output is for humans).

#### `trails/prefer-schema-inference`

**Severity:** warn

**What it catches:** Manual flag declarations in `cli.options` that duplicate what the Zod input schema already describes.

**Detection strategy:**
1. Find `trail(id, spec)` calls with both `input` (Zod schema) and `cli.options`.
2. Compare the field names in `cli.options` against the top-level keys of the Zod schema.
3. Warn on fields that appear in both -- the CLI adapter already derives flags from the Zod schema.

**Fix suggestion:** Remove the manual `cli.options` entry and let the schema drive flag derivation.

#### `trails/examples-match-schema`

**Severity:** error

**What it catches:** Examples with inputs that don't parse against the trail's input schema, or outputs that don't parse against the output schema.

**Detection strategy:**
1. Find `trail(id, spec)` calls with `examples`.
2. For each example, statically analyze the input object literal against the Zod schema definition (where feasible).
3. For simpler schemas (object with literal keys), verify required keys are present in the example input.

**Limitations:** Full Zod validation at lint time requires runtime evaluation. The lint rule performs structural checks (key presence, obvious type mismatches). `testAllExamples()` from `@ontrails/testing` performs full runtime validation.

#### `trails/follows-matches-calls`

**Severity:** error

**What it catches:** Mismatch between a route's `follows` declaration and its `ctx.follow()` calls.

**Detection strategy:**
1. Find `route(id, spec)` calls with a `follows` array.
2. Walk the implementation body for `ctx.follow("trailId", ...)` calls.
3. Collect all trail IDs from `ctx.follow()` calls.
4. Compare against the `follows` array:
   - IDs in `follows` but not in `ctx.follow()` calls -> warn (declared but unused).
   - IDs in `ctx.follow()` calls but not in `follows` -> error (undeclared dependency).

#### `trails/no-recursive-follows`

**Severity:** error

**What it catches:** Cycles in the `follows` graph.

**Detection strategy:**
1. Collect all `route(id, spec)` calls in the project.
2. Build a directed graph from route ID -> follows IDs.
3. Run cycle detection (DFS with back-edge detection).
4. Report the cycle path if found: `Route "a" follows "b" follows "c" follows "a" -- cycle detected`.

**Note:** This requires cross-file analysis. The rule can either:
- Operate within a single file (catching self-referential follows).
- Use a project-level analysis pass (catching cross-file cycles). Prefer the project-level approach if the oxlint plugin API supports it; fall back to single-file with a note that cross-file cycles are caught by `trails warden` at runtime.

#### `trails/follows-trails-exist`

**Severity:** error

**What it catches:** Trail IDs in `follows` arrays that don't correspond to any defined trail.

**Detection strategy:**
1. Collect all trail IDs from `trail(id, ...)` and `route(id, ...)` calls in the project.
2. For each `route(id, spec)` with `follows`, check that every ID in `follows` exists in the collected set.
3. Flag missing IDs: `Route "entity.onboard" follows "entity.relate" which is not defined`.

**Same cross-file note as above.**

#### `trails/valid-describe-refs`

**Severity:** warn

**What it catches:** `@see` tags in `.describe()` strings that reference trail IDs not in the topo.

**Detection strategy:**
1. Find `.describe()` calls on Zod schemas within `trail()` specs.
2. Parse `@see trailId` patterns from the description string.
3. Cross-reference against known trail IDs.

#### `trails/valid-detour-refs`

**Severity:** error

**What it catches:** Detour target trail IDs that don't exist.

**Detection strategy:**
1. Find `trail(id, spec)` calls with `detours`.
2. Collect all target trail IDs from the detour declarations.
3. Cross-reference against known trail IDs.

#### `trails/no-direct-impl-in-route`

**Severity:** warn

**What it catches:** Routes that call another trail's `.implementation()` method directly instead of using `ctx.follow()`.

**Detection strategy:**
1. Find `route(id, spec)` calls.
2. Walk the implementation body for property access patterns like `someTrail.implementation(...)`.
3. Warn: `Use ctx.follow("trailId", input) instead of direct .implementation() calls. ctx.follow() validates input and propagates tracing.`

### `trails warden` CLI Command

The warden CLI command runs all governance checks in one invocation:

```bash
# Run all checks
trails warden

# Run with exit code for CI gating
trails warden --exit-code

# Run only lint rules (skip drift)
trails warden --lint-only

# Run only drift checks (skip lint)
trails warden --drift-only
```

**What `trails warden` does:**

1. **Lint pass** -- Run oxlint with the trails plugin. Collect results.
2. **Drift detection** -- Compare the committed `surface.lock` against a freshly generated surface map hash (using `@ontrails/schema`). Report if they differ.
3. **Report** -- Print a summary:

```
Warden Report
=============

Lint: 2 errors, 3 warnings
  src/trails/entity.ts:15  trails/no-throw-in-implementation  throw in implementation
  src/trails/search.ts:42  trails/follows-trails-exist         "analytics" not found

Drift: surface.lock is stale (regenerate with `trails survey generate`)

Result: FAIL (2 errors, drift detected)
```

**`--exit-code`** returns non-zero if any errors or drift is detected. Warnings alone do not cause a non-zero exit.

**Implementation:**

```typescript
// src/cli.ts
import { command } from "@ontrails/cli/command";

export const wardenCommand = command("warden")
  .description("Run governance checks -- lint rules and drift detection")
  .input(z.object({
    exitCode: z.boolean().default(false),
    lintOnly: z.boolean().default(false),
    driftOnly: z.boolean().default(false),
  }))
  .readOnly(true)
  .action(async ({ input }) => {
    const results = { lint: null, drift: null };

    if (!input.driftOnly) {
      results.lint = await runLint();
    }

    if (!input.lintOnly) {
      results.drift = await checkDrift();
    }

    printReport(results);

    if (input.exitCode && (results.lint?.errors > 0 || results.drift?.stale)) {
      process.exit(1);
    }
  })
  .build();
```

### Drift Detection

```typescript
// src/drift.ts
import { generateSurfaceMap, hashSurfaceMap, readSurfaceLock } from "@ontrails/schema";

export interface DriftResult {
  readonly stale: boolean;
  readonly committedHash: string | null;
  readonly currentHash: string;
}

export async function checkDrift(app: TrailsApp): Promise<DriftResult> {
  const surfaceMap = generateSurfaceMap(app.topo);
  const currentHash = hashSurfaceMap(surfaceMap);
  const committedHash = await readSurfaceLock();

  return {
    stale: committedHash !== currentHash,
    committedHash,
    currentHash,
  };
}
```

### Integration with Lefthook

Add warden to the pre-push hook in `lefthook.yml`:

```yaml
pre-push:
  commands:
    warden:
      run: trails warden --exit-code
      tags: governance
```

This ensures no code is pushed with lint errors or stale `surface.lock`. The pre-push hook is the enforcement point; developers can run `trails warden` manually at any time.

### Warden Rules as `.claude/rules/`

Surface the warden rules as Claude Code rules so agents internalize the patterns before warden enforces them:

```markdown
<!-- .claude/rules/trails-conventions.md -->

# Trails Conventions

- Implementations return `Result.err()`, never `throw`.
- Don't import surface types (Request, Response, McpSession) in implementation files.
- Routes use `ctx.follow()`, not direct `.implementation()` calls.
- Every trail with `follows` must declare all followed trail IDs.
- Every trail on MCP or HTTP should have an `output` schema.
- Examples must have valid input for their trail's schema.
- Detour targets must point to trails that exist in the topo.
```

---

## Testing Requirements

Each lint rule needs tests with valid and invalid code samples.

### Rule Tests (per rule)

Each rule test file follows the same pattern:

```typescript
// __tests__/rules/no-throw-in-implementation.test.ts
import { ruleTester } from "../helpers.js";
import { noThrowInImplementation } from "../../rules/no-throw-in-implementation.js";

ruleTester.run("trails/no-throw-in-implementation", noThrowInImplementation, {
  valid: [
    // Implementation returning Result.err()
    `trail("entity.show", {
      implementation: async (input, ctx) => {
        return Result.err(new NotFoundError("not found"));
      }
    })`,
    // throw outside implementation (not flagged)
    `function helper() { throw new Error("boom"); }`,
  ],
  invalid: [
    {
      code: `trail("entity.show", {
        implementation: async (input, ctx) => {
          throw new Error("boom");
        }
      })`,
      errors: [{ messageId: "noThrow" }],
    },
  ],
});
```

**Coverage per rule:**

- `no-throw-in-implementation`: throw in trail impl (error), throw outside impl (valid), Result.err (valid).
- `context-no-surface-types`: import Request from express (error), import from @ontrails/core (valid).
- `require-output-schema`: MCP trail without output (warn), CLI-only trail without output (valid), trail with output (valid).
- `prefer-schema-inference`: manual flag matching Zod key (warn), manual flag not in Zod (valid).
- `examples-match-schema`: example missing required key (error), example with all keys (valid).
- `follows-matches-calls`: follow call not in follows array (error), all calls declared (valid), declared but unused (warn).
- `no-recursive-follows`: self-referential follows (error), non-cyclic follows (valid).
- `follows-trails-exist`: follows ID not defined (error), all IDs exist (valid).
- `valid-describe-refs`: @see with missing trail (warn), @see with existing trail (valid).
- `valid-detour-refs`: detour target missing (error), all targets exist (valid).
- `no-direct-impl-in-route`: direct .implementation() call (warn), ctx.follow() call (valid).

### `cli.test.ts`

- `trails warden` runs and produces a report.
- `--exit-code` returns non-zero on errors.
- `--exit-code` returns zero when clean.
- `--lint-only` skips drift check.
- `--drift-only` skips lint.

### `drift.test.ts`

- `checkDrift` returns `stale: false` when hashes match.
- `checkDrift` returns `stale: true` when hashes differ.
- Missing `surface.lock` is treated as stale.

---

## Definition of Done

- [ ] oxlint plugin with all 11 rules under the `trails/` namespace.
- [ ] Each rule has valid and invalid test cases.
- [ ] `trails warden` CLI command runs lint + drift checks and prints a summary report.
- [ ] `trails warden --exit-code` returns non-zero on errors or drift.
- [ ] Drift detection compares committed `surface.lock` against freshly generated hash.
- [ ] Lefthook pre-push integration documented and configured.
- [ ] `.claude/rules/trails-conventions.md` surfaces the rules for agents.
- [ ] All tests pass.
- [ ] Rule severity defaults are sensible: safety rules are errors, style rules are warnings.
