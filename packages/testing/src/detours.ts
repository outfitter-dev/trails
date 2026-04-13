/**
 * testDetours — verify that all declared detours have valid error class targets.
 *
 * Pure structural validation. No implementation execution needed.
 */

import { describe, expect, test } from 'bun:test';

import type { Topo, Trail } from '@ontrails/core';

// ---------------------------------------------------------------------------
// testDetours
// ---------------------------------------------------------------------------

/**
 * Verify that every trail's detour declarations reference valid error classes
 * (i.e. `on` is a constructor function with a name).
 */
export const testDetours = (app: Topo): void => {
  const trailEntries = [...app.trails];

  describe('detours', () => {
    describe.each(trailEntries)('%s', (_id, trailDef) => {
      const t = trailDef as Trail<unknown, unknown, unknown>;

      if (t.detours.length === 0) {
        return;
      }

      const testCases = t.detours.map((d, i) => ({
        errorClass: d.on.name,
        index: i,
      }));

      test.each(testCases)(
        'detour[$index] on $errorClass has a valid error class',
        ({ errorClass }) => {
          expect(errorClass).toBeTruthy();
        }
      );
    });
  });
};
