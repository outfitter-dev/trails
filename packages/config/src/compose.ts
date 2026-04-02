/**
 * Config composition utilities for provisions.
 *
 * Collects config schemas from provision declarations so they can be
 * composed into a unified config structure via `defineConfig`.
 */

import type { z } from 'zod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A provision config schema entry extracted from a provision declaration. */
export interface ProvisionConfigEntry {
  readonly provisionId: string;
  readonly schema: z.ZodType;
}

/** Backward-compatible alias while the migration is in flight. */
export type ServiceConfigEntry = ProvisionConfigEntry;

/** Minimal shape needed to extract config from a provision-like object. */
interface ProvisionWithOptionalConfig {
  readonly id: string;
  readonly config?: z.ZodType | undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Collect config schemas from provisions that declare them.
 *
 * Returns entries keyed by provision ID for composition into `defineConfig`.
 * Provisions without a `config` schema are excluded.
 */
export const collectProvisionConfigs = (
  provisions: readonly ProvisionWithOptionalConfig[]
): ProvisionConfigEntry[] =>
  provisions
    .filter(
      (
        svc
      ): svc is ProvisionWithOptionalConfig & { readonly config: z.ZodType } =>
        svc.config !== undefined
    )
    .map((svc) => ({ provisionId: svc.id, schema: svc.config }));

/** Backward-compatible alias while the migration is in flight. */
export const collectServiceConfigs = collectProvisionConfigs;
