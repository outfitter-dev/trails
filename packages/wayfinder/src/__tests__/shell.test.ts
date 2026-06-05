import { describe, expect, test } from 'bun:test';

import { wayfindOverviewTrail, wayfinderTopo } from '../index.ts';

describe('@ontrails/wayfinder public catalog', () => {
  test('exports graph-read trails', () => {
    expect(wayfindOverviewTrail.id).toBe('wayfind.overview');
    expect([...wayfinderTopo.ids()]).toContain('wayfind.overview');
  });

  test('keeps graph-read trails internal by default', () => {
    for (const id of wayfinderTopo.ids()) {
      expect(wayfinderTopo.get(id)?.visibility).toBe('internal');
    }
  });
});
