/**
 * Gear trails — hand-authored CRUD for the `gear` table.
 *
 * Unlike `pack` and `trip` (which take the derived CRUD factory as-is),
 * gear trails are authored by hand because they tighten the contract beyond
 * what the factory derives: a duplicate-name conflict on create, a real
 * v1→v2 version history on `gear.create`, and a `pack.weight-stale` fire on
 * `gear.update`. The schemas stay inside the version-marker subset (plain
 * objects, primitives, enums, optionals) as versioned contracts require.
 */

import {
  AlreadyExistsError,
  NotFoundError,
  Result,
  forkVersion,
  trail,
} from '@ontrails/core';
import { z } from 'zod';

import { db } from '../resources/db.js';
import { packWeightStale } from '../signals.js';
import { gearCategories } from '../store.js';

const GRAMS_PER_OUNCE = 28.3495;

const categorySchema = z
  .enum(gearCategories)
  .describe('Gear category: shelter, cook, wear, carry, or other');

/** Full gear entity as stored, including the framework-managed version. */
export const gearEntitySchema = z.object({
  category: categorySchema,
  id: z.string().describe('Generated gear id'),
  name: z.string().describe('Unique gear name'),
  notes: z.string().nullable().optional().describe('Free-form notes'),
  version: z.number().describe('Optimistic concurrency version'),
  weightGrams: z.number().describe('Weight in grams'),
});

/**
 * The v1 `gear.create` contract, preserved as a fork entry below. Version 1
 * accepted (and reported) ounces; version 2 moved the contract to grams.
 */
const gearCreateV1Input = z.object({
  category: categorySchema,
  name: z.string().describe('Unique gear name'),
  notes: z.string().nullable().optional().describe('Free-form notes'),
  weightOz: z.number().describe('Weight in ounces'),
});

const gearEntityV1Schema = z.object({
  category: categorySchema,
  id: z.string().describe('Generated gear id'),
  name: z.string().describe('Unique gear name'),
  notes: z.string().nullable().optional().describe('Free-form notes'),
  version: z.number().describe('Optimistic concurrency version'),
  weightOz: z.number().describe('Weight in ounces'),
});

export const create = trail('gear.create', {
  description: 'Add a piece of gear to the locker',
  examples: [
    {
      description: 'Create gear with a unique name',
      expectedMatch: {
        category: 'other',
        name: 'Sleeping Bag',
        weightGrams: 860,
      },
      input: { category: 'other', name: 'Sleeping Bag', weightGrams: 860 },
      name: 'Add new gear',
    },
    {
      description: 'Duplicate gear names are rejected with a conflict',
      error: 'AlreadyExistsError',
      input: { category: 'shelter', name: 'Tent', weightGrams: 1700 },
      name: 'Duplicate gear name conflicts',
    },
  ],
  implementation: async (input, ctx) => {
    const connection = db.from(ctx);
    const duplicates = await connection.gear.list({ name: input.name });
    if (duplicates.length > 0) {
      return Result.err(
        new AlreadyExistsError(`Gear named "${input.name}" already exists`)
      );
    }
    const gear = await connection.gear.insert(input);
    return Result.ok(gear);
  },
  input: z.object({
    category: categorySchema,
    name: z.string().describe('Unique gear name'),
    notes: z.string().nullable().optional().describe('Free-form notes'),
    weightGrams: z.number().describe('Weight in grams'),
  }),
  intent: 'write',
  output: gearEntitySchema,
  permit: { scopes: ['packlist:write'] },
  resources: [db],
  version: 2,
  versions: {
    1: forkVersion({
      examples: [
        {
          description: 'The v1 contract accepts ounces and reports ounces',
          expectedMatch: { category: 'shelter', name: 'Ultralight Tarp' },
          input: { category: 'shelter', name: 'Ultralight Tarp', weightOz: 16 },
          name: 'Add gear in ounces (v1)',
        },
        {
          description: 'The duplicate-name conflict predates v2',
          error: 'AlreadyExistsError',
          input: { category: 'shelter', name: 'Tent', weightOz: 60 },
          name: 'Duplicate gear name conflicts (v1)',
        },
      ],
      implementation: async (input, ctx) => {
        const connection = db.from(ctx);
        const duplicates = await connection.gear.list({ name: input.name });
        if (duplicates.length > 0) {
          return Result.err(
            new AlreadyExistsError(`Gear named "${input.name}" already exists`)
          );
        }
        const gear = await connection.gear.insert({
          category: input.category,
          name: input.name,
          ...(input.notes === undefined ? {} : { notes: input.notes }),
          weightGrams: input.weightOz * GRAMS_PER_OUNCE,
        });
        const { weightGrams, ...rest } = gear;
        return Result.ok({
          ...rest,
          weightOz: weightGrams / GRAMS_PER_OUNCE,
        });
      },
      input: gearCreateV1Input,
      output: gearEntityV1Schema,
      resources: [db],
      status: {
        migration: [
          'Send weightGrams instead of weightOz (1 oz = 28.3495 g).',
          'Read weights back in grams; v2 responses no longer include weightOz.',
        ],
        note: 'v1 stays callable through version negotiation while integrations move to grams.',
        state: 'deprecated',
        successor: 2,
      },
    }),
  },
});

