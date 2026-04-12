import { describe, test } from 'bun:test';

import { ConflictError, Result, trail, topo } from '@ontrails/core';
import { z } from 'zod';

import { testDetours } from '../detours.js';

// ---------------------------------------------------------------------------
// Test trails
// ---------------------------------------------------------------------------

const showTrail = trail('entity.show', {
  blaze: (input: { id: string }) => Result.ok({ id: input.id }),
  detours: [
    {
      on: ConflictError,
      /* oxlint-disable-next-line require-await -- test stub */
      recover: async () => Result.ok({ id: 'recovered' }),
    },
  ],
  input: z.object({ id: z.string() }),
});

const noDetoursTrail = trail('entity.plain', {
  blaze: () => Result.ok('ok'),
  input: z.object({}),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('testDetours: all detour declarations are valid', () => {
  // eslint-disable-next-line jest/require-hook
  testDetours(
    topo('test-app', {
      showTrail,
    } as Record<string, unknown>)
  );
});

describe('testDetours: skips trails without detours', () => {
  // eslint-disable-next-line jest/require-hook
  testDetours(
    topo('test-app', {
      noDetoursTrail,
    } as Record<string, unknown>)
  );

  test('no-op marker', () => {
    // Trail without detours is skipped -- no detour tests generated
  });
});
