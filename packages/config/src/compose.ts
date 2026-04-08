/**
 * Config composition utilities for resources.
 *
 * Collects config schemas from resource declarations so they can be
 * composed into a unified config structure via `defineConfig`.
 */

import type { z } from 'zod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A resource config schema entry extracted from a resource declaration. */
export interface ProvisionConfigEntry {
  readonly provisionId: string;
  readonly schema: z.ZodType;
}

/** Backward-compatible alias while the migration is in flight. */
export type ServiceConfigEntry = ProvisionConfigEntry;

/** Minimal shape needed to extract config from a resource-like object. */
interface ProvisionWithOptionalConfig {
  readonly id: string;
  readonly config?: z.ZodType | undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Collect config schemas from resources that declare them.
 *
 * Returns entries keyed by resource ID for composition into `defineConfig`.
 * Resources without a `config` schema are excluded.
 */
export const collectProvisionConfigs = (
  resources: readonly ProvisionWithOptionalConfig[]
): ProvisionConfigEntry[] =>
  resources
    .filter(
      (
        svc
      ): svc is ProvisionWithOptionalConfig & { readonly config: z.ZodType } =>
        svc.config !== undefined
    )
    .map((svc) => ({ provisionId: svc.id, schema: svc.config }));

/** Backward-compatible alias while the migration is in flight. */
export const collectServiceConfigs = collectProvisionConfigs;
