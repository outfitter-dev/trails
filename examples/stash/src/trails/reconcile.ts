/**
 * Maintenance reconcile trail from the store factory.
 *
 * `snippets` is the store's one versioned table, so it is the one that takes
 * reconcile coverage: a versioned upsert that retries once on optimistic
 * concurrency conflicts using last-write-wins.
 */

import { reconcile } from '@ontrails/store/trails';

import { db } from '../resources/db.js';
import { stashStoreDefinition } from '../store.js';

export const reconcileSnippet = reconcile({
  description:
    'Reconcile a snippet row by versioned upsert (last-write-wins on conflict)',
  resource: db,
  strategy: 'last-write-wins',
  table: stashStoreDefinition.tables.snippets,
});
