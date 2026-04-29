/**
 * `guide` trail -- Runtime guidance.
 *
 * Lists trails with descriptions and examples. Detailed guidance is planned for post-v1.
 */

import { NotFoundError, Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { loadApp } from './load-app.js';
import { trailDetailOutput } from './topo-output-schemas.js';
import {
  buildCurrentGuideEntries,
  buildCurrentTopoDetail,
} from './topo-read-support.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GuideEntry {
  readonly description: string;
  readonly exampleCount: number;
  readonly id: string;
  readonly kind: 'trail';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const guideTrail = trail('guide', {
  blaze: async (input, ctx) => {
    const rootDir = ctx.cwd ?? '.';
    const app = await loadApp(input.module, rootDir);

    if (input.trailId) {
      const detail = buildCurrentTopoDetail(app, input.trailId, { rootDir });
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
      entries: buildCurrentGuideEntries(app, { rootDir }) as GuideEntry[],
      mode: 'list' as const,
    });
  },
  description: 'Runtime guidance for trails',
  examples: [
    {
      description: 'Lists all trails with descriptions and example counts',
      input: { module: './src/app.ts' },
      name: 'List trail guidance',
    },
  ],
  input: z.object({
    module: z.string().optional().describe('Path to the app module'),
    trailId: z.string().optional().describe('Trail ID for detailed guidance'),
  }),
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
