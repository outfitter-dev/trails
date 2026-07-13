# @ontrails/commander

Commander adapter for Trails. Use this package when you want to expose a topo as a Commander-powered command-line program while keeping `@ontrails/cli` focused on framework-agnostic command derivation.

## Usage

```typescript
import { surface } from '@ontrails/commander';
import { graph } from './app';

await surface(graph);
```

For program construction without parsing argv:

```typescript
import { createProgram } from '@ontrails/commander';
import { graph } from './app';

const program = createProgram(graph, { name: 'myapp' });
```

For lower-level adapter wiring, derive the command model with `@ontrails/cli` and materialize it with `toCommander()`:

```typescript
import { deriveCliCommands } from '@ontrails/cli';
import { toCommander } from '@ontrails/commander';
import { graph } from './app';

const commands = deriveCliCommands(graph);
if (commands.isErr()) {
  throw commands.error;
}

const program = toCommander(commands.value, { name: 'myapp' });
```

## Multiselect flags

Schema fields such as `z.array(z.enum(['cli', 'mcp', 'http']))` derive a bounded multiselect flag. The shared CLI argv normalizer lets adapters accept both contiguous and repeated forms; Commander applies it automatically:

```bash
myapp create --surfaces cli mcp http
myapp create --surfaces cli --surfaces mcp --surfaces http
```

The first matching token after the flag is its explicit value. After that first value, additional collection stops before known child routes or values outside the declared choices. Adopters do not need custom parsing or surface configuration for either form.

## Installation

```bash
bun add @ontrails/cli@beta @ontrails/commander@beta
```

## Migration

<!-- warden-ignore-next-line -->
This package replaces the old `@ontrails/cli/commander` subpath.

<!-- warden-ignore-next-line -->
- Before: `import { surface } from '@ontrails/cli/commander'`
- After: `import { surface } from '@ontrails/commander'`
