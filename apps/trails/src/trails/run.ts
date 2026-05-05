/**
 * `run` trail -- Direct trail invocation by ID.
 *
 * Resolves a trail in the current app's topo and executes it through the
 * shared `run()` pipeline from `@ontrails/core`. The CLI surface drives this
 * trail with `trails run <id> [inline-json]`; this branch only wires the
 * single-app, inline-JSON path. Multi-app workspace resolution and additional
 * input sources (stdin, file) are built in later branches.
 *
 * The trail's output keeps a typed discriminator around the heterogeneous
 * inner trail value. The value itself remains `unknown` because direct
 * invocation can target any trail in the loaded app.
 */

import { Result, run, trail } from '@ontrails/core';
import { z } from 'zod';

import { tryLoadFreshAppLease } from './load-app.js';
import { resolveTrailRootDir } from './root-dir.js';
import { createIsolatedExampleInput } from './topo-support.js';

export const INNER_TRAIL_RESULT_KIND = 'inner-trail-result' as const;

export const innerTrailResultSchema = z.object({
  kind: z.literal(INNER_TRAIL_RESULT_KIND),
  trailId: z.string(),
  value: z.unknown(),
});

export type InnerTrailResult = z.infer<typeof innerTrailResultSchema>;

export const resolveRunModulePath = async (
  _rootDir: string,
  module: string | undefined,
  _trailId: string,
  _app: string | undefined
): Promise<Result<string | undefined, Error>> =>
  // The first run-family branch preserves the existing single-app loader
  // behavior. Workspace-index resolution is layered in by the --app branch.
  Result.ok(module);

// ---------------------------------------------------------------------------
// Example input helpers
// ---------------------------------------------------------------------------

const buildHappyExampleInput = (): {
  readonly input: { readonly module: string; readonly rootDir: string };
  readonly id: string;
  readonly module: string;
  readonly rootDir: string;
} => {
  const isolated = createIsolatedExampleInput('run-happy');
  return {
    id: 'survey.brief',
    input: { module: isolated.module, rootDir: isolated.rootDir },
    module: isolated.module,
    rootDir: isolated.rootDir,
  };
};

const buildNotFoundExampleInput = (): {
  readonly id: string;
  readonly module: string;
  readonly rootDir: string;
} => ({
  ...createIsolatedExampleInput('run-not-found'),
  id: 'does.not.exist',
});

// ---------------------------------------------------------------------------
// Trail definition
// ---------------------------------------------------------------------------

export const runTrail = trail('run', {
  args: ['id'],
  blaze: async (input, ctx) => {
    const rootDirResult = resolveTrailRootDir(input.rootDir, ctx.cwd);
    if (rootDirResult.isErr()) {
      return Result.err(rootDirResult.error);
    }
    const rootDir = rootDirResult.value;
    const moduleResolution = await resolveRunModulePath(
      rootDir,
      input.module,
      input.id,
      input.app
    );
    if (moduleResolution.isErr()) {
      return Result.err(moduleResolution.error);
    }
    const leaseResult = await tryLoadFreshAppLease(
      moduleResolution.value,
      rootDir
    );
    if (leaseResult.isErr()) {
      return Result.err(leaseResult.error);
    }
    const lease = leaseResult.value;

    try {
      const result = await run(lease.app, input.id, input.input);
      if (result.isErr()) {
        return Result.err(result.error);
      }
      return Result.ok({
        kind: INNER_TRAIL_RESULT_KIND,
        trailId: input.id,
        value: result.value,
      });
    } finally {
      lease.release();
    }
  },
  description:
    'Resolve a trail by ID in the current app and execute it through the shared pipeline',
  examples: [
    {
      description:
        'Resolve and execute a trail by ID, returning the inner trail Result value',
      input: buildHappyExampleInput(),
      name: 'Run trail by ID',
    },
    {
      description: 'Reject an unknown trail ID with NotFoundError',
      error: 'NotFoundError',
      input: buildNotFoundExampleInput(),
      name: 'Reject unknown trail ID',
    },
  ],
  input: z.object({
    app: z.string().optional().describe('Workspace app name override'),
    id: z.string().describe('Trail ID to invoke'),
    input: z
      .unknown()
      .optional()
      .describe(
        'Parsed input for the resolved trail; the CLI surface JSON.parses the inline argument before passing it through'
      ),
    module: z.string().optional().describe('Path to the app module'),
    rootDir: z.string().optional().describe('Workspace root directory'),
  }),
  intent: 'write',
  output: innerTrailResultSchema,
});
