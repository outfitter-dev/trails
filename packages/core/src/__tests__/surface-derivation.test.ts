import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { Result } from '../result.js';
import {
  shouldValidateSurfaceTopo,
  validateSurfaceTopo,
  withSurfaceLayerNames,
  withSurfaceMarker,
} from '../surface-derivation.js';
import { topo } from '../topo.js';
import { trail } from '../trail.js';
import { SURFACE_KEY, SURFACE_LAYER_NAMES_KEY } from '../types.js';

const exportTrail = trail('entity.export', {
  composes: ['_draft.entity.prepare'],
  implementation: () => Result.ok({ ok: true }),
  input: z.object({}),
});

describe('surface derivation helpers', () => {
  test('surface key uses the surface extension slot', () => {
    expect(SURFACE_KEY).toBe('__trails_surface');
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

  test('surface layer marker records layer names by invoking surface', () => {
    const marked = withSurfaceLayerNames(
      'mcp',
      [
        { name: 'auth', wrap: (_trail, impl) => impl },
        { name: 'audit', wrap: (_trail, impl) => impl },
      ],
      {
        extensions: {
          [SURFACE_LAYER_NAMES_KEY]: { cli: ['quiet'] },
          existing: true,
        },
      }
    );

    expect(marked.extensions).toEqual({
      [SURFACE_KEY]: 'mcp',
      [SURFACE_LAYER_NAMES_KEY]: { cli: ['quiet'], mcp: ['auth', 'audit'] },
      existing: true,
    });
  });
});
