export const releaseBindingKindValues = ['native', 'adapter'] as const;
export type ReleaseBindingKind = (typeof releaseBindingKindValues)[number];

export const releaseBindingPlacementValues = [
  'same-package',
  'subpath',
  'extracted',
] as const;
export type ReleaseBindingPlacement =
  (typeof releaseBindingPlacementValues)[number];

export const releaseBindingCapabilityValues = [
  'pack-check',
  'publish',
  'registry-preflight',
] as const;
export type ReleaseBindingCapability =
  (typeof releaseBindingCapabilityValues)[number];

export interface ReleaseBindingDescriptor {
  readonly boundary: 'foreign' | 'trails-owned';
  readonly capabilities: readonly ReleaseBindingCapability[];
  readonly description: string;
  readonly id: string;
  readonly kind: ReleaseBindingKind;
  readonly placement: ReleaseBindingPlacement;
  readonly runtime: string;
}

export const nativeBunPackBinding = {
  boundary: 'trails-owned',
  capabilities: ['pack-check'],
  description:
    'Native Bun release binding for Trails-owned package packing and validation.',
  id: 'release.binding.native-bun',
  kind: 'native',
  placement: 'same-package',
  runtime: 'bun',
} satisfies ReleaseBindingDescriptor;

/**
 * @deprecated Use `nativeBunPackBinding`. This alias preserves the exported
 * name while correcting its descriptor to the Bun-owned pack boundary.
 */
export const nativeBunReleaseBinding = Object.freeze({
  ...nativeBunPackBinding,
});

export const npmReleaseAdapterBinding = {
  boundary: 'foreign',
  capabilities: ['publish', 'registry-preflight'],
  description:
    'Same-package npm adapter binding for trusted publication, registry preflight, and lockstep recovery.',
  id: 'release.binding.npm',
  kind: 'adapter',
  placement: 'same-package',
  runtime: 'npm',
} satisfies ReleaseBindingDescriptor;
