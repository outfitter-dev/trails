# @ontrails/cli

CLI surface adapter. One `blaze()` call turns a topo into a full CLI with flags, subcommands, help text, and error-mapped exit codes -- all derived from the trail contracts.

## Usage

```typescript
import { trail, topo, Result } from '@ontrails/core';
import { blaze } from '@ontrails/cli/commander';
import { z } from 'zod';

const greet = trail('greet', {
  input: z.object({ name: z.string().describe('Who to greet') }),
  run: (input) => Result.ok(`Hello, ${input.name}!`),
});

const app = topo('myapp', { greet });
blaze(app);
```

```bash
$ myapp greet --name World
Hello, World!

$ myapp greet --help
Usage: myapp greet [options]

Options:
  --name <value>  Who to greet
  -h, --help      display help for command
```

For more control, build the commands yourself:

```typescript
import { buildCliCommands } from '@ontrails/cli';
import { toCommander } from '@ontrails/cli/commander';

const commands = buildCliCommands(app);
const program = toCommander(commands, { name: 'myapp' });
program.parse();
```

`buildCliCommands` returns a framework-agnostic `CliCommand[]`. Use `toCommander` for Commander, or write your own adapter.

## API

| Export | What it does |
| --- | --- |
| `blaze(app, options?)` | One-liner: build commands, wire Commander, parse argv |
| `buildCliCommands(app)` | Framework-agnostic command builder, returns `CliCommand[]` |
| `toCommander(commands, options?)` | Adapt `CliCommand[]` to a Commander program |
| `deriveFlags(schema)` | Extract CLI flags from a Zod schema |
| `output(data, mode)` | Format output as JSON, JSONL, or text |
| `resolveOutputMode(options)` | Resolve output mode from flags and env vars |

See the [API Reference](../../docs/api-reference.md) for the full list.

## Flag derivation

Flags come from the Zod schema automatically. No manual flag definitions.

| Zod type | CLI flag | Notes |
| --- | --- | --- |
| `z.string()` | `--name <value>` | Required |
| `z.boolean()` | `--verbose` | Switch |
| `z.enum(["a","b"])` | `--format <value>` | With choices |
| `z.array(z.string())` | `--tag <values...>` | Repeatable |
| `z.optional(...)` | `--name [value]` | Optional |

`camelCase` fields become `--kebab-case` flags. `.describe()` becomes help text.

## Subcommands

Dotted trail IDs create subcommand groups: `entity.show` becomes `myapp entity show`.

## Layers

- **`autoIterateLayer`** -- adds `--all` for paginated trails, collects all pages
- **`dateShortcutsLayer`** -- expands `"today"`, `"7d"`, `"30d"` into ISO date ranges

## Installation

```bash
bun add @ontrails/cli commander
```

`commander` is a peer dependency, required only for the `/commander` subpath.
