/**
 * `guide` trail -- Runtime guidance.
 *
 * Lists trails with descriptions and examples. Detailed guidance is planned for post-v1.
 */

import { NotFoundError, Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { loadApp } from './load-app.js';
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
  readonly kind: string;
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
        description: detail.description,
        detours: detail.detours,
        examples: detail.examples,
        id: detail.id,
        kind: detail.kind,
      });
    }

    return Result.ok(
      buildCurrentGuideEntries(app, { rootDir }) as GuideEntry[]
    );
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
  output: z.union([
    z.array(
      z.object({
        description: z.string(),
        exampleCount: z.number(),
        id: z.string(),
        kind: z.string(),
      })
    ),
    z.object({
      description: z.string().nullable(),
      detours: z.unknown().nullable(),
      examples: z.array(z.unknown()),
      id: z.string(),
      kind: z.string(),
    }),
  ]),
});
