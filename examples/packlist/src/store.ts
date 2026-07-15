/**
 * Schema-derived store for the packlist app.
 *
 * Three versioned tables — `gear`, `pack`, `trip` — authored once and
 * derived everywhere: CRUD factory trails, reconcile trails, store-derived
 * change signals, and mock fixtures for `testAll(app)`.
 *
 * The tables are `versioned: true`, so the framework manages an optimistic
 * concurrency `version` column on every row and each table gets a
 * `reconcile` trail (see `src/trails/reconcile.ts`).
 */

import { store as defineStore } from '@ontrails/store';
import { z } from 'zod';

export const gearCategories = [
  'shelter',
  'cook',
  'wear',
  'carry',
  'other',
] as const;

export const gearSchema = z.object({
  category: z.enum(gearCategories),
  id: z.string(),
  name: z.string(),
  notes: z.string().nullable().optional(),
  weightGrams: z.number(),
});

const packItemSchema = z.object({
  gearId: z.string(),
  quantity: z.number(),
});

export const packSchema = z.object({
  id: z.string(),
  items: z.array(packItemSchema),
  name: z.string(),
});

export const tripStatuses = ['planned', 'active', 'done'] as const;

export const tripSchema = z.object({
  endDate: z.string(),
  id: z.string(),
  name: z.string(),
  notes: z.string().nullable().optional(),
  packId: z.string(),
  startDate: z.string(),
  status: z.enum(tripStatuses),
});

/**
 * Mock fixtures ship stable ids so trail examples can reference them.
 * `gear-oldstove` exists only to be deleted by the `gear.delete` example, so
 * the other examples never race it.
 */
const gearFixtures = [
  {
    category: 'shelter',
    id: 'gear-tent',
    name: 'Tent',
    weightGrams: 1800,
  },
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
  {
    category: 'cook',
    id: 'gear-oldstove',
    name: 'Old Stove',
    weightGrams: 480,
  },
] as const;

const packFixtures = [
  {
    id: 'pack-weekend',
    items: [
      { gearId: 'gear-tent', quantity: 1 },
      { gearId: 'gear-stove', quantity: 1 },
    ],
    name: 'Weekend Loop',
  },
  {
    id: 'pack-retired',
    items: [],
    name: 'Retired Pack',
  },
] as const;

const tripFixtures = [
  {
    endDate: '2026-08-16',
    id: 'trip-lostcoast',
    name: 'Lost Coast',
    packId: 'pack-weekend',
    startDate: '2026-08-14',
    status: 'planned',
  },
  {
    endDate: '2026-05-03',
    id: 'trip-done',
    name: 'Desolation Overnight',
    packId: 'pack-weekend',
    startDate: '2026-05-02',
    status: 'done',
  },
] as const;

export const packlistStore = defineStore({
  gear: {
    fixtures: gearFixtures,
    generated: ['id'],
    identity: 'id',
    schema: gearSchema,
    versioned: true,
  },
  pack: {
    fixtures: packFixtures,
    generated: ['id'],
    identity: 'id',
    schema: packSchema,
    versioned: true,
  },
  trip: {
    fixtures: tripFixtures,
    generated: ['id'],
    identity: 'id',
    schema: tripSchema,
    versioned: true,
  },
});

export type Gear = z.output<typeof gearSchema>;
export type Pack = z.output<typeof packSchema>;
