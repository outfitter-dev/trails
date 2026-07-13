# CLI Surface

The CLI surface adapter turns every trail into a command. Flags are derived from faithfully representable Zod schema fields, and structured JSON channels are available when the input shape is richer than flags can express honestly. Output formatting, error handling, and exit codes are handled automatically.

## Setup

```bash
bun add @ontrails/cli@beta @ontrails/commander@beta
```

```typescript
import { surface } from '@ontrails/commander';
import { graph } from './app';

await surface(graph);
```

That is the entire CLI setup. Every trail in the app becomes a command.

`@ontrails/cli` owns command derivation; `@ontrails/commander` owns Commander program materialization and argv parsing.

## How Trail IDs Map to Commands

Trail IDs derive to full ordered command paths:

| Trail ID      | CLI command         |
| ------------- | ------------------- |
| `greet`       | `myapp greet`       |
| `entity.show` | `myapp entity show` |
| `entity.add`  | `myapp entity add`  |
| `math.add`    | `myapp math add`    |
| `topo.pin`    | `myapp topo pin`    |

Each dot becomes another command-path segment. A path node may be both executable and a parent, so `myapp topo` and `myapp topo pin` can coexist naturally.

The CLI model is validated before adapter wiring. Duplicate command paths are rejected, and executable parents cannot also declare positional args if child commands exist beneath that path.

## Command Routes and Aliases

Most trails should keep the default dotted-ID command path. Use `cli` only when the CLI surface needs a compatibility path, a shorter operator command, or a route that better matches the surface language. A CLI route must normalize into the same trail contract without lying. It cannot change input, output, intent, permits, resources, or behavior.

CLI routes are a surface accommodation. In CLI terms, the surface entry is the command, the command path is the path for an approach, and an alias is an alternate approach to the same command. See [ADR-0050](../adr/0050-surface-accommodations-preserve-trail-identity.md) and [Surface Accommodations](surface-accommodations.md) for the cross-surface vocabulary and fork test.

Trail-owned routes live on the trail contract:

```typescript
const search = trail('wayfind.search', {
  cli: {
    aliases: ['find', ['wf', 'search']],
  },
  input: z.object({
    query: z.string().describe('Search query'),
  }),
  output: z.array(z.string()),
  // ...
});
```

String aliases are sibling leaf aliases. For `wayfind.search`, `find` accepts `wayfind find`. Array aliases are absolute command paths, so `['wf', 'search']` accepts `wf search`.

Use `cli: 'find'` or `cli: { path: ['wayfind', 'search'] }` only when the canonical command path itself should change. Prefer aliases for compatibility and migration paths.

App-owned bindings live on the `surfaces` overlay, authored with `surfaceOverlay()` in the app module and passed to the surface as `trailsOverlays`:

```typescript
import { surfaceOverlay } from '@ontrails/core';

export const trailsOverlays = [
  surfaceOverlay({
    cli: {
      // Scalar binding: a transparent synonym. The binding name splits on
      // '.' into the command path, so `wf search` invokes wayfind.search
      // with its full contract.
      'wf.search': 'wayfind.search',
      // List binding: a command group. Each member trail gets a
      // group-prefixed route (`wf wayfind search`, `wf wayfind impact`)
      // that dispatches the member trail with its identity preserved.
      // A singleton list is still a group, never a bare synonym.
      wf: ['wayfind.search', 'wayfind.impact'],
    },
  }),
];

await surface(app, { overlays: trailsOverlays });
```

A scalar binding must resolve (by exact id or dotted trail-id glob) to exactly one trail; a group's expanded member union must be non-empty. Violations fail fast with a `ValidationError` naming the binding.

Because `trails compile` reads the same `trailsOverlays` export, the committed `trails.lock` embeds the bindings under `overlays.surfaces` and projects the same alias routes onto each trail entry. Compile, validate, survey, Wayfinder, and schema inspection then see the same accepted command routes as the runtime CLI.

If an alternate CLI shape needs to reshape input before it reaches the trail, that is richer than an alias. Treat it as an input mapping only if it normalizes honestly into the same authored trail input contract. If it changes behavior, permits, intent, errors, outputs, lifecycle, side effects, or hides which trail is running, it is a trail fork: author a new trail or a composing trail instead of hiding the split in CLI wiring.

## Flag Derivation

Flags are derived from the trail's Zod input schema when the shape can be represented truthfully on the command line. No manual flag configuration needed.

