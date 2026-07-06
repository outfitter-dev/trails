import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { ValidationError } from '../errors.js';
import {
  SURFACES_OVERLAY_NAMESPACE,
  classifySurfaceBinding,
  resolveSurfaceOverlayBindings,
  surfaceBindingsFromLockOverlays,
  surfaceOverlay,
  surfaceOverlayBindingsSchema,
} from '../surface-overlay.js';
import type { OverlayEnvelopeLike } from '../surface-overlay.js';

const designDocBindings = {
  cli: { gear: ['gear.create', 'gear.list'], ls: 'gear.list' },
  mcp: { snippets: ['snippet.create', 'snippet.get', 'snippet.fork'] },
} as const;

const captureValidationError = (attempt: () => unknown): ValidationError => {
  try {
    attempt();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error as ValidationError;
  }
  throw new Error('Expected a ValidationError');
};

describe('surfaceOverlayBindingsSchema', () => {
  test('accepts the design-doc example bindings', () => {
    const parsed = surfaceOverlayBindingsSchema.safeParse(designDocBindings);
    expect(parsed.success).toBe(true);
  });

  test('rejects unknown surface keys', () => {
    const parsed = surfaceOverlayBindingsSchema.safeParse({
      graphql: { ls: 'gear.list' },
    });
    expect(parsed.success).toBe(false);
  });

  test('rejects empty binding names', () => {
    const parsed = surfaceOverlayBindingsSchema.safeParse({
      cli: { '': 'gear.list' },
    });
    expect(parsed.success).toBe(false);
  });

  test('rejects empty arrays — a group with zero members is dishonest', () => {
    const parsed = surfaceOverlayBindingsSchema.safeParse({
      cli: { gear: [] },
    });
    expect(parsed.success).toBe(false);
  });

  test('rejects empty selector strings', () => {
    expect(
      surfaceOverlayBindingsSchema.safeParse({ cli: { ls: '' } }).success
    ).toBe(false);
    expect(
      surfaceOverlayBindingsSchema.safeParse({
        cli: { gear: ['gear.list', ''] },
      }).success
    ).toBe(false);
  });
});

describe('classifySurfaceBinding', () => {
  test('a scalar ref classifies as a synonym', () => {
    expect(classifySurfaceBinding('gear.list')).toEqual({
      kind: 'synonym',
      trail: 'gear.list',
    });
  });

  test('a singleton list stays a group — value shape is the discriminator, not cardinality', () => {
    expect(classifySurfaceBinding(['gear.list'])).toEqual({
      kind: 'group',
      members: ['gear.list'],
    });
  });

  test('a multi-member list classifies as a group', () => {
    expect(classifySurfaceBinding(['gear.create', 'gear.list'])).toEqual({
      kind: 'group',
      members: ['gear.create', 'gear.list'],
    });
  });
});

describe('surfaceOverlay', () => {
  test('returns an app-authored envelope in the surfaces namespace', () => {
    const overlay = surfaceOverlay(designDocBindings);

    expect(overlay.namespace).toBe(SURFACES_OVERLAY_NAMESPACE);
    expect(overlay.namespace).toBe('surfaces');
    expect(overlay.provenance).toBe('app-authored');
    expect(overlay.bindings).toEqual(designDocBindings);
    expect(overlay.derive()).toEqual(designDocBindings);
  });

  test('throws a ValidationError with fix-forward guidance on invalid bindings', () => {
    const error = captureValidationError(() =>
      surfaceOverlay({ cli: { gear: [] } })
    );
    expect(error.message).toContain('surfaces');
    expect(error.message).toContain('surfaceOverlay()');
  });
});

describe('resolveSurfaceOverlayBindings', () => {
  test('returns the bindings for an app-authored surfaces overlay', () => {
    const bindings = resolveSurfaceOverlayBindings([
      surfaceOverlay(designDocBindings),
    ]);
    expect(bindings).toEqual(designDocBindings);
  });

  test('returns undefined when no surfaces overlay is present', () => {
    // oxlint-disable-next-line no-useless-undefined -- exercising the explicit-undefined overlays path
    expect(resolveSurfaceOverlayBindings(undefined)).toBeUndefined();
    expect(resolveSurfaceOverlayBindings([])).toBeUndefined();
    const adapterOverlay: OverlayEnvelopeLike = {
      derive: () => ({ regions: ['us-east'] }),
      namespace: 'cloudflare',
      schema: z.object({ regions: z.array(z.string()) }),
    };
    expect(resolveSurfaceOverlayBindings([adapterOverlay])).toBeUndefined();
  });

  test('throws for an adapter-shaped surfaces overlay with no provenance — adapters cannot inject a binding a surface obeys', () => {
    const adapterShaped: OverlayEnvelopeLike = {
      derive: () => ({ cli: { ls: 'gear.list' } }),
      namespace: 'surfaces',
      schema: surfaceOverlayBindingsSchema,
    };

    const error = captureValidationError(() =>
      resolveSurfaceOverlayBindings([adapterShaped])
    );
    expect(error.message).toContain('app-authored');
    expect(error.message).toContain(
      'adapters contribute facts, never bindings'
    );
    expect(error.message).toContain('surfaceOverlay()');
  });

  test('throws for an explicit adapter-derived surfaces overlay', () => {
    const adapterDerived: OverlayEnvelopeLike = {
      derive: () => ({ cli: { ls: 'gear.list' } }),
      namespace: 'surfaces',
      provenance: 'adapter-derived',
      schema: surfaceOverlayBindingsSchema,
    };

    const error = captureValidationError(() =>
      resolveSurfaceOverlayBindings([adapterDerived])
    );
    expect(error.message).toContain('surfaceOverlay()');
  });

  test('throws on duplicate surfaces overlays', () => {
    const error = captureValidationError(() =>
      resolveSurfaceOverlayBindings([
        surfaceOverlay({ cli: { ls: 'gear.list' } }),
        surfaceOverlay({ mcp: { snippets: ['snippet.*'] } }),
      ])
    );
    expect(error.message).toContain('Duplicate');
    expect(error.message).toContain('surfaces');
  });

  test('throws when an app-authored derive result fails the bindings schema', () => {
    const drifted: OverlayEnvelopeLike = {
      derive: () => ({ graphql: { ls: 'gear.list' } }),
      namespace: 'surfaces',
      provenance: 'app-authored',
      schema: surfaceOverlayBindingsSchema,
    };

    const error = captureValidationError(() =>
      resolveSurfaceOverlayBindings([drifted])
    );
    expect(error.message).toContain('invalid');
  });
});

describe('surfaceBindingsFromLockOverlays', () => {
  test('round-trips bindings embedded under the surfaces key', () => {
    const overlay = surfaceOverlay(designDocBindings);
    const lockOverlays = { surfaces: overlay.derive() };

    expect(surfaceBindingsFromLockOverlays(lockOverlays)).toEqual(
      designDocBindings
    );
  });

  test('returns undefined when the record has no surfaces key', () => {
    // oxlint-disable-next-line no-useless-undefined -- exercising the explicit-undefined overlays path
    expect(surfaceBindingsFromLockOverlays(undefined)).toBeUndefined();
    expect(
      surfaceBindingsFromLockOverlays({ cloudflare: { regions: [] } })
    ).toBeUndefined();
  });

  test('throws a ValidationError for an invalid embedded shape', () => {
    const error = captureValidationError(() =>
      surfaceBindingsFromLockOverlays({ surfaces: { cli: { gear: [] } } })
    );
    expect(error.message).toContain('surfaces');
    expect(error.message).toContain('trails compile');
  });
});
