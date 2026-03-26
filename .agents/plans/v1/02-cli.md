# Stage 02 -- CLI Surface (`@ontrails/cli`)

> The CLI surface adapter. Framework-agnostic command model, flag derivation from Zod schemas, output formatting, layer composition. Plus the `/commander` subpath that adapts the model to Commander and provides the `blaze()` one-liner.

---

## Prerequisites

- Stage 00 complete (monorepo scaffolded)
- Stage 01 complete (`@ontrails/core` implemented and tested)

---

## 1. Package Setup

### 1.1 Structure

```
packages/cli/
├── src/
│   ├── index.ts                  # Main barrel: CliCommand, buildCliCommands, output, flags
│   ├── command.ts                # CliCommand model
│   ├── build.ts                  # buildCliCommands()
│   ├── flags.ts                  # Flag derivation + presets
│   ├── output.ts                 # output(), resolveOutputMode()
│   ├── on-result.ts              # onResult callback, defaultOnResult
│   ├── layers.ts                 # CLI-specific layers
│   ├── commander/
│   │   ├── index.ts              # /commander subpath barrel
│   │   ├── to-commander.ts       # toCommander()
│   │   └── blaze.ts              # blaze()
│   └── __tests__/
│       ├── command.test.ts
│       ├── build.test.ts
│       ├── flags.test.ts
│       ├── output.test.ts
│       ├── on-result.test.ts
│       ├── layers.test.ts
│       ├── to-commander.test.ts
│       └── blaze.test.ts
├── package.json
└── tsconfig.json
```

### 1.2 `package.json`

```json
{
  "name": "@ontrails/cli",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./commander": "./src/commander/index.ts"
  },
  "dependencies": {
    "@ontrails/core": "workspace:*"
  },
  "peerDependencies": {
    "commander": "^13.0.0",
    "zod": "catalog:"
  },
  "peerDependenciesMeta": {
    "commander": {
      "optional": true
    }
  },
  "scripts": {
    "build": "tsc -b",
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist *.tsbuildinfo"
  }
}
```

`commander` is an optional peer dependency -- only required if you use the `/commander` subpath. The main `@ontrails/cli` export is framework-agnostic.

---

## 2. CliCommand Model

**File:** `src/command.ts`

### 2.1 `CliCommand` interface

A framework-agnostic representation of a CLI command. This is the intermediate model that `buildCliCommands()` produces and framework adapters (Commander, yargs, etc.) consume.

```typescript
interface CliCommand {
  readonly name: string;              // Command name (e.g., "entity-show")
  readonly description?: string;
  readonly group?: string;            // Parent group for subcommand nesting (e.g., "entity")
  readonly flags: CliFlag[];          // Derived from Zod schema + presets
  readonly args: CliArg[];            // Positional arguments (if any)
  readonly trail: Trail;              // Reference to the trail spec
  readonly layers?: Layer[];          // CLI-specific layers to apply
  readonly readOnly?: boolean;
  readonly destructive?: boolean;
  readonly idempotent?: boolean;

  execute(
    parsedArgs: Record<string, unknown>,
    parsedFlags: Record<string, unknown>,
    ctx?: Partial<TrailContext>,
  ): Promise<Result<unknown, Error>>;
}
```

### 2.2 `CliFlag` interface

```typescript
interface CliFlag {
  readonly name: string;              // Long flag name (e.g., "output")
  readonly short?: string;            // Short alias (e.g., "o")
  readonly description?: string;
  readonly type: "string" | "number" | "boolean" | "string[]" | "number[]";
  readonly required: boolean;
  readonly default?: unknown;
  readonly choices?: string[];        // From z.enum()
  readonly variadic: boolean;         // From z.array()
}
```

### 2.3 `CliArg` interface

```typescript
interface CliArg {
  readonly name: string;
  readonly description?: string;
  readonly required: boolean;
  readonly variadic: boolean;
}
```

### 2.4 Tests

- CliCommand interface is structurally correct
- CliFlag captures all derivable metadata
- Group field enables subcommand nesting

---

## 3. Flag Derivation from Zod Schemas

**File:** `src/flags.ts`

