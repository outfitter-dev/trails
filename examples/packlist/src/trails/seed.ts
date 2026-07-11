/**
 * Demo seed — one command that makes the quickstart real.
 *
 * Upserts a small, fixed data set (stable ids, so re-running is
 * harmless) directly through the store accessors.
 */

import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { db } from '../resources/db.js';

const demoGear = [
  { category: 'shelter', id: 'gear-tent', name: 'Tent', weightGrams: 1800 },
  {
    category: 'cook',
    id: 'gear-stove',
    name: 'Canister Stove',
    weightGrams: 220,
  },
  {
    category: 'carry',
    id: 'gear-bearcan',
    name: 'Bear Canister',
    notes: 'Required in the Sierra',
    weightGrams: 940,
  },
  { category: 'wear', id: 'gear-puffy', name: 'Down Puffy', weightGrams: 380 },
] as const;

const demoPacks = [
  {
    id: 'pack-weekend',
    items: [
      { gearId: 'gear-tent', quantity: 1 },
      { gearId: 'gear-stove', quantity: 1 },
    ],
    name: 'Weekend Loop',
  },
] as const;

const demoTrips = [
  {
    endDate: '2026-08-16',
    id: 'trip-lostcoast',
    name: 'Lost Coast',
    packId: 'pack-weekend',
    startDate: '2026-08-14',
    status: 'planned',
  },
] as const;

export const seedDemo = trail('seed.demo', {
  description: 'Load the demo gear, pack, and trip (idempotent)',
  examples: [
    {
      description: 'Seeding reports how many rows were written',
      expected: { gear: 4, packs: 1, trips: 1 },
      input: {},
      name: 'Seed the demo data',
    },
  ],
  implementation: async (_input, ctx) => {
    const connection = db.from(ctx);
    for (const gear of demoGear) {
      await connection.gear.upsert(gear);
    }
    for (const pack of demoPacks) {
      await connection.pack.upsert({
        ...pack,
        items: [...pack.items],
      });
    }
    for (const trip of demoTrips) {
      await connection.trip.upsert(trip);
    }
    return Result.ok({
      gear: demoGear.length,
      packs: demoPacks.length,
      trips: demoTrips.length,
    });
  },
  input: z.object({}),
  intent: 'write',
  output: z.object({
    gear: z.number(),
    packs: z.number(),
    trips: z.number(),
  }),
  permit: { scopes: ['packlist:write'] },
  resources: [db],
});
