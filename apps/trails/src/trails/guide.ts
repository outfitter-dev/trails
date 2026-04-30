/**
 * `guide` trail -- Runtime guidance.
 *
 * Lists trails with descriptions and examples. Detailed guidance is planned for post-v1.
 */

import { NotFoundError, Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { loadFreshAppLease } from './load-app.js';
import { trailDetailOutput } from './topo-output-schemas.js';
import {
  buildCurrentGuideEntries,
  buildCurrentTopoDetail,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const guideTrail = trail('guide', {
  blaze: async (input, ctx) => {
    const rootDir = input.rootDir ?? ctx.cwd ?? process.cwd();
    const lease = await loadFreshAppLease(input.module, rootDir);

    try {
      if (input.trailId) {
        const detail = buildCurrentTopoDetail(lease.app, input.trailId, {
          rootDir,
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
        entries: buildCurrentGuideEntries(lease.app, {
          rootDir,
        }) as GuideEntry[],
        mode: 'list' as const,
      });
    } finally {
      lease.release();
    }
  },
  description: 'Runtime guidance for trails',
  examples: [
    {
      description: 'Lists all trails with descriptions and example counts',
      input: createIsolatedExampleInput('guide-list'),
      name: 'List trail guidance',
    },
  ],
  input: z.object({
    module: z.string().optional().describe('Path to the app module'),
    rootDir: z.string().optional().describe('Workspace root directory'),
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
