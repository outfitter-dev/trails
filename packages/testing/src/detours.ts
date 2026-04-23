/**
 * testDetours — validate the live detour contract for every trail.
 *
 * Pure structural validation. No blaze or detour recovery execution needed.
 */

import { describe, test } from 'bun:test';

import { TrailsError } from '@ontrails/core';
import type { Topo, Trail } from '@ontrails/core';

interface RuntimeDetour {
  readonly on?: unknown;
  readonly recover?: unknown;
}

const isErrorConstructor = (
  value: unknown
): value is abstract new (...args: never[]) => Error => {
  if (typeof value !== 'function') {
    return false;
  }

  const { prototype } = value as { prototype?: unknown };
  return prototype instanceof Error;
};

const detourLabel = (trailId: string, index: number, detour: RuntimeDetour) => {
  if (typeof detour.on === 'function') {
    const { name } = detour.on as { name?: unknown };
    if (typeof name === 'string' && name.length > 0) {
      return `${trailId} detour[${index}] on ${name}`;
    }
  }

  return `${trailId} detour[${index}]`;
};

const assertValidOn = (
  trailId: string,
  index: number,
  detour: RuntimeDetour
): void => {
  if (isErrorConstructor(detour.on)) {
    return;
  }

  throw new Error(
    `${detourLabel(trailId, index, detour)} must declare a real error constructor in on:`
  );
};

const assertCallableRecover = (
  trailId: string,
  index: number,
  detour: RuntimeDetour
): void => {
  if (typeof detour.recover === 'function') {
    return;
  }

  throw new Error(
    `${detourLabel(trailId, index, detour)} must declare a callable recover function`
  );
};

const sameOrSubtype = (
  candidate: abstract new (...args: never[]) => Error,
  ancestor: abstract new (...args: never[]) => Error
): boolean => {
  if (candidate === ancestor) {
    return true;
  }

  let current = Object.getPrototypeOf(candidate.prototype);
  while (current && typeof current === 'object') {
    const ctor = (current as { constructor?: unknown }).constructor;
    if (ctor === ancestor) {
      return true;
    }
    current = Object.getPrototypeOf(current);
  }

  return false;
};

const getShadowingDetour = (
  detours: readonly RuntimeDetour[],
  index: number
):
  | {
      readonly index: number;
      readonly on: abstract new (...args: never[]) => Error;
    }
  | undefined => {
  const detour = detours[index];
  if (!detour || !isErrorConstructor(detour.on)) {
    return undefined;
  }

  for (let previousIndex = 0; previousIndex < index; previousIndex += 1) {
    const previous = detours[previousIndex];
    if (!previous || !isErrorConstructor(previous.on)) {
      continue;
    }

    if (sameOrSubtype(detour.on, previous.on)) {
      return { index: previousIndex, on: previous.on };
    }
  }

  return undefined;
};

const assertNotShadowed = (
  trailId: string,
  detours: readonly RuntimeDetour[],
  index: number
): void => {
  const detour = detours[index];
  if (!detour || !isErrorConstructor(detour.on)) {
    return;
  }

  const shadowing = getShadowingDetour(detours, index);
  if (!shadowing) {
    return;
  }

  const previousName = shadowing.on.name || TrailsError.name;
  const currentName = detour.on.name || TrailsError.name;
  throw new Error(
    `${trailId} detour[${index}] on ${currentName} is shadowed by earlier detour[${shadowing.index}] on ${previousName}`
  );
};

/**
 * Verify that every trail's detours match the live runtime contract:
 * `on` must be an error constructor, `recover` must be callable, and
 * later detours must not be shadowed by earlier broader `on` types.
 */
export const testDetours = (app: Topo): void => {
  const trailEntries = [...app.trails];

  describe('detours', () => {
    describe.each(trailEntries)('%s', (_id, trailDef) => {
      const trail = trailDef as Trail<unknown, unknown, unknown>;

      if (trail.detours.length === 0) {
        return;
      }

      const detourCases = trail.detours.map((detour, index) => ({
        detour,
        index,
        trailId: trail.id,
      }));

      test.each(detourCases)(
        '$trailId detour[$index] uses an error constructor',
        ({ detour, index, trailId }) => {
          assertValidOn(trailId, index, detour);
        }
      );

      test.each(detourCases)(
        '$trailId detour[$index] provides a callable recover',
        ({ detour, index, trailId }) => {
          assertCallableRecover(trailId, index, detour);
        }
      );

      test.each(detourCases)(
        '$trailId detour[$index] is not shadowed by an earlier detour',
        ({ index, trailId }) => {
          assertNotShadowed(trailId, trail.detours, index);
        }
      );
    });
  });
};
