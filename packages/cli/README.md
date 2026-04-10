# @ontrails/cli

CLI trailhead connector. One `trailhead()` call turns a topo into a full CLI
with honest flags, structured input channels, subcommands, help text, and
error-mapped exit codes -- all derived from the trail contracts.

## Usage

```typescript
import { trail, topo, Result } from '@ontrails/core';
import { trailhead } from '@ontrails/cli/commander';
import { z } from 'zod';

const greet = trail('greet', {
  input: z.object({ name: z.string().describe('Who to greet') }),
  blaze: (input) => Result.ok(`Hello, ${input.name}!`),
});

const app = topo('myapp', { greet });
trailhead(app);
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

`buildCliCommands` returns a framework-agnostic `CliCommand[]`. Use `toCommander` for Commander, or write your own connector.
Invalid command models are rejected before adapter wiring, including duplicate
CLI paths and executable parents that also declare positional args beneath child
commands.

## API

| Export | What it does |
| --- | --- |
| `trailhead(app, options?)` | One-liner: build commands, wire Commander, parse argv |
| `buildCliCommands(app)` | Framework-agnostic command builder, returns `CliCommand[]` |
| `validateCliCommands(commands)` | Validate `CliCommand[]` shapes before wiring a CLI adapter |
| `toCommander(commands, options?)` | Connect `CliCommand[]` to a Commander program |
| `deriveFlags(schema)` | Extract honest CLI flags from a Zod schema |
| `output(data, mode)` | Format output as JSON, JSONL, or text |
| `resolveOutputMode(flags, topoName)` | Resolve output mode from flags and topo-derived env vars (`<TOPO>_JSON`, `<TOPO>_JSONL`) |

See the [API Reference](../../docs/api-reference.md) for the full list.

## Flag derivation

Flags come from the Zod schema automatically when the field shape can be
represented truthfully on the command line. No manual flag definitions.

| Zod type | CLI flag | Notes |
| --- | --- | --- |
| `z.string()` | `--name <value>` | Required |
| `z.boolean()` | `--verbose` | Switch |
| `z.enum(["a","b"])` | `--format <value>` | With choices |
| `z.array(z.string())` | `--tag <values...>` | Repeatable |
| `z.optional(...)` | `--name [value]` | Optional |

`camelCase` fields become `--kebab-case` flags. `.describe()` becomes help text.

Nested objects and arrays of objects are intentionally omitted from automatic
flag derivation. The CLI prefers fewer flags over dishonest flags.

## Positional arguments

When a trail's input schema has exactly one required `string` field with no
default, the CLI auto-promotes it to a positional argument instead of a flag:

```typescript
const greet = trail('greet', {
  input: z.object({ name: z.string().describe('Who to greet') }),
  blaze: (input) => Result.ok(`Hello, ${input.name}!`),
});
```

```bash
myapp greet World          # positional
myapp greet --name World   # flag form still works via structured input
```

The heuristic is intentionally conservative: multiple required strings stay as
flags. To override, mark a field explicitly via `fields`:

```typescript
const copy = trail('file.copy', {
  input: z.object({ src: z.string(), dest: z.string() }),
  fields: { src: { positional: true } },
  blaze: (input) => Result.ok({ src: input.src, dest: input.dest }),
});
```

```bash
myapp file copy ./readme.md --dest /tmp/readme.md
```

## Structured input

For every non-empty object input schema, the CLI also exposes:

- `--input-json <json>`
- `--input-file <path>`
- `--stdin`

These channels supply the full input object before positional args and explicit
flags are merged on top. Explicit CLI inputs always win on conflict, and the
final merged object is still validated once by the trail schema.

```bash
myapp gist create \
  --input-json '{"files":[{"filename":"README.md","content":"Hello"}]}'
```

## Subcommands

Dotted trail IDs derive to full ordered command paths:

- `entity.show` -> `myapp entity show`
- `topo.pin` -> `myapp topo pin`
- `topo.pin.remove` -> `myapp topo pin remove`

Command-path nodes may be both executable and parents, so `myapp topo` and
`myapp topo pin` can coexist naturally.

`CliCommand[]` validation rejects ambiguous parent/child shapes, so an
executable parent cannot also declare positional args if child commands exist
beneath that path.

## Service resolution

Declared resources on each trail are resolved into the context before the implementation runs.

## Layers

- **`autoIterateLayer`** -- adds `--all` for paginated trails, collects all pages
- **`dateShortcutsLayer`** -- expands `"today"`, `"7d"`, `"30d"` into ISO date ranges

## Installation

```bash
bun add @ontrails/cli commander
```

`commander` is a peer dependency, required only for the `/commander` subpath.
