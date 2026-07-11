import { describe, expect, test } from 'bun:test';

import { wayfindOverviewTrail, wayfinderTopo } from '../index.ts';

describe('@ontrails/topography Wayfind public catalog', () => {
  test('exports graph-read trails', () => {
    expect(wayfindOverviewTrail.id).toBe('wayfind.overview');
    expect([...wayfinderTopo.ids()]).toContain('wayfind.overview');
  });

  test('keeps graph-read trails internal unless surfaced as operator commands', () => {
    for (const id of wayfinderTopo.ids()) {
      expect(wayfinderTopo.get(id)?.visibility).toBe('internal');
    }
  });
});