### 3.1 `deriveFlags(schema)` function

Derives CLI flags from a trail's Zod input schema:

```typescript
function deriveFlags(schema: z.ZodType): CliFlag[];
```

**Derivation rules:**

| Zod type | Flag type | Notes |
|----------|-----------|-------|
| `z.string()` | `string` | |
| `z.number()` | `number` | |
| `z.boolean()` | `boolean` | |
| `z.enum([...])` | `string` with `choices` | Choices populated from enum values |
| `z.array(z.string())` | `string[]` | `variadic: true` |
| `z.array(z.number())` | `number[]` | `variadic: true` |
| `z.optional(...)` | same, `required: false` | |
| `z.default(...)` | same, `required: false`, `default` populated | |
| `z.describe("...")` | adds `description` from `.describe()` | |

**Name conversion:**

- Zod field name `camelCase` -> flag name `--kebab-case`
- Example: `sortOrder` -> `--sort-order`

**z.array() handling (variadic flags):**

When a Zod schema field is `z.array(z.string())` or `z.array(z.number())`:

- The flag is marked `variadic: true`
- The flag type is `"string[]"` or `"number[]"`
- Commander adapter renders these as repeatable flags: `--tag foo --tag bar`

### 3.2 Flag presets

Reusable flag sets that trails can attach:

```typescript
function outputModePreset(): CliFlag[];
```

Returns flags for output mode selection:

- `--output <mode>` / `-o` -- choices: `["text", "json", "jsonl"]`, default: `"text"`
- `--json` -- shorthand for `--output json`
- `--jsonl` -- shorthand for `--output jsonl`

```typescript
function cwdPreset(): CliFlag[];
```

Returns:

- `--cwd <path>` -- working directory override

```typescript
function dryRunPreset(): CliFlag[];
```

Returns:

- `--dry-run` -- execute without side effects (boolean, default false)

Presets are arrays of `CliFlag` objects that get merged with schema-derived flags. Schema-derived flags take precedence on name collision.

### 3.3 Tests

- `z.string()` derives a string flag
- `z.number()` derives a number flag
- `z.boolean()` derives a boolean flag
- `z.enum()` derives a string flag with choices
- `z.array(z.string())` derives a variadic string[] flag
- `z.optional()` sets `required: false`
- `z.default()` sets `required: false` and populates `default`
- `.describe()` populates flag description
- camelCase field names convert to kebab-case flag names
- `outputModePreset()` returns --output, --json, --jsonl flags
- `cwdPreset()` returns --cwd flag
- `dryRunPreset()` returns --dry-run flag

---

## 4. `buildCliCommands(app, options?)`

**File:** `src/build.ts`

### 4.1 Function signature

```typescript
function buildCliCommands(
  app: App,
  options?: BuildCliCommandsOptions,
): CliCommand[];

interface BuildCliCommandsOptions {
  onResult?: (ctx: ActionResultContext) => Promise<void>;
  createContext?: () => TrailContext | Promise<TrailContext>;
  layers?: Layer[];
  presets?: CliFlag[][];        // Additional flag presets to add to all commands
}
```

### 4.2 What it does, step by step

1. **Iterate the topo** -- loop through `app.topo.list()` to get all trails and routes.

2. **Derive command name** -- Convert trail ID to CLI command name:
   - `entity.show` -> command `show` in group `entity`
   - `search` -> top-level command `search`
   - Dot notation creates group/subcommand structure.

3. **Derive flags** -- Call `deriveFlags(trail.input)` to get schema-derived flags.

4. **Apply presets** -- Merge any preset flags from options.

5. **Add destructive flag** -- If `trail.destructive` is true, auto-add `dryRunPreset()`.

6. **Build execute function** -- Creates a function that:
   a. Merges args + flags into a single input object
   b. Calls `validateInput(trail.input, mergedInput)` from core
   c. Creates or uses provided TrailContext
   d. Applies layers via `composeLayers()`
   e. Calls the implementation
   f. Calls `onResult` if provided (or silently discards the result)
   g. Returns the Result

