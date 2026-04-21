import { describe, expect, test } from 'bun:test';
import { testAll } from '@ontrails/testing';

import { wardenTopo } from '../trails/topo.js';

// oxlint-disable-next-line jest/require-hook -- testAll generates describe/test blocks, not setup code
testAll(wardenTopo);

describe('wardenTopo', () => {
  test('contains all 32 rule trails', () => {
    expect(wardenTopo.count).toBe(32);
  });

  test('all trail IDs follow warden.rule.* naming', () => {
    for (const id of wardenTopo.ids()) {
      expect(id).toMatch(/^warden\.rule\./);
    }
  });
});
