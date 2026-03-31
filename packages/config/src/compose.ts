/**
 * Config composition utilities for services.
 *
 * Collects config schemas from service declarations so they can be
 * composed into a unified config structure via `defineConfig`.
 */

import type { z } from 'zod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A service config schema entry extracted from a service declaration. */
export interface ServiceConfigEntry {
  readonly serviceId: string;
  readonly schema: z.ZodType;
}

/** Minimal shape needed to extract config from a service-like object. */
interface ServiceWithOptionalConfig {
  readonly id: string;
  readonly config?: z.ZodType | undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Collect config schemas from services that declare them.
 *
 * Returns entries keyed by service ID for composition into `defineConfig`.
 * Services without a `config` schema are excluded.
 */
export const collectServiceConfigs = (
  services: readonly ServiceWithOptionalConfig[]
): ServiceConfigEntry[] =>
  services
    .filter(
      (
        svc
      ): svc is ServiceWithOptionalConfig & { readonly config: z.ZodType } =>
        svc.config !== undefined
    )
    .map((svc) => ({ schema: svc.config, serviceId: svc.id }));
