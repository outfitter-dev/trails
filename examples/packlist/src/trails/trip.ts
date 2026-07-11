/**
 * Trip trails — derived CRUD plus lifecycle and the checklist composition.
 *
 * The CRUD set comes from the factory (see `pack.ts` for the pattern).
 * `trip.complete` is a lifecycle write with a validation error path, and
 * `trip.checklist` is the composition showcase: it gathers `pack.read` and
 * `gear.list` through `ctx.compose()` and joins them into checklist rows.
 */

import { NotFoundError, Result, ValidationError, trail } from '@ontrails/core';
import { crud } from '@ontrails/store/trails';
import { z } from 'zod';

import { db } from '../resources/db.js';
import { packlistStore, tripStatuses } from '../store.js';
import type { Gear, Pack } from '../store.js';

const writePermit = { scopes: ['packlist:write'] } as const;

const tripCrud = crud(packlistStore.tables.trip, db, {
  permits: {
    create: writePermit,
    delete: writePermit,
    update: writePermit,
  },
});

export const [create, read, update, remove, list] = tripCrud;

/** Shared with `reconcile()` so the topo sees one `trip` contour instance. */
export const tripContour = tripCrud.contour;

const tripEntitySchema = z.object({
  endDate: z.string().describe('Trip end date (ISO)'),
  id: z.string().describe('Generated trip id'),
  name: z.string().describe('Trip name'),
  notes: z.string().nullable().optional().describe('Free-form notes'),
  packId: z.string().describe('Pack carried on this trip'),
  startDate: z.string().describe('Trip start date (ISO)'),
  status: z.enum(tripStatuses).describe('planned, active, or done'),
  version: z.number().describe('Optimistic concurrency version'),
});

export const complete = trail('trip.complete', {
  description: 'Mark a trip as done',
  examples: [
    {
      description: 'Completing a planned trip flips its status',
      expectedMatch: { id: 'trip-lostcoast', status: 'done' },
      input: { id: 'trip-lostcoast' },
      name: 'Complete a planned trip',
    },
    {
      description: 'Trips cannot be completed twice',
      error: 'ValidationError',
      input: { id: 'trip-done' },
      name: 'Complete an already-done trip',
    },
  ],
  implementation: async (input, ctx) => {
    const connection = db.from(ctx);
    const trip = await connection.trip.get(input.id);
    if (!trip) {
      return Result.err(new NotFoundError(`Trip "${input.id}" not found`));
    }
    if (trip.status === 'done') {
      return Result.err(
        new ValidationError(`Trip "${trip.name}" is already done`)
      );
    }
    const updated = await connection.trip.update(input.id, { status: 'done' });
    if (!updated) {
      return Result.err(new NotFoundError(`Trip "${input.id}" not found`));
    }
    return Result.ok(updated);
  },
  input: z.object({
    id: z.string().describe('Trip id to complete'),
  }),
  intent: 'write',
  output: tripEntitySchema,
  permit: writePermit,
  resources: [db],
});

const checklistRowSchema = z.object({
  category: z.string().describe('Gear category'),
  name: z.string().describe('Gear name'),
  packed: z.boolean().describe('Starting state for the checklist'),
  quantity: z.number().describe('How many to pack'),
  weightGrams: z.number().describe('Weight of one unit'),
});

export const checklist = trail('trip.checklist', {
  composes: ['pack.read', 'gear.list'],
  description: 'Build the packing checklist for a trip from its pack',
  examples: [
    {
      description: 'Checklist rows join pack items with current gear',
      expectedMatch: {
        packName: 'Weekend Loop',
        totalWeightGrams: 2020,
        tripName: 'Lost Coast',
      },
      input: { id: 'trip-lostcoast' },
      name: 'Checklist for a planned trip',
    },
    {
      description: 'Unknown trip ids report not found',
      error: 'NotFoundError',
      input: { id: 'trip-missing' },
      name: 'Checklist for a missing trip',
    },
  ],
  implementation: async (input, ctx) => {
    const connection = db.from(ctx);
    const trip = await connection.trip.get(input.id);
    if (!trip) {
      return Result.err(new NotFoundError(`Trip "${input.id}" not found`));
    }
    const pack = await ctx.compose<Pack & { version: number }>('pack.read', {
      id: trip.packId,
    });
    if (pack.isErr()) {
      return pack;
    }
    const gear = await ctx.compose<(Gear & { version: number })[]>(
      'gear.list',
      {}
    );
    if (gear.isErr()) {
      return gear;
    }
    const gearById = new Map(gear.value.map((item) => [item.id, item]));
    const rows = [];
    for (const item of pack.value.items) {
      const carried = gearById.get(item.gearId);
      if (!carried) {
        continue;
      }
      rows.push({
        category: carried.category,
        name: carried.name,
        packed: false,
        quantity: item.quantity,
        weightGrams: carried.weightGrams,
      });
    }
    const totalWeightGrams = rows.reduce(
      (total, row) => total + row.quantity * row.weightGrams,
      0
    );
    return Result.ok({
      packName: pack.value.name,
      rows,
      totalWeightGrams,
      tripId: trip.id,
      tripName: trip.name,
    });
  },
  input: z.object({
    id: z.string().describe('Trip id to build a checklist for'),
  }),
  intent: 'read',
  output: z.object({
    packName: z.string(),
    rows: z.array(checklistRowSchema),
    totalWeightGrams: z.number(),
    tripId: z.string(),
    tripName: z.string(),
  }),
  resources: [db],
});
