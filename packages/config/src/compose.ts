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
export interface ResourceConfigEntry {
  readonly resourceId: string;
  readonly schema: z.ZodType;
}

/** Minimal shape needed to extract config from a resource-like object. */
interface ResourceWithOptionalConfig {
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
export const collectResourceConfigs = (
  resources: readonly ResourceWithOptionalConfig[]
): ResourceConfigEntry[] =>
  resources
    .filter(
      (
        svc
      ): svc is ResourceWithOptionalConfig & { readonly config: z.ZodType } =>
        svc.config !== undefined
    )
    .map((svc) => ({ resourceId: svc.id, schema: svc.config }));