export const read = trail('gear.read', {
  description: 'Show one piece of gear by id',
  examples: [
    {
      description: 'Look up gear by its id',
      expectedMatch: { id: 'gear-tent', name: 'Tent' },
      input: { id: 'gear-tent' },
      name: 'Read existing gear',
    },
    {
      description: 'Missing ids report not found',
      error: 'NotFoundError',
      input: { id: 'gear-missing' },
      name: 'Read missing gear',
    },
  ],
  implementation: async (input, ctx) => {
    const connection = db.from(ctx);
    const gear = await connection.gear.get(input.id);
    if (!gear) {
      return Result.err(new NotFoundError(`Gear "${input.id}" not found`));
    }
    return Result.ok(gear);
  },
  input: z.object({
    id: z.string().describe('Gear id to look up'),
  }),
  intent: 'read',
  output: gearEntitySchema,
  resources: [db],
});

export const update = trail('gear.update', {
  description:
    'Update fields on a piece of gear; weight changes mark carrying packs stale',
  examples: [
    {
      description: 'Re-weighing gear carried by a pack fires pack.weight-stale',
      expectedMatch: { id: 'gear-stove', weightGrams: 250 },
      input: { id: 'gear-stove', weightGrams: 250 },
      name: 'Update gear weight',
      signals: [
        {
          payloadMatch: {
            gearId: 'gear-stove',
            packIds: ['pack-weekend'],
            weightGrams: 250,
          },
          signal: packWeightStale,
        },
      ],
    },
    {
      description: 'Missing ids report not found',
      error: 'NotFoundError',
      input: { id: 'gear-missing', weightGrams: 1 },
      name: 'Update missing gear',
    },
  ],
  fires: [packWeightStale],
  implementation: async (input, ctx) => {
    const connection = db.from(ctx);
    const existing = await connection.gear.get(input.id);
    if (!existing) {
      return Result.err(new NotFoundError(`Gear "${input.id}" not found`));
    }
    const gear = await connection.gear.update(input.id, {
      ...(input.category === undefined ? {} : { category: input.category }),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      ...(input.weightGrams === undefined
        ? {}
        : { weightGrams: input.weightGrams }),
    });
    if (!gear) {
      return Result.err(new NotFoundError(`Gear "${input.id}" not found`));
    }
    if (gear.weightGrams !== existing.weightGrams) {
      const packs = await connection.pack.list();
      const packIds = packs
        .filter((pack) => pack.items.some((item) => item.gearId === gear.id))
        .map((pack) => pack.id);
      if (packIds.length > 0) {
        await ctx.fire?.(packWeightStale, {
          gearId: gear.id,
          gearName: gear.name,
          packIds,
          previousWeightGrams: existing.weightGrams,
          weightGrams: gear.weightGrams,
        });
      }
    }
    return Result.ok(gear);
  },
  input: z.object({
    category: categorySchema.optional(),
    id: z.string().describe('Gear id to update'),
    name: z.string().optional().describe('New unique gear name'),
    notes: z.string().nullable().optional().describe('Free-form notes'),
    weightGrams: z.number().optional().describe('Weight in grams'),
  }),
  intent: 'write',
  output: gearEntitySchema,
  permit: { scopes: ['packlist:write'] },
  resources: [db],
});

export const remove = trail('gear.delete', {
  description: 'Remove a piece of gear from the locker',
  examples: [
    {
      description: 'Delete gear that exists',
      expected: { deleted: true, id: 'gear-oldstove' },
      input: { id: 'gear-oldstove' },
      name: 'Delete existing gear',
    },
    {
      description: 'Missing ids report not found',
      error: 'NotFoundError',
      input: { id: 'gear-missing' },
      name: 'Delete missing gear',
    },
  ],
  implementation: async (input, ctx) => {
    const connection = db.from(ctx);
    const existing = await connection.gear.get(input.id);
    if (!existing) {
      return Result.err(new NotFoundError(`Gear "${input.id}" not found`));
    }
    await connection.gear.remove(input.id);
    return Result.ok({ deleted: true, id: input.id });
  },
  input: z.object({
    id: z.string().describe('Gear id to delete'),
  }),
  intent: 'destroy',
  output: z.object({
    deleted: z.boolean(),
    id: z.string(),
  }),
  permit: { scopes: ['packlist:write'] },
  resources: [db],
});

export const list = trail('gear.list', {
  description: 'List gear, optionally filtered by category',
  examples: [
    {
      description: 'List the whole gear locker',
      input: {},
      name: 'List all gear',
    },
    {
      description: 'Filter the locker down to one category',
      input: { category: 'cook' },
      name: 'List cook gear',
    },
  ],
  implementation: async (input, ctx) => {
    const connection = db.from(ctx);
    const filters =
      input.category === undefined ? undefined : { category: input.category };
    const gear = await connection.gear.list(filters);
    return Result.ok(gear);
  },
  input: z.object({
    category: categorySchema.optional(),
  }),
  intent: 'read',
  output: z.array(gearEntitySchema),
  resources: [db],
});
