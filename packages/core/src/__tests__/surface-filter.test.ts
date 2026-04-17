import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { Result } from '../result.js';
import { filterSurfaceTrails, matchesTrailPattern } from '../surface-filter.js';
import { signal } from '../signal.js';
import { trail } from '../trail.js';

const orderPlaced = signal('order.placed', {
  payload: z.object({ orderId: z.string() }),
});

const publicTrail = trail('entity.show', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
  intent: 'read',
});

const nestedTrail = trail('entity.admin.audit', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
  intent: 'destroy',
});

const internalTrail = trail('entity.secret.rotate', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
  visibility: 'internal',
});

const legacyInternalTrail = trail('entity.legacy.rotate', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
  meta: { internal: true },
});

const bareEntityTrail = trail('entity', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
});

const otherTrail = trail('other', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
});

const consumerTrail = trail('notify.email', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
  on: [orderPlaced],
});

describe('matchesTrailPattern', () => {
  test('exact trail IDs match directly', () => {
    expect(matchesTrailPattern('entity.show', 'entity.show')).toBe(true);
  });

  test('* matches a single dotted segment', () => {
    expect(matchesTrailPattern('entity.show', 'entity.*')).toBe(true);
    expect(matchesTrailPattern('entity.admin.show', 'entity.*')).toBe(false);
  });

  test('** matches any remaining dotted depth', () => {
    expect(matchesTrailPattern('entity.admin.show', 'entity.**')).toBe(true);
    expect(matchesTrailPattern('entity.show', 'entity.**')).toBe(true);
  });

  test('** terminal segment matches entity and all descendants', () => {
    // Zero-remaining-segments case: bare parent matches entity.**.
    expect(matchesTrailPattern('entity', 'entity.**')).toBe(true);
    // One-remaining-segment case for completeness.
    expect(matchesTrailPattern('entity.read', 'entity.**')).toBe(true);
    // Sibling namespace must not match entity.**.
    expect(matchesTrailPattern('other', 'entity.**')).toBe(false);
  });
});

describe('filterSurfaceTrails', () => {
  describe('visibility defaults', () => {
    test('includes public trails by default', () => {
      expect(filterSurfaceTrails([publicTrail])).toEqual([publicTrail]);
    });

    test('excludes internal trails by default', () => {
      expect(filterSurfaceTrails([internalTrail])).toEqual([]);
    });

    test('does not expose internal trails for wildcard includes', () => {
      expect(
        filterSurfaceTrails([internalTrail], { include: ['entity.**'] })
      ).toEqual([]);
    });

    test('allows exact include to expose an internal trail', () => {
      expect(
        filterSurfaceTrails([internalTrail], {
          include: ['entity.secret.rotate'],
        })
      ).toEqual([internalTrail]);
    });

    test('legacy meta.internal is treated as internal visibility', () => {
      // Default filter: legacy internal trails must not leak out.
      expect(filterSurfaceTrails([legacyInternalTrail])).toEqual([]);

      // Wildcard include must also refuse to expose the legacy internal trail.
      expect(
        filterSurfaceTrails([legacyInternalTrail], { include: ['entity.**'] })
      ).toEqual([]);

      // Explicit exact-id include is the documented escape hatch.
      expect(
        filterSurfaceTrails([legacyInternalTrail], {
          include: ['entity.legacy.rotate'],
        })
      ).toEqual([legacyInternalTrail]);
    });
  });

  describe('include and exclude patterns', () => {
    test('exclude patterns remove matches before include narrowing', () => {
      expect(
        filterSurfaceTrails([publicTrail], {
          exclude: ['entity.*'],
          include: ['entity.show'],
        })
      ).toEqual([]);
    });

    test('include patterns narrow the visible trail set', () => {
      expect(
        filterSurfaceTrails([publicTrail, nestedTrail], {
          include: ['entity.**'],
        })
      ).toEqual([publicTrail, nestedTrail]);
      expect(
        filterSurfaceTrails([publicTrail, nestedTrail], {
          include: ['entity.*'],
        })
      ).toEqual([publicTrail]);
    });

    test('entity.** include matches bare entity and descendants', () => {
      // Regression guard for the ** terminal-segment zero-depth case.
      expect(
        filterSurfaceTrails([bareEntityTrail, publicTrail, otherTrail], {
          include: ['entity.**'],
        })
      ).toEqual([bareEntityTrail, publicTrail]);
    });
  });

  describe('intent filtering', () => {
    test('intent filtering narrows visible trails by behavior class', () => {
      expect(
        filterSurfaceTrails([publicTrail, nestedTrail], {
          intent: ['read'],
        })
      ).toEqual([publicTrail]);

      expect(
        filterSurfaceTrails([publicTrail, nestedTrail], {
          intent: ['destroy'],
        })
      ).toEqual([nestedTrail]);
    });

    test('intent filtering composes with glob include patterns using AND logic', () => {
      expect(
        filterSurfaceTrails([publicTrail, nestedTrail], {
          include: ['entity.**'],
          intent: ['read'],
        })
      ).toEqual([publicTrail]);
    });

    test('empty intent filters behave like no filter', () => {
      expect(
        filterSurfaceTrails([publicTrail, nestedTrail], {
          intent: [],
        })
      ).toEqual([publicTrail, nestedTrail]);
    });
  });

  describe('consumer trails', () => {
    test('consumer trails are never exposed on trailheads', () => {
      expect(
        filterSurfaceTrails([consumerTrail], {
          include: ['notify.email'],
        })
      ).toEqual([]);
    });
  });
});
