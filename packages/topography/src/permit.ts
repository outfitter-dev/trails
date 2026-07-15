import type { AnyTrail, PermitRequirement } from '@ontrails/core';

export type DerivedPermitRequirement =
  | 'public'
  | { readonly scopes: readonly string[] };

export const derivePermitRequirement = (
  permit: PermitRequirement
): DerivedPermitRequirement =>
  permit === 'public' ? 'public' : { scopes: [...permit.scopes].toSorted() };

export const addPermitRequirement = (
  entry: Record<string, unknown>,
  trail: AnyTrail
): void => {
  if (trail.permit !== undefined) {
    entry['permit'] = derivePermitRequirement(trail.permit);
  }
};
