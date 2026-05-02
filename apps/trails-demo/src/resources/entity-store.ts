/**
 * Resource-backed entity store for the trails-demo app.
 *
 * Re-exports the `connectDrizzle`-bound store as the canonical resource so
 * `entityStoreResource.from(ctx)` returns a connection whose write methods
 * are bound to `ctx.fire`. This keeps the resource's advertised
 * `demo.entity-store:*` signals consistent with what is actually emitted at
 * runtime: any inserts/updates/removes performed through the resource fire
 * the matching scoped signals via the trail context.
 *
 * Both `mockSeed` and `seed` ship demo fixtures so CLI/HTTP/MCP surfaces find
 * preloaded entities on a fresh `:memory:` boot — `mockSeed` for
 * `resource.mock()` (used by trail examples and `testAll`) and `seed` for the
 * writable runtime path used by `surface(graph)` in `bin/demo.ts` and
 * `src/http.ts`. The fixture sets differ intentionally: the mock path mirrors
 * a minimal `Alpha + Deletable` shape that `entity remove` examples can clean
 * up, while the runtime path ships `Alpha`, `Beta`, and `Gamma` so the demo's
 * documented commands work out of the box.
 */

import { connectDrizzle } from '@ontrails/drizzle';
import { entityStoreDefinition } from '../store.js';
import type { EntitySeed } from '../store.js';

const mockSeed: readonly EntitySeed[] = [
  { name: 'Alpha', tags: ['core'], type: 'concept' },
  { name: 'Deletable', tags: ['temp'], type: 'tool' },
];

const runtimeSeed: readonly EntitySeed[] = [
  { name: 'Alpha', tags: ['core'], type: 'concept' },
  { name: 'Beta', tags: ['automation'], type: 'tool' },
  { name: 'Gamma', tags: ['workflow'], type: 'pattern' },
];

const normalizeSeed = (seed: EntitySeed) => ({
  ...seed,
  tags: [...seed.tags],
});

export const entityStoreResource = connectDrizzle(entityStoreDefinition, {
  description:
    'Drizzle-backed in-memory entity store used by the demo trails app.',
  id: 'demo.entity-store',
  mockSeed: { entities: mockSeed.map(normalizeSeed) },
  seed: { entities: runtimeSeed.map(normalizeSeed) },
  url: ':memory:',
});

/**
 * Construct an in-memory mock connection seeded with the demo's mock fixtures.
 *
 * Returned synchronously to keep example code paths terse. Tests that need a
 * differently-seeded mock should import `createStore` from `../store.js`.
 */
export const createMockEntityStore = () => {
  const { mock } = entityStoreResource;
  if (mock === undefined) {
    throw new Error('Demo entity store requires a mock factory');
  }
  const created = mock();
  if (created instanceof Promise) {
    throw new TypeError('Demo entity store mock must resolve synchronously');
  }
  return created;
};