| Zod type | CLI flag | Example |
| --- | --- | --- |
| `z.string()` | `--name <value>` | Required string |
| `z.number()` | `--count <value>` | Required number |
| `z.boolean()` | `--verbose` | Boolean switch |
| `z.enum(["a", "b"])` | `--format <value>` | With `.choices()` |
| `z.array(z.enum(["a", "b"]))` | `--mode <value>` | `--mode a b` or `--mode a --mode b` |
| `z.array(z.string())` | `--tag <values...>` | Repeatable: `--tag a --tag b` |
| `z.optional(z.string())` | `--name [value]` | Optional |
| `z.string().default("x")` | `--name [value]` | With default |

**Name conversion:** `camelCase` field names become `--kebab-case` flags. `sortOrder` becomes `--sort-order`.

**Descriptions:** `.describe("text")` on Zod fields becomes the flag help text.

Nested objects and arrays of objects are intentionally omitted from automatic flag derivation. The CLI prefers fewer flags over dishonest flags.

Bounded multiselects accept contiguous and repeated forms through the framework-owned `normalizeCliArgv()` grammar. The first matching token after a flag is its explicit value. After that first value, additional collection stops before a known child command or the first value outside the declared choices. CLI adapters validate the command model and apply this normalization before parsing.

When a nested command repeats an inherited bounded multiselect flag, its parsing shape and choices must stay equivalent. Divergent nested definitions are rejected before adapter wiring instead of depending on parser-specific option shadowing.

Versioned trails also get a surface-owned `--trail-version <version>` flag. The flag accepts a live version number or unambiguous marker prefix and is stripped before trail input validation, so version negotiation stays at the CLI boundary.

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
Arguments:
  query             Search query

Options:
  --query <value>   Search query
  --limit [value]   Max results (default: 10)
  --format [value]  (choices: "json", "table", default: "json")
```

## Positional Args

By default, if a trail has exactly one required string field with no default, the CLI auto-promotes it to a positional arg:

```bash
myapp topo pin v1.0          # instead of: myapp topo pin --name v1.0
```

For multiple positional args, declare `args` on the trail spec:

```typescript
trail('file.copy', {
  input: z.object({ src: z.string(), dest: z.string(), recursive: z.boolean() }),
  args: ['src', 'dest'],
  intent: 'write',
});
```

```bash
myapp file copy source.txt dest.txt --recursive
```

The `args` array controls which fields are positional and their order. Fields not in `args` become flags. Positional fields also keep their flag alias (`--src` still works).

To suppress auto-promotion entirely:

```typescript
trail('config.set', {
  input: z.object({ key: z.string(), value: z.string() }),
  args: false,  // both stay as --key and --value flags
});
```

## Structured Input

Every non-empty object input schema also gets two structured input channels:

- `--input-json <json>` to pass the full input object inline
- `--input <path|->` to load the full input object from a JSON file or stdin

These channels merge into one final input object before validation:

1. Structured input payload
2. Positional args
3. Explicit CLI flags
4. Interactive prompting for any remaining missing values

Explicit args and flags always win on conflict. Validation still happens once, against the original trail schema, after the merge.

```bash
myapp gist create \
  --input-json '{"files":[{"filename":"README.md","content":"Hello"}]}'
```

```bash
cat payload.json | myapp gist create --input -
```

When a schema includes fields that cannot be expressed truthfully as flags, the command help still shows the structured input options so the escape hatch stays discoverable.

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

Adds a `--dry-run` flag. Automatically added for trails with `intent: 'write'` or `intent: 'destroy'`. If the trail's implementation needs to branch on it, read `ctx.dryRun`; dry-run is execution context, not trail input.

## Output Formatting

The `output()` function writes values to stdout in the specified format:

```typescript
import { output, deriveOutputMode } from '@ontrails/cli';

