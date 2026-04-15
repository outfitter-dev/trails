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
| `deriveOutputMode(flags, topoName)` | Derive output mode from flags and topo-derived env vars (`<TOPO>_JSON`, `<TOPO>_JSONL`) |

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
myapp greet --name World   # flag alias is kept for backward compatibility
```

The heuristic is intentionally conservative: multiple required strings stay as
flags. To override, declare `args` on the trail:

```typescript
const copy = trail('file.copy', {
  input: z.object({ src: z.string(), dest: z.string() }),
  args: ['src'],
  blaze: (input) => Result.ok({ src: input.src, dest: input.dest }),
});
```

`args` accepts `string[]` for explicit positional order, `false` to suppress
auto-promotion entirely, or `undefined` (omit) for the heuristic.

```bash
myapp file copy ./readme.md --dest /tmp/readme.md
```

## App auto-discovery

When running from the workspace root without an explicit `--module` flag, the CLI
automatically discovers your app entry point:

1. `src/app.ts` (single-app layout)
2. `apps/*/src/app.ts` (monorepo convention)

If exactly one candidate is found, it is used automatically. If multiple
candidates are found, the CLI lists them and asks you to choose with `--module`.

```bash
# Auto-discovers src/app.ts — no --module needed
myapp topo

# Explicit when multiple apps exist
myapp topo --module ./apps/api/src/app.ts
```

Use `findAppModuleCandidates(cwd)` and `findAppModule(cwd, explicit?)` directly
for programmatic access.

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

## Filtering

```typescript
trailhead(app, { include: ['entity.**'] });
trailhead(app, { exclude: ['dev.**'] });
```

`*` matches one dotted segment and `**` matches any depth. Trails declared
with `visibility: 'internal'` stay hidden unless you include their exact trail
ID intentionally.

## Layers

- **`autoIterateLayer`** -- adds `--all` for paginated trails, collects all pages
- **`dateShortcutsLayer`** -- expands `"today"`, `"7d"`, `"30d"` into ISO date ranges

## Installation

```bash
bun add @ontrails/cli commander
```

`commander` is a peer dependency, required only for the `/commander` subpath.
