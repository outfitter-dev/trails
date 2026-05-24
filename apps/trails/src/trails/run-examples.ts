/**
 * `run.examples` trail -- list examples for a target trail.
 */

import {
  NotFoundError,
  Result,
  deriveStructuredTrailExamples,
  trail,
} from '@ontrails/core';
import type { StructuredTrailExample, Topo } from '@ontrails/core';
import { z } from 'zod';

import { tryLoadFreshAppLease } from './load-app.js';
import { resolveRunModulePath } from './run.js';
import { resolveTrailRootDir } from './root-dir.js';
import { createIsolatedExampleInput } from './topo-support.js';

export const RUN_EXAMPLES_LISTING_KIND = 'examples-listing' as const;

export const structuredTrailExampleSchema = z
  .object({
    description: z.string().optional(),
    error: z.string().optional(),
    expected: z.unknown().optional(),
    expectedMatch: z.unknown().optional(),
    input: z.unknown(),
    kind: z.union([z.literal('success'), z.literal('error')]),
    name: z.string(),
    provenance: z.object({ source: z.literal('trail.examples') }),
    signals: z
      .array(
        z.object({
          payload: z.unknown().optional(),
          payloadMatch: z.unknown().optional(),
          signalId: z.string(),
          times: z.number().optional(),
        })
      )
      .readonly()
      .optional(),
  })
  .passthrough();

export const runExamplesListingSchema = z.object({
  examples: z.array(structuredTrailExampleSchema).readonly(),
  kind: z.literal(RUN_EXAMPLES_LISTING_KIND),
  trailId: z.string(),
});

export type RunExamplesListing = z.infer<typeof runExamplesListingSchema>;

const buildHappyExampleInput = (): {
  readonly id: string;
  readonly module: string;
  readonly rootDir: string;
} => ({
  ...createIsolatedExampleInput('run-examples-happy'),
  id: 'survey.brief',
});

const buildExamplesListing = (
  app: Topo,
  trailId: string
): Result<RunExamplesListing, Error> => {
  const target = app.get(trailId);
  if (target === undefined) {
    return Result.err(
      new NotFoundError(
        `Trail '${trailId}' was not found in the resolved app.`,
        { context: { trailId } }
      )
    );
  }

  const structured =
    (deriveStructuredTrailExamples(target.examples) as
      | readonly StructuredTrailExample[]
      | undefined) ?? [];
  return Result.ok({
    examples: structured as unknown as RunExamplesListing['examples'],
    kind: RUN_EXAMPLES_LISTING_KIND,
    trailId,
  });
};

export const runExamplesTrail = trail('run.examples', {
  args: ['id'],
  blaze: async (input, ctx) => {
    const rootDirResult = resolveTrailRootDir(input.rootDir, ctx.cwd);
    if (rootDirResult.isErr()) {
      return rootDirResult;
    }
    const rootDir = rootDirResult.value;
    const moduleResolution = await resolveRunModulePath(
      rootDir,
      input.module,
      input.id,
      input.app
    );
    if (moduleResolution.isErr()) {
      return moduleResolution;
    }

    const leaseResult = await tryLoadFreshAppLease(
      moduleResolution.value,
      rootDir
    );
    if (leaseResult.isErr()) {
      return leaseResult;
    }
    const lease = leaseResult.value;

    try {
      return buildExamplesListing(lease.app, input.id);
    } finally {
      lease.release();
    }
  },
  description: "List a trail's examples without executing it",
  examples: [
    {
      description: 'List examples authored on a target trail',
      input: buildHappyExampleInput(),
      name: 'List trail examples',
    },
  ],
  input: z.object({
    app: z
      .string()
      .optional()
      .describe(
        'Workspace app to resolve the trail ID against; required when the ID is exposed by more than one app'
      ),
    id: z.string().describe('Trail ID whose examples should be listed'),
    module: z.string().optional().describe('Path to the app module'),
    rootDir: z.string().optional().describe('Workspace root directory'),
  }),
  intent: 'read',
  output: runExamplesListingSchema,
});
