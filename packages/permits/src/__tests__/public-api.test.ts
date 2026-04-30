import { describe, expect, test } from 'bun:test';

import * as permits from '@ontrails/permits';
import {
  createPermitForTrail,
  createTestPermit,
} from '@ontrails/permits/testing';

describe('@ontrails/permits public API', () => {
  test('keeps test helpers on the testing entrypoint', () => {
    expect('createTestPermit' in permits).toBe(false);
    expect('createPermitForTrail' in permits).toBe(false);

    expect(createTestPermit({ scopes: ['entity:read'] }).scopes).toEqual([
      'entity:read',
    ]);
    expect(createPermitForTrail({ permit: 'public' })).toBeUndefined();
  });
});
