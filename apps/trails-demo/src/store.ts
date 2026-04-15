/**
 * Schema-derived entity store for the trails-demo app.
 *
 * The demo still uses an in-memory SQLite database for easy local runs, but
 * the storage contract itself is now authored once and projected through
 * `@ontrails/drizzle`.
 */

import { store as defineStore } from '@ontrails/store';
import { connectDrizzle } from '@ontrails/drizzle';
import { z } from 'zod';

export const entitySchema = z.object({
  createdAt: z.string(),
  id: z.string(),
  name: z.string(),
  tags: z.array(z.string()),
  type: z.string(),
  updatedAt: z.string(),
});

const mockFixtures = [
  { name: 'Alpha', tags: ['core'], type: 'concept' },
  { name: 'Deletable', tags: ['temp'], type: 'tool' },
] as const;

const entityTables = {
  entities: {
    fixtures: mockFixtures,
    generated: ['id', 'createdAt', 'updatedAt'],
    indexes: ['type'],
    primaryKey: 'name',
    schema: entitySchema,
  },
} as const;

export const entityStoreDefinition = defineStore(entityTables);

export type Entity = z.output<typeof entitySchema>;
export interface EntitySeed {
  readonly createdAt?: string;
  readonly id?: string;
  readonly name: string;
  readonly tags: readonly string[];
  readonly type: string;
  readonly updatedAt?: string;
}

interface MutableEntitySeed {
  readonly createdAt?: string;
  readonly id?: string;
  readonly name: string;
  readonly tags: string[];
  readonly type: string;
  readonly updatedAt?: string;
}

const normalizeSeed = (seed: EntitySeed): MutableEntitySeed => ({
  ...seed,
  tags: [...seed.tags],
});

const createBoundEntityStore = (seed?: readonly EntitySeed[]) =>
  connectDrizzle(entityStoreDefinition, {
    id: 'demo.entity-store',
    ...(seed === undefined
      ? {}
      : { mockSeed: { entities: seed.map(normalizeSeed) } }),
    url: ':memory:',
  });

export type EntityStore = Awaited<
  ReturnType<NonNullable<ReturnType<typeof createBoundEntityStore>['mock']>>
>;

export const createStore = (seed?: readonly EntitySeed[]): EntityStore => {
  const { mock } = createBoundEntityStore(seed);
  if (mock === undefined) {
    throw new Error('Demo entity store requires a mock factory');
  }

  const created = mock();
  if (created instanceof Promise) {
    throw new TypeError('Demo entity store mock must resolve synchronously');
  }

  return created;
};
