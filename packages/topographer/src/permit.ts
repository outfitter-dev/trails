import type { AnyTrail, PermitRequirement } from '@ontrails/core';

export type ProjectedPermitRequirement =
  | 'public'
  | { readonly scopes: readonly string[] };

export const projectPermitRequirement = (
  permit: PermitRequirement
): ProjectedPermitRequirement =>
  permit === 'public' ? 'public' : { scopes: [...permit.scopes].toSorted() };

export const addPermitRequirement = (
  entry: Record<string, unknown>,
  trail: AnyTrail
): void => {
  if (trail.permit !== undefined) {
    entry['permit'] = projectPermitRequirement(trail.permit);
  }
};
