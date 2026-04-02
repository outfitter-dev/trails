/**
 * Custom scenario tests for entity trails.
 *
 * Edge cases and boundary conditions that don't belong in agent-facing examples.
 */

import { NotFoundError, AlreadyExistsError } from '@ontrails/core';
import { testTrail } from '@ontrails/testing';

import { entityStoreProvision } from '../src/provisions/entity-store.js';
import { createStore } from '../src/store.js';
import { show, add, remove, list } from '../src/trails/entity.js';

// ---------------------------------------------------------------------------
// Shared seed
// ---------------------------------------------------------------------------

const store = createStore([
  { name: 'Alpha', tags: ['core'], type: 'concept' },
  { name: 'Beta', tags: ['automation'], type: 'tool' },
]);

const ctx = {
  extensions: {
    [entityStoreProvision.id]: store,
  },
};

// ---------------------------------------------------------------------------
// entity.show
// ---------------------------------------------------------------------------

// oxlint-disable-next-line require-hook -- testTrail registers tests at module level by design
testTrail(
  show,
  [
    {
      description: 'Case sensitivity -- exact name required',
      expectErr: NotFoundError,
      input: { name: 'alpha' },
    },
  ],
  ctx
);

// ---------------------------------------------------------------------------
// entity.add
// ---------------------------------------------------------------------------

// oxlint-disable-next-line require-hook -- testTrail registers tests at module level by design
testTrail(
  add,
  [
    {
      description: 'Add with empty tags defaults',
      expectOk: true,
      input: { name: 'Delta', type: 'tool' },
    },
    {
      description: 'Duplicate name returns AlreadyExistsError',
      expectErr: AlreadyExistsError,
      input: { name: 'Alpha', type: 'concept' },
    },
  ],
  ctx
);

// ---------------------------------------------------------------------------
// entity.delete
// ---------------------------------------------------------------------------

// oxlint-disable-next-line require-hook -- testTrail registers tests at module level by design
testTrail(
  remove,
  [
    {
      description: 'Delete non-existent entity returns NotFoundError',
      expectErr: NotFoundError,
      input: { name: 'does-not-exist' },
    },
  ],
  ctx
);

// ---------------------------------------------------------------------------
// entity.list
// ---------------------------------------------------------------------------

// oxlint-disable-next-line require-hook -- testTrail registers tests at module level by design
testTrail(
  list,
  [
    {
      description: 'List with type filter',
      expectOk: true,
      input: { type: 'concept' },
    },
    {
      description: 'List with no matching type',
      expectOk: true,
      input: { type: 'nonexistent-type' },
    },
  ],
  ctx
);
