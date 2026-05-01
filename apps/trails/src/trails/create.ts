/**
 * `create` route -- Create a new Trails project.
 *
 * Composes create.scaffold, add.surface, and add.verify sub-trails
 * via ctx.cross.
 */

import { InternalError, Result, trail } from '@ontrails/core';
import { z } from 'zod';

import {
  PROJECT_NAME_MESSAGE,
  PROJECT_NAME_PATTERN,
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
  readonly created: string;
  readonly dependency: string;
}

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
    created.push(result.value.created);
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
  verify: readonly string[]
): string[] => [...scaffolded, ...surfaces, ...verify];

// ---------------------------------------------------------------------------
// Route definition
// ---------------------------------------------------------------------------

export const createRoute = trail('create', {
  blaze: async (input: CreateInput, ctx) => {
    if (!ctx.cross) {
      return Result.err(new InternalError('create route requires ctx.cross'));
    }
    const { cross } = ctx;

    const scaffolded = await cross<ScaffoldedProject>(
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
          cross<SurfaceResult>(
            'add.surface',
            buildSurfaceInput(scaffolded.value.dir, surface)
          )
      );
      if (surfaceFiles.isErr()) {
        return Result.err(surfaceFiles.error);
      }

      const verifyFiles = await collectVerifyFiles(input.verify, () =>
        cross<{ created: string[] }>('add.verify', buildVerifyInput(input))
      );
      if (verifyFiles.isErr()) {
        return Result.err(verifyFiles.error);
      }

      return Result.ok({
        created: collectCreatedFiles(
          scaffolded.value.created,
          surfaceFiles.value,
          verifyFiles.value
        ),
        dir: scaffolded.value.dir,
        name: input.name,
      });
    };

    return finishCreate();
  },
  crosses: ['create.scaffold', 'add.surface', 'add.verify'],
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
