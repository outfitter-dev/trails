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

import { withFreshAppLease } from './operator-context.js';
import { assertConfiguredAppBinding } from './project-context.js';
import {
  operatorProjectContextOutput,
  operatorProjectContextOutputSchema,
} from './project-context-output.js';
import { resolveRunTargetProject } from './run.js';
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
  executedAppId: z.string(),
  kind: z.literal(RUN_EXAMPLES_LISTING_KIND),
  project: operatorProjectContextOutputSchema,
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
  trailId: string,
  project: RunExamplesListing['project']
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
    executedAppId: app.name,
    kind: RUN_EXAMPLES_LISTING_KIND,
    project,
    trailId,
  });
};

const runExamplesTrailInputSchema = z.object({
  app: z
    .string()
    .optional()
    .describe(
      'Workspace app to resolve the trail ID against; required when the ID is exposed by more than one app'
    ),
  id: z.string().describe('Trail ID whose examples should be listed'),
  module: z.string().optional().describe('Path to the app module'),
  rootDir: z.string().optional().describe('Workspace root directory'),
});

type RunExamplesTrailInput = z.output<typeof runExamplesTrailInputSchema>;

export const runExamplesTrail = trail('run.examples', {
  args: ['id'],
  description: "List a trail's examples without executing it",
  examples: [
    {
      description: 'List examples authored on a target trail',
      input: buildHappyExampleInput(),
      name: 'List trail examples',
    },
  ],
  implementation: async (input: RunExamplesTrailInput, ctx) => {
    const target = await resolveRunTargetProject(input, input.id, {
      cwd: ctx.cwd,
    });
    if (target.isErr()) {
      return target;
    }
    return withFreshAppLease(
      target.value.modulePath,
      target.value.rootDir,
      (lease) => {
        const binding = assertConfiguredAppBinding(
          target.value.context,
          lease.app.name
        );
        if (binding.isErr()) {
          return binding;
        }
        return buildExamplesListing(
          lease.app,
          input.id,
          operatorProjectContextOutput(target.value.context)
        );
      }
    );
  },
  input: runExamplesTrailInputSchema,
  intent: 'read',
  output: runExamplesListingSchema,
});
