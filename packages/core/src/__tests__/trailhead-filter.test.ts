import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { Result } from '../result.js';
import {
  filterTrailheadTrails,
  matchesTrailPattern,
} from '../trailhead-filter.js';
import { signal } from '../signal.js';
import { trail } from '../trail.js';

const orderPlaced = signal('order.placed', {
  payload: z.object({ orderId: z.string() }),
});

const publicTrail = trail('entity.show', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
});

const nestedTrail = trail('entity.admin.audit', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
});

const internalTrail = trail('entity.secret.rotate', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
  visibility: 'internal',
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
});

describe('filterTrailheadTrails', () => {
  test('includes public trails by default', () => {
    expect(filterTrailheadTrails([publicTrail])).toEqual([publicTrail]);
  });

  test('excludes internal trails by default', () => {
    expect(filterTrailheadTrails([internalTrail])).toEqual([]);
  });

  test('does not expose internal trails for wildcard includes', () => {
    expect(
      filterTrailheadTrails([internalTrail], { include: ['entity.**'] })
    ).toEqual([]);
  });

  test('allows exact include to expose an internal trail', () => {
    expect(
      filterTrailheadTrails([internalTrail], {
        include: ['entity.secret.rotate'],
      })
    ).toEqual([internalTrail]);
  });

  test('exclude patterns remove matches before include narrowing', () => {
    expect(
      filterTrailheadTrails([publicTrail], {
        exclude: ['entity.*'],
        include: ['entity.show'],
      })
    ).toEqual([]);
  });

  test('include patterns narrow the visible trail set', () => {
    expect(
      filterTrailheadTrails([publicTrail, nestedTrail], {
        include: ['entity.**'],
      })
    ).toEqual([publicTrail, nestedTrail]);
    expect(
      filterTrailheadTrails([publicTrail, nestedTrail], {
        include: ['entity.*'],
      })
    ).toEqual([publicTrail]);
  });

  test('consumer trails are never exposed on trailheads', () => {
    expect(
      filterTrailheadTrails([consumerTrail], {
        include: ['notify.email'],
      })
    ).toEqual([]);
  });
});
