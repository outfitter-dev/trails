/**
 * Example-driven parity across shipped surfaces.
 */

import { testSurfaceParity } from '@ontrails/testing/surface-parity';

import { graph } from '../src/app.js';
import { createNotificationStore } from '../src/resources/notification-store.js';
import { createStore } from '../src/store.js';

// oxlint-disable-next-line require-hook -- testSurfaceParity registers tests at module level by design
testSurfaceParity(graph, {
  createResources: () => ({
    'demo.entity-store': createStore([
      {
        createdAt: '2026-01-01T00:00:00.000Z',
        id: 'entity-alpha',
        name: 'Alpha',
        tags: ['core'],
        type: 'concept',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        createdAt: '2026-01-02T00:00:00.000Z',
        id: 'entity-deletable',
        name: 'Deletable',
        tags: ['temp'],
        type: 'tool',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ]),
    'demo.notification-store': createNotificationStore(),
  }),
  ctx: { permit: { id: 'test-permit', scopes: ['entity:delete'] } },
  exclusions: [
    {
      example: 'Add a new entity',
      reason:
        'creates generated id/timestamp fields, so each fresh surface store returns different values',
      trailId: 'entity.add',
    },
    {
      example: 'Onboard a new entity',
      reason:
        'composes entity.add and returns generated entity identity from each fresh surface store',
      trailId: 'entity.onboard',
    },
  ],
});