7. **Group subcommands** -- Trails sharing the same group (first segment of dot-separated ID) are collected under a parent command. `entity.show` and `entity.add` both go under an `entity` parent.

8. **Return CliCommand[]** -- The array of framework-agnostic commands.

### 4.3 `ActionResultContext`

The context passed to the `onResult` callback:

```typescript
interface ActionResultContext {
  readonly trail: Trail;
  readonly args: Record<string, unknown>;
  readonly flags: Record<string, unknown>;
  readonly input: unknown;              // Validated input
  readonly result: Result<unknown, Error>;
}
```

### 4.4 Tests

- Builds commands from a simple app with one trail
- Builds grouped subcommands from dotted trail IDs
- Derives flags from input schema
- Adds --dry-run for destructive trails
- Calls onResult with correct context
- Validates input before calling implementation
- Applies layers in order
- Uses provided createContext factory

---

## 5. Output

**File:** `src/output.ts`

### 5.1 `output(value, mode)`

Writes a value to stdout in the specified format:

```typescript
async function output(
  value: unknown,
  mode: OutputMode,
): Promise<void>;

type OutputMode = "text" | "json" | "jsonl";
```

**Behavior by mode:**

- **`text`**: If the value is a string, write it directly. If it is an object/array, JSON.stringify with 2-space indentation. Write to stdout.
- **`json`**: JSON.stringify with 2-space indentation. Write to stdout.
- **`jsonl`**: If the value is an array, write each element as a JSON line. If it is a single object, write one JSON line. Write to stdout.

Uses `Bun.write(Bun.stdout, ...)` or `process.stdout.write()`.

### 5.2 `resolveOutputMode(flags)`

Determines output mode from parsed CLI flags:

```typescript
function resolveOutputMode(
  flags: Record<string, unknown>,
): { mode: OutputMode };
```

Resolution order (highest wins):

1. `flags.json === true` -> `"json"`
2. `flags.jsonl === true` -> `"jsonl"`
3. `flags.output` as string -> validate against OutputMode
4. `TRAILS_JSON=1` env var -> `"json"`
5. `TRAILS_JSONL=1` env var -> `"jsonl"`
6. Default: `"text"`

### 5.3 Tests

- `output()` writes text to stdout
- `output()` writes JSON with indentation
- `output()` writes JSONL line-by-line for arrays
- `resolveOutputMode()` respects flag priority
- `resolveOutputMode()` falls back to env vars
- `resolveOutputMode()` defaults to text

---

## 6. onResult Callback

**File:** `src/on-result.ts`

### 6.1 `defaultOnResult`

The batteries-included result handler. Resolves output mode from flags and pipes the value through `output()`:

```typescript
async function defaultOnResult(ctx: ActionResultContext): Promise<void>;
```

**What it does:**

