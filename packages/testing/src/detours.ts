/**
 * testDetours — verify that all detour targets exist in the topo.
 *
 * Pure structural validation. No implementation execution needed.
 */

import { describe, expect, test } from 'bun:test';

import type { Topo, Trail } from '@ontrails/core';

// ---------------------------------------------------------------------------
// testDetours
// ---------------------------------------------------------------------------

/**
 * Verify that every trail's detour targets reference trails that
 * actually exist in the app's topo.
 */
export const testDetours = (app: Topo): void => {
  const trailEntries = [...app.trails];

  describe('detours', () => {
    describe.each(trailEntries)('%s', (_id, trailDef) => {
      const t = trailDef as Trail<unknown, unknown, unknown>;

      if (t.detours === undefined) {
        return;
      }

      const { detours } = t;
      const testCases = Object.entries(detours).flatMap(
        ([detourName, targets]) =>
          targets.map((targetId) => ({ detourName, targetId }))
      );

      test.each(testCases)(
        'detour "$detourName" -> "$targetId" exists',
        ({ targetId }) => {
          expect(app.has(targetId)).toBe(true);
        }
      );
    });
  });
};
