/**
 * SQLite-backed stash store resource.
 *
 * `db.from(ctx)` hands trails a typed connection whose write methods fire the
 * store's scoped table signals through the trail context. The mock path seeds
 * the deterministic fixtures so `testAll(graph)` and trail examples run with
 * zero configuration; the runtime path seeds the same fixtures so the README
 * quickstart finds data on a fresh boot.
 *
 * Set `STASH_DB_PATH` to persist between CLI invocations; the default is an
 * in-memory database per process.
 */

import { connectDrizzle } from '@ontrails/drizzle';

import { seedTables } from '../fixtures.js';
import { stashStoreDefinition } from '../store.js';

const cloneSeed = () => ({
  revisions: seedTables.revisions.map((row) => ({
    ...row,
    files: row.files.map((file) => ({ ...file })),
  })),
  searchEntries: seedTables.searchEntries.map((row) => ({ ...row })),
  snippets: seedTables.snippets.map((row) => ({ ...row })),
  stars: seedTables.stars.map((row) => ({ ...row })),
  tokens: seedTables.tokens.map((row) => ({ ...row, scopes: [...row.scopes] })),
  users: seedTables.users.map((row) => ({ ...row })),
});

export const db = connectDrizzle(stashStoreDefinition, {
  description:
    'SQLite snippet store: snippets, revisions, stars, users, tokens, and the derived search index.',
  id: 'stash.db',
  mockSeed: cloneSeed(),
  seed: cloneSeed(),
  url: process.env['STASH_DB_PATH'] ?? ':memory:',
});

/** Typed connection shape for the stash store. */
export type StashConnection = ReturnType<(typeof db)['from']>;

/**
 * Construct a freshly seeded in-memory connection for tests.
 *
 * Each call returns independent state, so per-test resource factories never
 * leak writes across tests.
 */
export const createMockDb = () => {
  const bound = connectDrizzle(stashStoreDefinition, {
    id: 'stash.db',
    mockSeed: cloneSeed(),
    url: ':memory:',
  });
  if (bound.mock === undefined) {
    throw new Error('stash db resource requires a mock factory');
  }
  const created = bound.mock();
  if (created instanceof Promise) {
    throw new TypeError('stash db mock must resolve synchronously');
  }
  return created;
};
