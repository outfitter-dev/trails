/**
 * `guide` trail -- Runtime guidance.
 *
 * Lists trails with descriptions and examples. Detailed guidance is planned for post-v1.
 */

import { NotFoundError, Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { withFreshOperatorApp } from './operator-context.js';
import { trailDetailOutput } from './topo-output-schemas.js';
import {
  deriveCurrentGuideEntries,
  deriveCurrentTopoDetail,
  readSurfaceLayerNamesFromContext,
} from './topo-read-support.js';
import { createIsolatedExampleInput } from './topo-support.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GuideEntry {
  readonly description: string;
  readonly exampleCount: number;
  readonly id: string;
  readonly kind: 'trail';
}

type GuideTrailOutput =
  | {
      readonly entries: GuideEntry[];
      readonly mode: 'list';
    }
  | {
      readonly detail: z.output<typeof trailDetailOutput>;
      readonly mode: 'detail';
    };

const guideTrailInputSchema = z.object({
  module: z.string().optional().describe('Path to the app module'),
  rootDir: z.string().optional().describe('Workspace root directory'),
  trailId: z.string().optional().describe('Trail ID for detailed guidance'),
});

type GuideTrailInput = z.output<typeof guideTrailInputSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const guideTrail = trail('guide', {
  description: 'Runtime guidance for trails',
  examples: [
    {
      description: 'Lists all trails with descriptions and example counts',
      input: createIsolatedExampleInput('guide-list'),
      name: 'List trail guidance',
    },
  ],
  implementation: async (input: GuideTrailInput, ctx) =>
    withFreshOperatorApp<GuideTrailOutput>(input, ctx, ({ lease, rootDir }) => {
      if (input.trailId) {
        const detail = deriveCurrentTopoDetail(lease.app, input.trailId, {
          overlays: lease.overlays,
          rootDir,
          surfaceLayerNames: readSurfaceLayerNamesFromContext(ctx),
        });
        if (detail === undefined || detail.kind !== 'trail') {
          return Result.err(
            new NotFoundError(`Trail not found: ${input.trailId}`)
          );
        }
        return Result.ok({
          detail,
          mode: 'detail' as const,
        });
      }

      return Result.ok({
        entries: deriveCurrentGuideEntries(lease.app, {
          rootDir,
        }) as GuideEntry[],
        mode: 'list' as const,
      });
    }),
  input: guideTrailInputSchema,
  intent: 'read',
  output: z.discriminatedUnion('mode', [
    z.object({
      entries: z.array(
        z.object({
          description: z.string(),
          exampleCount: z.number(),
          id: z.string(),
          kind: z.literal('trail'),
        })
      ),
      mode: z.literal('list'),
    }),
    z.object({
      detail: trailDetailOutput,
      mode: z.literal('detail'),
    }),
  ]),
});