1. If `ctx.result.isErr()`: throw the error (let the program's error handler produce the exit code)
2. If `ctx.result.isOk()`:
   a. Call `resolveOutputMode(ctx.flags)` to determine format
   b. Call `output(ctx.result.value, mode)`

### 6.2 Custom onResult

Users can provide their own callback for logging, metrics, custom formatting, etc. The `ActionResultContext` gives them everything they need:

```typescript
async function myOnResult(ctx: ActionResultContext): Promise<void> {
  if (ctx.result.isErr()) {
    logger.error("Trail failed", { trail: ctx.trail.id, error: ctx.result.error });
    throw ctx.result.error;
  }
  logger.info("Trail succeeded", { trail: ctx.trail.id });
  const { mode } = resolveOutputMode(ctx.flags);
  await output(ctx.result.value, mode);
}
```

### 6.3 Tests

- `defaultOnResult` outputs success values in resolved mode
- `defaultOnResult` throws on error results
- Custom onResult receives correct ActionResultContext

---

## 7. Layer Composition for CLI

The CLI surface composes layers from three sources:

1. **Global layers** from `buildCliCommands(app, { layers })` -- apply to all commands
2. **Per-command layers** (future -- when commands can declare their own)
3. **Built-in CLI layers** (see section 9)

Layer composition uses `composeLayers()` from `@ontrails/core`. The CLI adapter calls it when executing a trail:

```
layers (outermost → innermost)
  → validateInput()
    → implementation(input, ctx)
      → Result
    ← Result
  ← Result (possibly transformed by layers)
← output to stdout
```

Layers see the trail spec and can inspect markers (readOnly, destructive, etc.) to adjust behavior.

---

## 8. The `/commander` Subpath

**File:** `src/commander/index.ts`

This subpath adapts the framework-agnostic `CliCommand[]` model to Commander. It requires `commander` as a peer dependency.

### 8.1 `toCommander(commands, options?)`

Converts `CliCommand[]` into a configured Commander program:

```typescript
function toCommander(
  commands: CliCommand[],
  options?: ToCommanderOptions,
): Command;

interface ToCommanderOptions {
  name?: string;          // Program name (default: from package.json or "cli")
  version?: string;       // Program version
  description?: string;
}
```

**What it does step by step:**

1. Create a new `Command` (from `commander`)
2. Set name, version, description from options
3. For each `CliCommand`:
   a. If `command.group` is set, find or create the parent command
   b. Create a `Command` for the trail's command name
   c. Set description
   d. For each `CliFlag`:
      - Add Commander option with correct type handling
      - Boolean flags: `--dry-run` (no argument)
      - String/number flags: `--name <value>` (required) or `--name [value]` (optional)
      - Variadic flags: `--tag <values...>` for `string[]`
      - Enum flags: `.choices()` for constrained values
      - Defaults: `.default()` for defaulted flags
   e. For each `CliArg`:
      - Add as Commander argument
   f. Set `.action()` that:
      - Extracts parsed args and flags from Commander
      - Calls `command.execute(args, flags)`
      - Handles errors (maps TrailsError category to exit code via `exitCodeMap`)
4. Return the configured program

### 8.2 `blaze(app, options?)`

The one-liner convenience that wires everything up:

```typescript
function blaze(app: App, options?: BlazeCliOptions): void;

interface BlazeCliOptions {
  onResult?: (ctx: ActionResultContext) => Promise<void>;
  createContext?: () => TrailContext | Promise<TrailContext>;
  layers?: Layer[];
  name?: string;
  version?: string;
  description?: string;
}
```

**What it does:**

```typescript
function blaze(app: App, options: BlazeCliOptions = {}): void {
  const commands = buildCliCommands(app, {
    onResult: options.onResult ?? defaultOnResult,
    createContext: options.createContext,
    layers: options.layers,
  });

  const program = toCommander(commands, {
    name: options.name ?? app.name,
    version: options.version,
    description: options.description,
  });

  program.parse();
}
```

That is the entire `blaze()` function. It:

1. Builds CliCommands from the app's topo
2. Adapts them to Commander
3. Parses process.argv

**Usage:**

```typescript
import { trailhead } from "@ontrails/core";
import { blaze } from "@ontrails/cli/commander";
import * as entity from "./trails/entity.ts";

const app = trailhead("myapp", entity);
blaze(app);
```

Three lines. Define trails, collect them, blaze on CLI.

### 8.3 Error handling in Commander

When a trail returns `Result.err()`, the Commander adapter:

1. Looks up the exit code from `exitCodeMap` using `error.category`
2. Writes the error message to stderr
3. Calls `process.exit(exitCode)`

For non-TrailsError errors, default to exit code 8 (internal).

### 8.4 Tests

- `toCommander()` creates a Commander program with correct commands
- Grouped commands create parent/subcommand structure
- Flag types map correctly to Commander options
- Variadic flags use `<values...>` syntax
- Enum flags have `.choices()` set
- `blaze()` wires build + commander + parse
- Error handling maps categories to exit codes

---

## 9. CLI-Specific Layers

**File:** `src/layers.ts`

Shipped with `@ontrails/cli` for common CLI patterns.

### 9.1 `autoIterateLayer`

Automatically iterates paginated results and collects them:

```typescript
const autoIterateLayer: Layer;
```

When a trail's output schema matches the pagination output pattern (has `items`, `hasMore`, `nextCursor`), this layer:

1. Checks if `--all` flag is present
2. If so, repeatedly calls the implementation with incrementing cursor
3. Collects all items into a single array
4. Returns the combined result

This layer adds a `--all` boolean flag to commands whose trails have pagination output.

### 9.2 `dateShortcutsLayer`

Expands date shortcut strings into ISO date ranges:

```typescript
const dateShortcutsLayer: Layer;
```

When a trail's input schema has `since`/`until` fields (matching the dateRange pattern), this layer:

1. Checks for shortcut values: `"today"`, `"yesterday"`, `"7d"`, `"30d"`, `"this-week"`, `"this-month"`
2. Expands them into ISO 8601 date strings
3. Passes the expanded input to the implementation

### 9.3 Tests

- `autoIterateLayer` collects paginated results with --all flag
- `autoIterateLayer` passes through when --all is not set
- `autoIterateLayer` ignores non-paginated trails
- `dateShortcutsLayer` expands "today" to correct date range
- `dateShortcutsLayer` expands "7d" to 7-day range
- `dateShortcutsLayer` passes through non-shortcut values

---

## 10. Package Exports Structure

### 10.1 Main barrel (`src/index.ts`)

```typescript
// Command model
export { type CliCommand, type CliFlag, type CliArg } from "./command";

// Build
export { buildCliCommands, type BuildCliCommandsOptions, type ActionResultContext } from "./build";

// Flags
export { deriveFlags, outputModePreset, cwdPreset, dryRunPreset } from "./flags";

// Output
export { output, resolveOutputMode, type OutputMode } from "./output";

// onResult
export { defaultOnResult } from "./on-result";

// Layers
export { autoIterateLayer, dateShortcutsLayer } from "./layers";
```

### 10.2 `/commander` subpath (`src/commander/index.ts`)

```typescript
export { toCommander, type ToCommanderOptions } from "./to-commander";
export { blaze, type BlazeCliOptions } from "./blaze";
```

---

## Testing Requirements

TDD for everything. Tests in `src/__tests__/`.

### Key test scenarios

**build.test.ts** (the critical one):

- Single trail produces a single CliCommand
- Dotted trail ID (`entity.show`) produces grouped subcommand
- Multiple trails in same group share a parent
- Top-level trail (no dot) produces a top-level command
- Destructive trail auto-gets --dry-run flag
- onResult callback is called with full context
- createContext factory is used when provided
- Layers compose correctly around the implementation
- Input validation runs before implementation

**flags.test.ts:**

- Complete Zod type derivation coverage
- Variadic arrays produce `variadic: true`
- Name conversion: camelCase to kebab-case
- Presets return correct flag sets

**output.test.ts:**

- Each output mode formats correctly
- resolveOutputMode priority chain is correct

**to-commander.test.ts:**

- Commander program has correct structure
- Flag types map to Commander option syntax
- Error exit codes match taxonomy

**blaze.test.ts:**

- Smoke test: blaze with a simple app does not throw
- Uses defaultOnResult when none provided

---

## Definition of Done

- [ ] `@ontrails/cli` package exists with main barrel and `/commander` subpath
- [ ] `CliCommand` model is framework-agnostic (no Commander imports in main barrel)
- [ ] `buildCliCommands(app)` produces CliCommand[] from topo
- [ ] Flag derivation handles all common Zod types including `z.array()`
- [ ] `output(value, mode)` writes JSON/text/JSONL to stdout
- [ ] `resolveOutputMode()` resolves from flags, env vars, and defaults
- [ ] `outputModePreset()`, `cwdPreset()`, `dryRunPreset()` return correct flags
- [ ] `defaultOnResult` auto-outputs success, throws on error
- [ ] `toCommander()` adapts CliCommand[] to a Commander program
- [ ] `blaze(app)` is a working one-liner (build + commander + parse)
- [ ] `autoIterateLayer` and `dateShortcutsLayer` ship as built-in CLI layers
- [ ] Commander is an optional peer dependency (not required for main barrel)
- [ ] All tests pass
- [ ] `bun run typecheck` passes
- [ ] `bun run lint` passes
- [ ] Changeset added
- [ ] A minimal end-to-end test: define a trail in core, blaze on CLI, verify stdout output
