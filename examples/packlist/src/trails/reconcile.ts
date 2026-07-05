/**
 * Reconcile trails — one per versioned table.
 *
 * `reconcile()` completes the versioned-store pattern: it upserts a full
 * row carrying an expected `version` and retries once through a
 * ConflictError detour using the declared strategy. `last-write-wins` keeps
 * the demo simple; real apps can pass a merge function instead.
 *
 * The pack and trip reconcile trails reuse the contour their `crud()` call
 * exposes, so the topo sees a single contour instance per table.
 */

import { reconcile } from '@ontrails/store/trails';

import { db } from '../resources/db.js';
import { packlistStore } from '../store.js';

import { packContour } from './pack.js';
import { tripContour } from './trip.js';

const writePermit = { scopes: ['packlist:write'] } as const;

export const gearReconcile = reconcile({
  permit: writePermit,
  resource: db,
  strategy: 'last-write-wins',
  table: packlistStore.tables.gear,
});

export const packReconcile = reconcile({
  contour: packContour,
  permit: writePermit,
  resource: db,
  strategy: 'last-write-wins',
  table: packlistStore.tables.pack,
});

export const tripReconcile = reconcile({
  contour: tripContour,
  permit: writePermit,
  resource: db,
  strategy: 'last-write-wins',
  table: packlistStore.tables.trip,
});
