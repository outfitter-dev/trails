# CLI Trailhead

The CLI trailhead connector turns every trail into a command. Flags are
derived from faithfully representable Zod schema fields, and structured JSON
channels are available when the input shape is richer than flags can express
honestly. Output formatting, error handling, and exit codes are handled
automatically.

## Setup

```bash
bun add @ontrails/cli
bun add commander  # required for the /commander subpath
```

```typescript
import { trailhead } from '@ontrails/cli/commander';
import { app } from './app';

trailhead(app);
```

That is the entire CLI setup. Every trail in the app becomes a command.

## How Trail IDs Map to Commands

Trail IDs derive to full ordered command paths:

| Trail ID      | CLI command         |
| ------------- | ------------------- |
| `greet`       | `myapp greet`       |
| `entity.show` | `myapp entity show` |
| `entity.add`  | `myapp entity add`  |
| `math.add`    | `myapp math add`    |
| `topo.pin`    | `myapp topo pin`    |

Each dot becomes another command-path segment. A path node may be both
executable and a parent, so `myapp topo` and `myapp topo pin` can coexist
naturally.

The CLI model is validated before adapter wiring. Duplicate command paths are
rejected, and executable parents cannot also declare positional args if child
commands exist beneath that path.

## Flag Derivation

Flags are derived from the trail's Zod input schema when the shape can be
represented truthfully on the command line. No manual flag configuration
needed.

| Zod type | CLI flag | Example |
| --- | --- | --- |
| `z.string()` | `--name <value>` | Required string |
| `z.number()` | `--count <value>` | Required number |
| `z.boolean()` | `--verbose` | Boolean switch |
| `z.enum(["a", "b"])` | `--format <value>` | With `.choices()` |
| `z.array(z.string())` | `--tag <values...>` | Repeatable: `--tag a --tag b` |
| `z.optional(z.string())` | `--name [value]` | Optional |
| `z.string().default("x")` | `--name [value]` | With default |

**Name conversion:** `camelCase` field names become `--kebab-case` flags. `sortOrder` becomes `--sort-order`.

**Descriptions:** `.describe("text")` on Zod fields becomes the flag help text.

Nested objects and arrays of objects are intentionally omitted from automatic
flag derivation. The CLI prefers fewer flags over dishonest flags.

```typescript
const search = trail('search', {
  input: z.object({
    query: z.string().describe('Search query'),
    limit: z.number().default(10).describe('Max results'),
    format: z.enum(['json', 'table']).default('json'),
  }),
  // ...
});
```

Produces:

```text
Options:
  --query <value>   Search query
  --limit [value]   Max results (default: 10)
  --format <value>  (choices: "json", "table", default: "json")
```

## Structured Input

Every non-empty object input schema also gets three structured input channels:

- `--input-json <json>` to pass the full input object inline
- `--input-file <path>` to load the full input object from a JSON file
- `--stdin` to read the full input object as JSON from stdin

These channels merge into one final input object before validation:

1. Structured input payload
2. Positional args
3. Explicit CLI flags
4. Interactive prompting for any remaining missing values

Explicit args and flags always win on conflict. Validation still happens once,
against the original trail schema, after the merge.

```bash
myapp gist create \
  --input-json '{"files":[{"filename":"README.md","content":"Hello"}]}'
```

```bash
cat payload.json | myapp gist create --stdin
```

When a schema includes fields that cannot be expressed truthfully as flags, the
command help still shows the structured input options so the escape hatch stays
discoverable.

## Flag Presets

Reusable flag sets for common patterns:

### Output Mode

```typescript
import { outputModePreset } from '@ontrails/cli';
```

Adds `--output <mode>` (`text`, `json`, `jsonl`), `--json`, and `--jsonl` flags.

### Working Directory

```typescript
import { cwdPreset } from '@ontrails/cli';
```

Adds `--cwd <path>` flag.

### Dry Run

```typescript
import { dryRunPreset } from '@ontrails/cli';
```

Adds `--dry-run` flag. Automatically added for trails with `intent: 'destroy'`.

## Output Formatting

The `output()` function writes values to stdout in the specified format:

```typescript
import { output, resolveOutputMode } from '@ontrails/cli';

await output({ name: 'Alpha' }, 'json'); // Pretty JSON to stdout
await output(items, 'jsonl'); // One JSON line per item
await output('Hello', 'text'); // Plain text
```

### Output Mode Resolution

`resolveOutputMode(flags)` determines the format from flags and environment:

1. `--json` flag (highest priority)
2. `--jsonl` flag
3. `--output <mode>` flag
4. `TRAILS_JSON=1` env var
5. `TRAILS_JSONL=1` env var
6. Default: `"text"`

## Error Handling

When a trail returns `Result.err()`, the Commander connector maps the error category to an exit code:

| Category     | Exit code |
| ------------ | --------- |
| `validation` | 1         |
| `not_found`  | 2         |
| `conflict`   | 3         |
| `permission` | 4         |
| `timeout`    | 5         |
| `rate_limit` | 6         |
| `network`    | 7         |
| `internal`   | 8         |
| `auth`       | 9         |
| `cancelled`  | 130       |

The error message is written to stderr. Non-`TrailsError` errors default to exit code 8 (internal).

## Custom Result Handling

Override the default result handler for custom formatting, logging, or metrics:

```typescript
import { trailhead } from '@ontrails/cli/commander';
import { output, resolveOutputMode } from '@ontrails/cli';

trailhead(app, {
  onResult: async (ctx) => {
    if (ctx.result.isErr()) {
      console.error(`Failed: ${ctx.trail.id}`);
      throw ctx.result.error;
    }
    const { mode } = resolveOutputMode(ctx.flags);
    await output(ctx.result.value, mode);
  },
});
```

## Built-in Layers

### `autoIterateLayer`

For trails with paginated output (matching the pagination pattern from `@ontrails/core/patterns`), adds an `--all` flag. When set, the layer repeatedly calls the implementation with incrementing cursors and collects all items.

### `dateShortcutsLayer`

For trails with `since`/`until` date fields, expands shortcut strings:

- `"today"` -> today's date range
- `"yesterday"` -> yesterday's date range
- `"7d"` -> last 7 days
- `"30d"` -> last 30 days
- `"this-week"` -> current week
- `"this-month"` -> current month

## The Two-Level Architecture

`@ontrails/cli` is framework-agnostic. It produces a `CliCommand[]` model that any CLI framework can consume. The `/commander` subpath connects that model to Commander specifically.

```typescript
// Framework-agnostic: build the model
import { buildCliCommands } from '@ontrails/cli';
const commands = buildCliCommands(app);

// Framework-specific: adapt to Commander
import { toCommander } from '@ontrails/cli/commander';
const program = toCommander(commands, { name: 'myapp' });
program.parse();
```

Or use `trailhead()` which does both in one call:

```typescript
import { trailhead } from '@ontrails/cli/commander';
trailhead(app);
```

To use a different CLI framework (yargs, oclif, etc.), consume `CliCommand[]`
directly and write your own connector. The model carries everything needed: a
full ordered command path, flags, args, and an `execute()` function.
