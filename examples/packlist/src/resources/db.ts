/**
 * The packlist `db` resource — a Drizzle-backed SQLite store.
 *
 * Runtime opens (or creates) a SQLite file so state persists across CLI
 * invocations and is shared with the HTTP and MCP surfaces. The mock factory
 * opens an in-memory database seeded with the table fixtures, which is what
 * `testAll(app)` and trail examples run against — zero configuration.
 *
 * Write methods on the connection are bound to `ctx.fire`, so every insert,
 * update, and remove emits the matching store-derived signal
 * (`db:gear.updated`, `db:pack.created`, ...) without any hand-rolled
 * signal plumbing.
 */

import { connectDrizzle } from '@ontrails/drizzle';

import { packlistStore } from '../store.js';

const databaseUrl = Bun.env['PACKLIST_DB'] ?? 'packlist.sqlite';

export const db = connectDrizzle(packlistStore, {
  description:
    'SQLite gear/pack/trip store. Set PACKLIST_DB to relocate the database file.',
  id: 'db',
  url: databaseUrl,
});
