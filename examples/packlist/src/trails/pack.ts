/**
 * Pack trails — derived CRUD plus hand-authored item management.
 *
 * The five CRUD trails (`pack.create`, `pack.read`, `pack.update`,
 * `pack.delete`, `pack.list`) come straight from the CRUD factory: schemas,
 * examples, implementations, permits, and resource wiring are all derived from the
 * table definition and the factory options.
 *
 * `pack.add-gear` and `pack.remove-gear` are authored by hand: they carry
 * cross-table checks (the gear must exist) that the factory cannot derive.
 */

import { NotFoundError, Result, trail } from '@ontrails/core';
import { crud } from '@ontrails/store/trails';
import { z } from 'zod';

import { db } from '../resources/db.js';
import { packlistStore } from '../store.js';

const writePermit = { scopes: ['packlist:write'] } as const;

const packCrud = crud(packlistStore.tables.pack, db, {
  permits: {
    create: writePermit,
    delete: writePermit,
    update: writePermit,
  },
});

export const [create, read, update, remove, list] = packCrud;

/** Shared with `reconcile()` so the topo sees one `pack` entity instance. */
export const packEntity = packCrud.entity;

/** Pack entity shape shared by the hand-authored pack trails. */
export const packEntitySchema = z.object({
  id: z.string().describe('Generated pack id'),
  items: z.array(
    z.object({
      gearId: z.string().describe('Gear carried in this pack'),
      quantity: z.number().describe('How many of that gear'),
    })
  ),
  name: z.string().describe('Pack name'),
  version: z.number().describe('Optimistic concurrency version'),
});

export const addGear = trail('pack.add-gear', {
  description: 'Add gear to a pack (or increase its quantity)',
  examples: [
    {
      description: 'Adding gear appends an item line to the pack',
      expectedMatch: { id: 'pack-weekend' },
      input: { gearId: 'gear-bearcan', packId: 'pack-weekend', quantity: 1 },
      name: 'Add gear to a pack',
    },
    {
      description: 'Quantities below one are rejected at the boundary',
      error: 'ValidationError',
      input: { gearId: 'gear-tent', packId: 'pack-weekend', quantity: 0 },
      name: 'Reject zero quantity',
    },
    {
      description: 'Unknown gear ids report not found',
      error: 'NotFoundError',
      input: { gearId: 'gear-missing', packId: 'pack-weekend', quantity: 1 },
      name: 'Add missing gear',
    },
  ],
  implementation: async (input, ctx) => {
    const connection = db.from(ctx);
    const pack = await connection.pack.get(input.packId);
    if (!pack) {
      return Result.err(new NotFoundError(`Pack "${input.packId}" not found`));
    }
    const gear = await connection.gear.get(input.gearId);
    if (!gear) {
      return Result.err(new NotFoundError(`Gear "${input.gearId}" not found`));
    }
    const existing = pack.items.find((item) => item.gearId === input.gearId);
    const items = existing
      ? pack.items.map((item) =>
          item.gearId === input.gearId
            ? { gearId: item.gearId, quantity: item.quantity + input.quantity }
            : item
        )
      : [...pack.items, { gearId: input.gearId, quantity: input.quantity }];
    const updated = await connection.pack.update(input.packId, { items });
    return Result.ok(updated);
  },
  input: z.object({
    gearId: z.string().describe('Gear id to add'),
    packId: z.string().describe('Pack id to modify'),
    quantity: z.number().min(1).describe('How many to add (at least 1)'),
  }),
  intent: 'write',
  output: packEntitySchema,
  permit: writePermit,
  resources: [db],
});

export const removeGear = trail('pack.remove-gear', {
  description: 'Remove gear from a pack (idempotent)',
  examples: [
    {
      description: 'Removing carried gear drops its item line',
      expectedMatch: { id: 'pack-weekend' },
      input: { gearId: 'gear-stove', packId: 'pack-weekend' },
      name: 'Remove gear from a pack',
    },
    {
      description: 'Removing gear that is not in the pack is a no-op',
      expectedMatch: { id: 'pack-weekend' },
      input: { gearId: 'gear-bearcan', packId: 'pack-weekend' },
      name: 'Remove absent gear is idempotent',
    },
    {
      description: 'Unknown pack ids report not found',
      error: 'NotFoundError',
      input: { gearId: 'gear-tent', packId: 'pack-missing' },
      name: 'Remove from missing pack',
    },
  ],
  implementation: async (input, ctx) => {
    const connection = db.from(ctx);
    const pack = await connection.pack.get(input.packId);
    if (!pack) {
      return Result.err(new NotFoundError(`Pack "${input.packId}" not found`));
    }
    const items = pack.items.filter((item) => item.gearId !== input.gearId);
    if (items.length === pack.items.length) {
      return Result.ok(pack);
    }
    const updated = await connection.pack.update(input.packId, { items });
    return Result.ok(updated);
  },
  input: z.object({
    gearId: z.string().describe('Gear id to remove'),
    packId: z.string().describe('Pack id to modify'),
  }),
  intent: 'write',
  output: packEntitySchema,
  permit: writePermit,
  resources: [db],
});
