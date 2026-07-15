import { describe, expect, test } from 'bun:test';

import {
  nativeBunPackBinding,
  nativeBunReleaseBinding,
  npmReleaseAdapterBinding,
  releaseBindingCapabilityValues,
  releaseBindingKindValues,
  releaseBindingPlacementValues,
} from '../release/index.js';

describe('release bindings', () => {
  test('declares the canonical Bun pack and npm publication bindings', () => {
    expect(releaseBindingKindValues).toEqual(['native', 'adapter']);
    expect(releaseBindingPlacementValues).toEqual([
      'same-package',
      'subpath',
      'extracted',
    ]);
    expect(releaseBindingCapabilityValues).toEqual([
      'pack-check',
      'publish',
      'registry-preflight',
    ]);
    expect(nativeBunPackBinding).toEqual({
      boundary: 'trails-owned',
      capabilities: ['pack-check'],
      description:
        'Native Bun release binding for Trails-owned package packing and validation.',
      id: 'release.binding.native-bun',
      kind: 'native',
      placement: 'same-package',
      runtime: 'bun',
    });
    expect(npmReleaseAdapterBinding).toEqual({
      boundary: 'foreign',
      capabilities: ['publish', 'registry-preflight'],
      description:
        'Same-package npm adapter binding for trusted publication, registry preflight, and lockstep recovery.',
      id: 'release.binding.npm',
      kind: 'adapter',
      placement: 'same-package',
      runtime: 'npm',
    });
  });

  test('keeps the retired release binding name as a truthful pack alias', () => {
    expect(nativeBunReleaseBinding).toEqual(nativeBunPackBinding);
    expect(nativeBunReleaseBinding).not.toBe(nativeBunPackBinding);
  });
});
