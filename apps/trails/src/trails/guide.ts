/**
 * `guide` trail -- Runtime guidance.
 *
 * Lists trails with descriptions and examples. Detailed guidance is planned for post-v1.
 */

import type { Topo, Trail } from '@ontrails/core';
import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { loadApp } from './load-app.js';

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

const toGuideEntries = (app: Topo): GuideEntry[] => {
  const entries: GuideEntry[] = [];

  for (const item of app.list()) {
    const raw = item as unknown as Record<string, unknown>;
    entries.push({
      description:
        typeof raw['description'] === 'string'
          ? raw['description']
          : '(no description)',
      exampleCount: Array.isArray(raw['examples'])
        ? (raw['examples'] as unknown[]).length
        : 0,
      id: item.id,
      kind: item.kind,
    });
  }

  return entries;
};

const toGuideDetail = (item: Trail<unknown, unknown>): object => ({
  description: item.description ?? null,
  detours: item.detours ?? null,
  examples: item.examples ?? [],
  id: item.id,
  kind: item.kind,
});

export const guideTrail = trail('guide', {
  description: 'Runtime guidance for trails',
  examples: [
    {
      description: 'Lists all trails with descriptions and example counts',
      input: {},
      name: 'List trail guidance',
    },
  ],
  implementation: async (input, ctx) => {
    const app = await loadApp(input.module, ctx.cwd ?? '.');

    if (input.trailId) {
      const item = app.get(input.trailId);
      if (!item) {
        return Result.err(new Error(`Trail not found: ${input.trailId}`));
      }
      return Result.ok(toGuideDetail(item as Trail<unknown, unknown>));
    }

    return Result.ok(toGuideEntries(app));
  },
  input: z.object({
    module: z
      .string()
      .default('./src/app.ts')
      .describe('Path to the app module'),
    trailId: z.string().optional().describe('Trail ID for detailed guidance'),
  }),
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
  readOnly: true,
});
