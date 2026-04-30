import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { Result } from '../result.js';
import {
  shouldValidateSurfaceTopo,
  validateSurfaceTopo,
  withSurfaceMarker,
} from '../surface-derivation.js';
import { topo } from '../topo.js';
import { trail } from '../trail.js';
import { SURFACE_KEY, TRAILHEAD_KEY } from '../types.js';

const exportTrail = trail('entity.export', {
  blaze: () => Result.ok({ ok: true }),
  crosses: ['_draft.entity.prepare'],
  input: z.object({}),
});

describe('surface derivation helpers', () => {
  test('surface key preserves the legacy extension slot', () => {
    expect(SURFACE_KEY).toBe('__trails_trailhead');
    expect(TRAILHEAD_KEY).toBe(SURFACE_KEY);
  });

  test('surface validation follows the shared validate option', () => {
    const app = topo('test-app', { exportTrail });

    expect(shouldValidateSurfaceTopo()).toBe(true);
    expect(shouldValidateSurfaceTopo({ validate: false })).toBe(false);

    const validated = validateSurfaceTopo(app);
    expect(validated.isErr()).toBe(true);
    expect(validated.error?.message).toMatch(/draft/i);

    expect(validateSurfaceTopo(app, { validate: false }).isOk()).toBe(true);
  });

  test('surface marker preserves existing context extensions', () => {
    const marked = withSurfaceMarker('cli', {
      extensions: { existing: true },
      requestId: 'req-1',
    });

    expect(marked.requestId).toBe('req-1');
    expect(marked.extensions).toEqual({
      [SURFACE_KEY]: 'cli',
      existing: true,
    });
  });
});