await output({ name: 'Alpha' }, 'json'); // Pretty JSON to stdout
await output(items, 'jsonl'); // One JSON line per item
await output('Hello', 'text'); // Plain text
```

### Output Mode Resolution

`deriveOutputMode(flags, topoName)` determines the format from flags and topo-derived environment variables:

1. `--json` flag (highest priority)
2. `--jsonl` flag
3. `--output <mode>` flag
4. `<TOPO>_JSON=1` env var (topo-derived — e.g., `STASH_JSON=1` for a topo named `stash`)
5. `<TOPO>_JSONL=1` env var
6. Default: `"text"`

The `<TOPO>` prefix is derived from the topo name: uppercased, with non-alphanumerics replaced by `_`. Names starting with a digit get an `_` prefix so the result is a valid identifier (e.g., `1app` → `_1APP_JSON`). The topo name is threaded through the CLI surface automatically and appears on `ActionResultContext.topoName` for custom result handlers.

## Error Handling

When a trail returns `Result.err()`, the Commander adapter maps the error category to an exit code:

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

When the caller requested JSON or JSONL output with `--json`, `--jsonl`, `--output`, or the topo-derived environment variables, failures are also projected through the structured channel on stderr. Stdout stays reserved for successful command output, so agents can read stderr on non-zero exits without parsing text-mode messages.

```json
{
  "ok": false,
  "error": {
    "category": "timeout",
    "code": 5,
    "message": "Timed out waiting for the Trails topo store lock while compiling artifacts. Another topo write may be running; retry after it finishes.",
    "name": "TimeoutError",
    "retryable": true,
    "surface": "cli"
  },
  "context": {
    "operation": "compile",
    "reason": "sqlite-lock-contention",
    "resource": "trails.db"
  }
}
```

Text mode remains human-first:

```text
Error: Timed out waiting for the Trails topo store lock while compiling artifacts. Another topo write may be running; retry after it finishes.
```

## Custom Result Handling

Override the default result handler for custom formatting, logging, or metrics:

```typescript
import { surface } from '@ontrails/commander';
import { output, deriveOutputMode } from '@ontrails/cli';

await surface(graph, {
  onResult: async (ctx) => {
    if (ctx.result.isErr()) {
      console.error(`Failed: ${ctx.trail.id}`);
      throw ctx.result.error;
    }
    const { mode } = deriveOutputMode(ctx.flags, ctx.topoName);
    await output(ctx.result.value, mode);
  },
});
```

## Derived CLI Behavior

The CLI surface derives previously layer-shaped behavior directly from trail schemas. There is no opt-in wiring; if the trail shape matches, the behavior is on. The legacy `autoIterateLayer` and `dateShortcutsLayer` exports were removed in TRL-475.

### Auto-iterate (paginated trails)

For trails with paginated output (matching the pagination pattern from `@ontrails/core/patterns`), the CLI command exposes an `--all` flag. When set, the surface runs the trail with incrementing cursors and collects every page into a single result.

### Date shortcut expansion

For trails with `since`/`until` date fields, the CLI surface expands shortcut strings into ISO 8601 dates before validation:

- `"today"` -> today's date range
- `"yesterday"` -> yesterday's date range
- `"7d"` -> last 7 days
- `"30d"` -> last 30 days
- `"this-week"` -> current week
- `"this-month"` -> current month

## The Two-Level Architecture

`@ontrails/cli` is framework-agnostic. It produces a `Result<CliCommand[], Error>` projection that any CLI framework can consume. The `@ontrails/commander` adapter connects that model to Commander specifically.

```typescript
// Framework-agnostic: build the model
import { deriveCliCommands } from '@ontrails/cli';
const commands = deriveCliCommands(graph);
if (commands.isErr()) throw commands.error;

// Framework-specific: adapt to Commander
import { toCommander } from '@ontrails/commander';
const program = toCommander(commands.value, { name: 'myapp' });
program.parse();
```

Or use `surface()` which does both in one call:

```typescript
import { surface } from '@ontrails/commander';
await surface(graph);
```

To use a different CLI framework (yargs, oclif, etc.), consume the successful `CliCommand[]` result directly and write your own adapter. The model carries everything needed: a full ordered command path, flags, args, and an `execute()` function.

## Schema Command

Trails CLI apps can expose command schemas from the same topo and framework-agnostic CLI command model as the derived commands. The Trails operator CLI dogfoods this as `trails schema`.

```bash
trails schema
trails schema regrade
trails schema wayfind
trails schema wayfind pattern
```

The no-arg form returns a command contract index. Targeted schema lookup accepts any canonical or alias command path and returns the full command-contract envelope: command path, trail id, args, flags, routes, aliases, input schema, output schema, examples, and version metadata when derivable. When the path is also a command namespace, the output includes a `namespace.commands` array with the child command contracts so agents can inspect families such as `regrade` before choosing `regrade plan`, `regrade plans`, `regrade check`, `regrade preview`, or `regrade apply`.

Schema visibility describes the surface-bound CLI commands. Apps may configure broader schema visibility for dev or agent environments, but runtime schema output must not reveal hidden/internal schemas that the app author did not choose to expose.
