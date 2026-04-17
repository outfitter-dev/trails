/**
 * `create` route -- Create a new Trails project.
 *
 * Composes create.scaffold, add.trailhead, and add.verify sub-trails
 * via ctx.cross.
 */

import type { CrossFn } from '@ontrails/core';
import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Starter = 'empty' | 'entity' | 'hello';
type Trailhead = 'cli' | 'mcp';

interface CreateInput {
  readonly dir?: string | undefined;
  readonly name: string;
  readonly starter: Starter;
  readonly trailheads: readonly Trailhead[];
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

const buildTrailheadInput = (dir: string, trailhead: string) => ({
  dir,
  trailhead,
});

const buildVerifyInput = (input: VerifyRequest) => ({
  ...(input.dir === undefined ? {} : { dir: input.dir }),
  name: input.name,
});

const scaffoldProject = (
  cross: CrossFn,
  input: ScaffoldRequest
): Promise<Result<ScaffoldedProject, Error>> =>
  cross('create.scaffold', buildScaffoldInput(input));

const addTrailheadFiles = async (
  cross: CrossFn,
  dir: string,
  trailheads: readonly string[]
): Promise<Result<string[], Error>> => {
  const created: string[] = [];

  for (const trailhead of trailheads) {
    const result = await cross<{ created: string; dependency: string }>(
      'add.trailhead',
      buildTrailheadInput(dir, trailhead)
    );
    if (result.isErr()) {
      return Result.err(result.error);
    }
    created.push(result.value.created);
  }

  return Result.ok(created);
};

const collectVerifyFiles = async (
  cross: CrossFn,
  input: VerifyRequest
): Promise<Result<string[], Error>> => {
  if (!input.verify) {
    return Result.ok([]);
  }

  const result = await cross<{ created: string[] }>(
    'add.verify',
    buildVerifyInput(input)
  );
  return result.isErr()
    ? Result.err(result.error)
    : Result.ok(result.value.created);
};

const collectCreatedFiles = (
  scaffolded: readonly string[],
  trailheads: readonly string[],
  verify: readonly string[]
): string[] => [...scaffolded, ...trailheads, ...verify];

const runCreate = async (
  cross: CrossFn,
  input: CreateInput
): Promise<Result<{ created: string[]; dir: string; name: string }, Error>> => {
  const scaffolded = await scaffoldProject(cross, input);
  if (scaffolded.isErr()) {
    return Result.err(scaffolded.error);
  }

  const trailheadResults = await addTrailheadFiles(
    cross,
    scaffolded.value.dir,
    input.trailheads
  );
  if (trailheadResults.isErr()) {
    return Result.err(trailheadResults.error);
  }

  const verifyFiles = await collectVerifyFiles(cross, input);
  if (verifyFiles.isErr()) {
    return Result.err(verifyFiles.error);
  }

  return Result.ok({
    created: collectCreatedFiles(
      scaffolded.value.created,
      trailheadResults.value,
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
  // Warden's cross-declarations rule can't see through helper functions, but
  // these crossings are real — scaffoldProject, addSurfaceFiles, and
  // collectVerifyFiles all delegate via the CrossFn passed from ctx.cross.
  blaze: async (input: CreateInput, ctx) => {
    if (!ctx.cross) {
      return Result.err(new Error('create route requires ctx.cross'));
    }
    return await runCreate(ctx.cross, input);
  },
  crosses: ['create.scaffold', 'add.trailhead', 'add.verify'],
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
    trailheads: {
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
  input: z.object({
    dir: z.string().optional().describe('Parent directory'),
    name: z.string().describe('Project name'),
    starter: z
      .enum(['hello', 'entity', 'empty'])
      .default('hello')
      .describe('Starter trail'),
    trailheads: z
      .array(z.enum(['cli', 'mcp']))
      .default(['cli'])
      .describe('Trailheads'),
    verify: z.boolean().default(true).describe('Include testing + warden'),
  }),
  output: z.object({
    created: z.array(z.string()),
    dir: z.string(),
    name: z.string(),
  }),
});
