import type { PermitRequirement } from '@ontrails/core';

import type { Permit } from './permit.js';

/**
 * Create a synthetic test permit with exactly the declared scopes.
 * No admin permit, no wildcard — tests get only what the trail declares.
 */
export const createTestPermit = (options?: {
  readonly id?: string;
  readonly scopes?: readonly string[];
  readonly roles?: readonly string[];
  readonly tenantId?: string;
}): Permit => ({
  id:
    options?.id ??
    `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  scopes: [...(options?.scopes ?? [])],
  ...(options?.roles === undefined ? {} : { roles: [...options.roles] }),
  ...(options?.tenantId === undefined ? {} : { tenantId: options.tenantId }),
});

/**
 * Create a test permit matching a trail's permit requirement.
 * Extracts scopes from the requirement and creates a permit with exactly those scopes.
 */
export const createPermitForTrail = (trail: {
  readonly permit?: PermitRequirement | undefined;
}): Permit | undefined => {
  if (!trail.permit || trail.permit === 'public') {
    return undefined;
  }
  return createTestPermit({ scopes: trail.permit.scopes });
};
