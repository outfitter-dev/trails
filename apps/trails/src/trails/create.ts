/**
 * `create` route -- Create a new Trails project.
 *
 * Composes create.scaffold, add.surface, and add.verify sub-trails
 * via ctx.follow().
 */

import type { FollowFn } from '@ontrails/core';
import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Starter = 'empty' | 'entity' | 'hello';
type Surface = 'cli' | 'mcp';

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

const scaffoldProject = (
  follow: FollowFn,
  input: ScaffoldRequest
): Promise<Result<ScaffoldedProject, Error>> =>
  follow('create.scaffold', buildScaffoldInput(input));

const addSurfaceFiles = async (
  follow: FollowFn,
  dir: string,
  surfaces: readonly string[]
): Promise<Result<string[], Error>> => {
  const created: string[] = [];

  for (const surface of surfaces) {
    const result = await follow<{ created: string; dependency: string }>(
      'add.surface',
      buildSurfaceInput(dir, surface)
    );
    if (result.isErr()) {
      return Result.err(result.error);
    }
    created.push(result.value.created);
  }

  return Result.ok(created);
};

const collectVerifyFiles = async (
  follow: FollowFn,
  input: VerifyRequest
): Promise<Result<string[], Error>> => {
  if (!input.verify) {
    return Result.ok([]);
  }

  const result = await follow<{ created: string[] }>(
    'add.verify',
    buildVerifyInput(input)
  );
  return result.isErr()
    ? Result.err(result.error)
    : Result.ok(result.value.created);
};

const collectCreatedFiles = (
  scaffolded: readonly string[],
  surfaces: readonly string[],
  verify: readonly string[]
): string[] => [...scaffolded, ...surfaces, ...verify];

const runCreate = async (
  follow: FollowFn,
  input: CreateInput
): Promise<Result<{ created: string[]; dir: string; name: string }, Error>> => {
  const scaffolded = await scaffoldProject(follow, input);
  if (scaffolded.isErr()) {
    return Result.err(scaffolded.error);
  }

  const surfaceResults = await addSurfaceFiles(
    follow,
    scaffolded.value.dir,
    input.surfaces
  );
  if (surfaceResults.isErr()) {
    return Result.err(surfaceResults.error);
  }

  const verifyFiles = await collectVerifyFiles(follow, input);
  if (verifyFiles.isErr()) {
    return Result.err(verifyFiles.error);
  }

  return Result.ok({
    created: collectCreatedFiles(
      scaffolded.value.created,
      surfaceResults.value,
      verifyFiles.value
    ),
    dir: scaffolded.value.dir,
    name: input.name,
  });
};

// ---------------------------------------------------------------------------
// Route definition
// ---------------------------------------------------------------------------

export const createRoute = trail('create', {
  blaze: async (input: CreateInput, ctx) => {
    if (!ctx.follow) {
      return Result.err(new Error('create route requires ctx.follow'));
    }
    return await runCreate(ctx.follow, input);
  },
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
          hint: '4 trails, event, store',
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
      ],
    },
  },
  follow: ['create.scaffold', 'add.surface', 'add.verify'],
  input: z.object({
    dir: z.string().optional().describe('Parent directory'),
    name: z.string().describe('Project name'),
    starter: z
      .enum(['hello', 'entity', 'empty'])
      .default('hello')
      .describe('Starter trail'),
    surfaces: z
      .array(z.enum(['cli', 'mcp']))
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
