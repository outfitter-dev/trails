/**
 * Resource-backed entity store for the trails-demo app.
 *
 * Keeps runtime defaults and test mocks close to the resource definition so
 * trails and helpers can resolve the same dependency model everywhere.
 */

import { Result, resource } from '@ontrails/core';
import { createStore } from '../store.js';

const runtimeSeed = [
  { name: 'Alpha', tags: ['core'], type: 'concept' },
  { name: 'Beta', tags: ['automation'], type: 'tool' },
  { name: 'Gamma', tags: ['workflow'], type: 'pattern' },
] as const;

const mockSeed = [
  { name: 'Alpha', tags: ['core'], type: 'concept' },
  { name: 'Deletable', tags: ['temp'], type: 'tool' },
] as const;

export const createMockEntityStore = () => createStore(mockSeed);

export const entityStoreProvision = resource('demo.entity-store', {
  create: () => Result.ok(createStore(runtimeSeed)),
  description:
    'Drizzle-backed in-memory entity store used by the demo trails app.',
  mock: () => createMockEntityStore(),
});
