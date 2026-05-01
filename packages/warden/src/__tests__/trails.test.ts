import { describe, expect, test } from 'bun:test';
import { testAll } from '@ontrails/testing';

import { wardenTopo } from '../trails/topo.js';

// oxlint-disable-next-line jest/require-hook -- testAll generates describe/test blocks, not setup code
testAll(wardenTopo);

describe('wardenTopo', () => {
  test('contains all 35 rule trails', () => {
    expect(wardenTopo.count).toBe(35);
  });

  test('all trail IDs follow warden.rule.* naming', () => {
    for (const id of wardenTopo.ids()) {
      expect(id).toMatch(/^warden\.rule\./);
    }
  });

  test('all rule trails expose Warden metadata', () => {
    for (const trail of wardenTopo.list()) {
      const metadata = trail.meta?.warden as
        | { lifecycle?: { state?: unknown }; tier?: unknown }
        | undefined;

      expect(typeof metadata?.lifecycle?.state).toBe('string');
      expect(typeof metadata?.tier).toBe('string');
    }
  });
});
