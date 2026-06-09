import { describe, expect, test } from 'bun:test';

import {
  nativeBunReleaseBinding,
  releaseBindingCapabilityValues,
  releaseBindingKindValues,
  releaseBindingPlacementValues,
} from '../release/index.js';

describe('release bindings', () => {
  test('declares the native Bun release binding as the built-in default', () => {
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
    expect(nativeBunReleaseBinding).toEqual({
      boundary: 'trails-owned',
      capabilities: ['pack-check', 'publish', 'registry-preflight'],
      description:
        'Built-in Bun release binding for Trails-owned package pack checks, npm registry preflight, and lockstep package publication.',
      id: 'release.binding.native-bun',
      kind: 'native',
      placement: 'same-package',
      runtime: 'bun',
    });
  });
});
