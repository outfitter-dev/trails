# CLI Surface Reference

## Flag Derivation

Zod fields on a trail's `input` schema become CLI flags automatically.

| Zod type | CLI flag behavior |
|----------|------------------|
| `z.string()` | `--flag <value>` (required) |
| `z.string().default('x')` | `--flag <value>` (default: `x`) |
| `z.string().optional()` | `--flag [value]` (optional) |
| `z.boolean()` | `--flag` (boolean, no value) |
| `z.boolean().default(false)` | `--flag` (default: off) |
| `z.number()` | `--flag <number>` (parsed as number) |
| `z.enum(['a', 'b'])` | `--flag <value>` (choices: a, b) |
| `z.array(z.string())` | `--flag <value...>` (variadic) |

**Naming:** camelCase field names become kebab-case flags. `userName` → `--user-name`.

**Help text:** `.describe('...')` on any field becomes the flag's help line. Always add descriptions.

**Positional arguments:** Promote the first required string field to a positional via `resolveInput` in blaze options.

## Output Modes

CLI surfaces support `--output text|json|jsonl` for structured output.

```typescript
blaze(app, {
  presets: [outputModePreset()],
});
```

The surface handles formatting based on mode:

- `text` — Human-readable (default). The surface calls `.toString()` or formats objects.
- `json` — Pretty-printed JSON of the Result value.
- `jsonl` — One JSON object per line. Useful for piping to `jq`.

## Exit Code Mapping

Each error category maps to a specific exit code:

| Error category | Exit code |
|----------------|-----------|
| `validation` | 1 |
| `not_found` | 2 |
| `conflict` | 3 |
| `permission` | 4 |
| `timeout` | 5 |
| `rate_limit` | 6 |
| `network` | 7 |
| `internal` | 8 |
| `auth` | 9 |
| `cancelled` | 130 |

Return `Result.err(new NotFoundError(...))` and the CLI exits with code 2. No manual `process.exit()`.

## Subcommand Grouping

Dotted trail IDs become nested subcommands:

| Trail ID | CLI command |
|----------|-------------|
| `greet` | `myapp greet` |
| `entity.show` | `myapp entity show` |
| `entity.list` | `myapp entity list` |
| `math.add` | `myapp math add` |

Groups are created automatically from the dot-separated prefix.

## Destructive Trails

When a trail has `intent: 'destroy'`, the CLI surface automatically adds a `--dry-run` flag. The `ctx.dryRun` boolean is available inside the implementation. You can also add this explicitly:

```typescript
blaze(app, {
  presets: [dryRunPreset()],
});
```

## Presets

Presets add common flags and behavior to all commands:

| Preset | What it adds |
|--------|-------------|
| `outputModePreset()` | `--output text\|json\|jsonl` flag |
| `cwdPreset()` | `--cwd <dir>` flag, sets working directory |
| `dryRunPreset()` | `--dry-run` flag on `intent: 'destroy'` trails |

```typescript
blaze(app, {
  presets: [outputModePreset(), cwdPreset()],
});
```

## Blaze Options

```typescript
blaze(app, {
  name: 'myapp',           // CLI binary name (defaults to topo name)
  version: '1.0.0',        // --version output
  description: 'My app',   // Top-level help text
  presets: [...],           // Array of preset functions
  resolveInput: (cmd) => { // Custom input resolution per command
    // Promote first arg to positional, add aliases, etc.
  },
});
```

## Escape Hatch

For full control over the Commander.js program, use `buildCliCommands()` to get the command tree, then call `toCommander()`:

```typescript
import { buildCliCommands, toCommander } from '@ontrails/cli/commander';
import { app } from './app';

const commands = buildCliCommands(app);
const program = toCommander(commands, {
  name: 'myapp',
  version: '1.0.0',
});

// Add custom Commander.js configuration here
program.parse();
```

This gives you the full Commander.js `Command` instance for manual customization.
