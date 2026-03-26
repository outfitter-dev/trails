# @ontrails/cli

CLI surface adapter for Trails. Framework-agnostic command model, automatic flag derivation from Zod schemas, output formatting, and a Commander adapter with a one-line `blaze()` entry point.

## Installation

```bash
bun add @ontrails/cli
# If using the /commander subpath:
bun add commander
```

`commander` is an optional peer dependency -- only required if you use the `/commander` subpath. The main `@ontrails/cli` export is framework-agnostic.

## Quick Start

```typescript
import { trail, topo, Result } from '@ontrails/core';
import { blaze } from '@ontrails/cli/commander';
import { z } from 'zod';

const greet = trail('greet', {
  input: z.object({ name: z.string().describe('Who to greet') }),
  implementation: (input) => Result.ok(`Hello, ${input.name}!`),
});

const app = topo('myapp', { greet });
blaze(app);
```

Pure trails can return `Result` directly. The CLI surface still runs the normalized awaitable implementation shape at execution time.

```bash
$ myapp greet --name World
Hello, World!

$ myapp greet --help
Usage: myapp greet [options]

Options:
  --name <value>  Who to greet
  -h, --help      display help for command
```

## API Overview

### `blaze(app, options?)` -- Commander Adapter

The one-liner. Builds commands from the topo, adapts to Commander, parses `process.argv`.

```typescript
import { blaze } from '@ontrails/cli/commander';

blaze(app, {
  name: 'myapp',
  version: '1.0.0',
  onResult: async (ctx) => {
    /* custom result handling */
  },
  layers: [myAuthLayer],
});
```

### `buildCliCommands(app, options?)`

Framework-agnostic command builder. Produces `CliCommand[]` that any CLI framework can consume.

```typescript
import { buildCliCommands } from '@ontrails/cli';

const commands = buildCliCommands(app);
// Each command: name, flags, args, group, trail ref, execute()
```

### Flag Derivation

Flags are derived automatically from the trail's Zod input schema:

| Zod type              | CLI flag            | Notes                         |
| --------------------- | ------------------- | ----------------------------- |
| `z.string()`          | `--name <value>`    | Required string               |
| `z.number()`          | `--count <value>`   | Required number               |
| `z.boolean()`         | `--verbose`         | Boolean switch                |
| `z.enum(["a", "b"])`  | `--format <value>`  | With choices                  |
| `z.array(z.string())` | `--tag <values...>` | Repeatable: `--tag a --tag b` |
| `z.optional(...)`     | `--name [value]`    | Optional                      |
| `z.default(...)`      | `--name [value]`    | With default value            |

Name conversion: `camelCase` field names become `--kebab-case` flags. `.describe()` on Zod fields becomes help text.

### Trail ID to Command Mapping

Dotted trail IDs create subcommand groups:

| Trail ID      | CLI command         |
| ------------- | ------------------- |
| `greet`       | `myapp greet`       |
| `entity.show` | `myapp entity show` |
| `math.add`    | `myapp math add`    |

### Output Formatting

```typescript
import { output, resolveOutputMode } from '@ontrails/cli';

await output({ name: 'Alpha' }, 'json'); // Pretty JSON
await output(items, 'jsonl'); // One JSON line per item
await output('Hello', 'text'); // Plain text
```

Output mode resolution priority: `--json` > `--jsonl` > `--output <mode>` > `TRAILS_JSON=1` > `TRAILS_JSONL=1` > `"text"`.

### Flag Presets

- **`outputModePreset()`** -- `--output <mode>`, `--json`, `--jsonl`
- **`cwdPreset()`** -- `--cwd <path>`
- **`dryRunPreset()`** -- `--dry-run` (auto-added for destructive trails)

### Built-in Layers

- **`autoIterateLayer`** -- Adds `--all` flag for paginated trails; collects all pages.
- **`dateShortcutsLayer`** -- Expands `"today"`, `"7d"`, `"30d"`, `"this-week"`, `"this-month"` into ISO date ranges.

### Commander Adapter (Advanced)

Build the Commander program manually for full control:

```typescript
import { buildCliCommands } from '@ontrails/cli';
import { toCommander } from '@ontrails/cli/commander';

const commands = buildCliCommands(app);
const program = toCommander(commands, { name: 'myapp' });
program.parse();
```

To use a different CLI framework, consume `CliCommand[]` and write your own adapter.

### Error Handling

Trail error categories map to exit codes automatically:

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

## Subpath Exports

| Export | Contents |
| --- | --- |
| `@ontrails/cli` | `buildCliCommands`, `deriveFlags`, `output`, `resolveOutputMode`, flag presets, layers, `CliCommand` types |
| `@ontrails/cli/commander` | `toCommander`, `blaze` (requires `commander` peer) |

## Further Reading

- [CLI Surface Guide](../../docs/surfaces/cli.md)
- [Getting Started](../../docs/getting-started.md)
