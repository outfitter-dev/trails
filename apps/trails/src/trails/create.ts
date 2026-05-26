/**
 * `create` trail -- Create a new Trails project.
 *
 * Composes create.scaffold, add.surface, and add.verify sub-trails
 * via ctx.compose.
 */

import { InternalError, Result, trail } from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';
import { z } from 'zod';

import {
  PROJECT_NAME_MESSAGE,
  PROJECT_NAME_PATTERN,
  projectPathExists,
  writeProjectFile,
} from '../project-writes.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Starter = 'empty' | 'entity' | 'hello';
type Surface = 'cli' | 'http' | 'mcp';

interface CreateInput {
  readonly dir?: string | undefined;
  readonly name: string;
  readonly starter: Starter;
  readonly surfaces: readonly Surface[];
  readonly verify: boolean;
}

interface ScaffoldRequest {
  readonly dir?: string | undefined;
  readonly name: string;
  readonly starter: Starter;
}

interface VerifyRequest {
  readonly dir?: string | undefined;
  readonly name: string;
  readonly verify: boolean;
}

interface ScaffoldedProject {
  readonly created: string[];
  readonly dir: string;
  readonly name: string;
}

interface SurfaceResult {
  readonly created: string | null;
  readonly dependency: string;
}

type TrailContextWithCompose = TrailContext & {
  readonly compose: NonNullable<TrailContext['compose']>;
};

const hasCompose = (ctx: TrailContext): ctx is TrailContextWithCompose =>
  Boolean(ctx.compose);

const buildScaffoldInput = (input: ScaffoldRequest) => ({
  ...(input.dir === undefined ? {} : { dir: input.dir }),
  name: input.name,
  starter: input.starter,
});

const buildSurfaceInput = (dir: string, surface: string) => ({
  dir,
  surface,
});

const buildVerifyInput = (input: VerifyRequest) => ({
  ...(input.dir === undefined ? {} : { dir: input.dir }),
  name: input.name,
});

const collectSurfaceFiles = async (
  surfaces: readonly string[],
  addSurface: (surface: string) => Promise<Result<SurfaceResult, Error>>
): Promise<Result<string[], Error>> => {
  const created: string[] = [];

  for (const surface of surfaces) {
    const result = await addSurface(surface);
    if (result.isErr()) {
      return Result.err(result.error);
    }
    if (result.value.created !== null) {
      created.push(result.value.created);
    }
  }

  return Result.ok(created);
};

const collectVerifyFiles = async (
  shouldVerify: boolean,
  addVerify: () => Promise<Result<{ created: string[] }, Error>>
): Promise<Result<string[], Error>> => {
  if (!shouldVerify) {
    return Result.ok([]);
  }

  const result = await addVerify();
  return result.isErr()
    ? Result.err(result.error)
    : Result.ok(result.value.created);
};

const collectCreatedFiles = (
  scaffolded: readonly string[],
  surfaces: readonly string[],
  verify: readonly string[],
  readme: string | null
): string[] =>
  readme === null
    ? [...scaffolded, ...surfaces, ...verify]
    : [...scaffolded, ...surfaces, ...verify, readme];

const surfaceReadmeLines = {
  cli: '- `src/cli.ts` - CLI surface entry point',
  http: '- `src/http.ts` - HTTP surface entry point',
  mcp: '- `src/mcp.ts` - MCP surface entry point',
} satisfies Record<Surface, string>;

const starterReadmeLines = {
  empty:
    'Starts with an empty `src/trails/` directory for authoring from scratch.',
  entity:
    'Includes sample entity trails, a signal, and an in-memory store for exploration.',
  hello: 'Includes a `hello` trail with examples for the first happy path.',
} satisfies Record<Starter, string>;

const generateReadme = (input: CreateInput): string => {
  const surfaceLines = input.surfaces
    .map((surface) => surfaceReadmeLines[surface])
    .join('\n');
  const verificationCommand = input.verify ? 'bun test\n' : '';
  const verificationStructure = input.verify
    ? '- `__tests__/examples.test.ts` - examples-as-tests harness\n'
    : '- Verification files were not generated for this project\n';

  return `# ${input.name}

A Trails project. Trails is an agent-native, contract-first TypeScript framework: author a trail once with typed input, Result output, examples, intent, and meta; surface it through CLI, MCP, HTTP, or future WebSocket.

## Getting Started

\`\`\`bash
bun install
${verificationCommand}bun run warden
bun run survey
bun run guide
\`\`\`

## Project Structure

- \`src/app.ts\` - the topo that collects this project's trails
- \`src/trails/\` - trail definitions
${surfaceLines}
${verificationStructure}- \`AGENTS.md\` - project guidance for agents working in this app

## Starter

${starterReadmeLines[input.starter]}

## Next Steps

- Add a trail with \`bun run add\`
- Run \`bun run warden\` before review
- Read \`AGENTS.md\` for Trails vocabulary and conventions
`;
};

