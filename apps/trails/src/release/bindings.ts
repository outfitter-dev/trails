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

export const nativeBunReleaseBinding = {
  boundary: 'trails-owned',
  capabilities: ['pack-check', 'publish', 'registry-preflight'],
  description:
    'Built-in Bun release binding for Trails-owned package pack checks, npm registry preflight, and lockstep package publication.',
  id: 'release.binding.native-bun',
  kind: 'native',
  placement: 'same-package',
  runtime: 'bun',
} satisfies ReleaseBindingDescriptor;
