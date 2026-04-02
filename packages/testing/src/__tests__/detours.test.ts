import { describe, test } from 'bun:test';

import { Result, trail, topo } from '@ontrails/core';
import { z } from 'zod';

import { testDetours } from '../detours.js';

// ---------------------------------------------------------------------------
// Test trails
// ---------------------------------------------------------------------------

const showTrail = trail('entity.show', {
  blaze: (input: { id: string }) => Result.ok({ id: input.id }),
  detours: {
    related: ['entity.list'],
  },
  input: z.object({ id: z.string() }),
});

const listTrail = trail('entity.list', {
  blaze: () => Result.ok([]),
  input: z.object({}),
});

const noDetoursTrail = trail('entity.plain', {
  blaze: () => Result.ok('ok'),
  input: z.object({}),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('testDetours: all targets exist', () => {
  // eslint-disable-next-line jest/require-hook
  testDetours(
    topo('test-app', {
      listTrail,
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