const writeReadme = async (
  input: CreateInput,
  dir: string
): Promise<Result<string | null, Error>> => {
  const exists = projectPathExists(dir, 'README.md');
  if (exists.isErr()) {
    return Result.err(exists.error);
  }
  if (exists.value) {
    return Result.ok(null);
  }

  const written = await writeProjectFile(
    dir,
    'README.md',
    generateReadme(input)
  );
  return written.isErr() ? Result.err(written.error) : Result.ok('README.md');
};

// ---------------------------------------------------------------------------
// Trail definition
// ---------------------------------------------------------------------------

export const createTrail = trail('create', {
  blaze: async (input: CreateInput, ctx) => {
    if (!hasCompose(ctx)) {
      return Result.err(new InternalError('create trail requires ctx.compose'));
    }

    const scaffolded = await ctx.compose<ScaffoldedProject>(
      'create.scaffold',
      buildScaffoldInput(input)
    );
    if (scaffolded.isErr()) {
      return Result.err(scaffolded.error);
    }

    const finishCreate = async (): Promise<
      Result<{ created: string[]; dir: string; name: string }, Error>
    > => {
      const surfaceFiles = await collectSurfaceFiles(
        input.surfaces,
        (surface) =>
          ctx.compose<SurfaceResult>(
            'add.surface',
            buildSurfaceInput(scaffolded.value.dir, surface)
          )
      );
      if (surfaceFiles.isErr()) {
        return Result.err(surfaceFiles.error);
      }

      const verifyFiles = await collectVerifyFiles(input.verify, () =>
        ctx.compose<{ created: string[] }>(
          'add.verify',
          buildVerifyInput(input)
        )
      );
      if (verifyFiles.isErr()) {
        return Result.err(verifyFiles.error);
      }

      const readmeFile = await writeReadme(input, scaffolded.value.dir);
      if (readmeFile.isErr()) {
        return Result.err(readmeFile.error);
      }

      return Result.ok({
        created: collectCreatedFiles(
          scaffolded.value.created,
          surfaceFiles.value,
          verifyFiles.value,
          readmeFile.value
        ),
        dir: scaffolded.value.dir,
        name: input.name,
      });
    };

    return finishCreate();
  },
  composes: ['create.scaffold', 'add.surface', 'add.verify'],
  description: 'Create a new Trails project',
  fields: {
    starter: {
      options: [
        {
          hint: 'One trail, one example',
          label: 'Hello world',
          value: 'hello',
        },
        {
          hint: '4 trails, signal, store',
          label: 'Entity CRUD',
          value: 'entity',
        },
        { hint: 'Just the structure', label: 'Empty', value: 'empty' },
      ],
    },
    surfaces: {
      options: [
        { hint: 'Commander-based command line', label: 'CLI', value: 'cli' },
        {
          hint: 'Model Context Protocol for agents',
          label: 'MCP',
          value: 'mcp',
        },
        {
          hint: 'Hono-powered HTTP endpoints',
          label: 'HTTP',
          value: 'http',
        },
      ],
    },
  },
  input: z.object({
    dir: z.string().optional().describe('Parent directory'),
    name: z
      .string()
      .regex(PROJECT_NAME_PATTERN, PROJECT_NAME_MESSAGE)
      .describe('Project name'),
    starter: z
      .enum(['hello', 'entity', 'empty'])
      .default('hello')
      .describe('Starter trail'),
    surfaces: z
      .array(z.enum(['cli', 'http', 'mcp']))
      .min(1)
      .default(['cli'])
      .describe('Surfaces'),
    verify: z.boolean().default(true).describe('Include testing + warden'),
  }),
  output: z.object({
    created: z.array(z.string()),
    dir: z.string(),
    name: z.string(),
  }),
});
