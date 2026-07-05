/**
 * Derived pack weight — the reactive loop of the showcase.
 *
 * `pack.weight` recomputes a pack's total from current gear weights on
 * every call (`totalWeightGrams` is never stored), composing `gear.read`
 * through `ctx.compose()`. `pack.recalculate` consumes the authored
 * `pack.weight-stale` signal that `gear.update` fires, recomputes each
 * affected pack, and logs the fresh totals — which is what makes the loop
 * visible in normal CLI output.
 */

import { NotFoundError, Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { db } from '../resources/db.js';
import { packWeightStale } from '../signals.js';
import type { Gear } from '../store.js';

const weightItemSchema = z.object({
  gearId: z.string().describe('Gear carried in the pack'),
  name: z.string().describe('Gear name'),
  quantity: z.number().describe('How many are carried'),
  subtotalGrams: z.number().describe('quantity × weightGrams'),
  weightGrams: z.number().describe('Current weight of one unit'),
});

export const weight = trail('pack.weight', {
  blaze: async (input, ctx) => {
    const connection = db.from(ctx);
    const pack = await connection.pack.get(input.packId);
    if (!pack) {
      return Result.err(new NotFoundError(`Pack "${input.packId}" not found`));
    }
    const items = [];
    for (const item of pack.items) {
      const gear = await ctx.compose<Gear & { version: number }>('gear.read', {
        id: item.gearId,
      });
      if (gear.isErr()) {
        return gear;
      }
      items.push({
        gearId: item.gearId,
        name: gear.value.name,
        quantity: item.quantity,
        subtotalGrams: item.quantity * gear.value.weightGrams,
        weightGrams: gear.value.weightGrams,
      });
    }
    const totalWeightGrams = items.reduce(
      (total, item) => total + item.subtotalGrams,
      0
    );
    return Result.ok({
      items,
      name: pack.name,
      packId: pack.id,
      totalWeightGrams,
    });
  },
  composes: ['gear.read'],
  description:
    'Derive a pack’s total weight from current gear weights (never stored)',
  examples: [
    {
      description: 'Weekend Loop carries the tent and stove fixtures',
      expectedMatch: {
        name: 'Weekend Loop',
        packId: 'pack-weekend',
        totalWeightGrams: 2020,
      },
      input: { packId: 'pack-weekend' },
      name: 'Weigh a pack',
    },
    {
      description: 'Unknown pack ids report not found',
      error: 'NotFoundError',
      input: { packId: 'pack-missing' },
      name: 'Weigh a missing pack',
    },
  ],
  input: z.object({
    packId: z.string().describe('Pack id to weigh'),
  }),
  intent: 'read',
  output: z.object({
    items: z.array(weightItemSchema),
    name: z.string(),
    packId: z.string(),
    totalWeightGrams: z.number(),
  }),
  resources: [db],
});

export const recalculate = trail('pack.recalculate', {
  blaze: async (input, ctx) => {
    const recalculated = [];
    for (const packId of input.packIds) {
      const result = await ctx.compose<{
        name: string;
        packId: string;
        totalWeightGrams: number;
      }>('pack.weight', { packId });
      if (result.isErr()) {
        ctx.logger?.warn('pack.recalculate skipped a pack', {
          error: result.error.message,
          packId,
        });
        continue;
      }
      ctx.logger?.info(
        `pack "${result.value.name}" recalculated: ${result.value.totalWeightGrams} g (${input.gearName}: ${input.previousWeightGrams} g → ${input.weightGrams} g)`,
        { packId }
      );
      recalculated.push({
        name: result.value.name,
        packId: result.value.packId,
        totalWeightGrams: result.value.totalWeightGrams,
      });
    }
    return Result.ok({ recalculated });
  },
  composes: ['pack.weight'],
  description:
    'React to pack.weight-stale by recomputing and logging affected pack weights',
  examples: [
    {
      description: 'Recompute the packs named in the stale signal payload',
      input: {
        gearId: 'gear-stove',
        gearName: 'Canister Stove',
        packIds: ['pack-weekend'],
        previousWeightGrams: 220,
        weightGrams: 250,
      },
      name: 'Recalculate stale packs',
    },
    {
      description: 'An empty pack list is a no-op',
      expected: { recalculated: [] },
      input: {
        gearId: 'gear-stove',
        gearName: 'Canister Stove',
        packIds: [],
        previousWeightGrams: 220,
        weightGrams: 250,
      },
      name: 'Recalculate nothing',
    },
  ],
  input: z.object({
    gearId: z.string().describe('Gear whose weight changed'),
    gearName: z.string().describe('Name of the changed gear'),
    packIds: z.array(z.string()).describe('Packs to recompute'),
    previousWeightGrams: z.number().describe('Weight before the update'),
    weightGrams: z.number().describe('Weight after the update'),
  }),
  intent: 'read',
  on: [packWeightStale],
  output: z.object({
    recalculated: z.array(
      z.object({
        name: z.string(),
        packId: z.string(),
        totalWeightGrams: z.number(),
      })
    ),
  }),
  resources: [db],
});
