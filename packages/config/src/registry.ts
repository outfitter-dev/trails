/**
 * Module-level config state registry.
 *
 * Config is resolved once at bootstrap (two-phase init per ADR-010) and
 * registered here so `configProvision` can expose it to trailheads. This is
 * a process-level singleton — config resolution is inherently global.
 */
import type { z } from 'zod';

/** Resolved config state carrying the schema and all layer values. */
export interface ConfigState {
  readonly schema: z.ZodObject<Record<string, z.ZodType>>;
  readonly resolved: Record<string, unknown>;
  readonly base?: Record<string, unknown>;
  readonly loadout?: Record<string, unknown>;
  readonly local?: Record<string, unknown>;
  readonly env?: Record<string, string | undefined>;
}

let current: ConfigState | undefined;

/** Register resolved config state at bootstrap. */
export const registerConfigState = (state: ConfigState): void => {
  current = state;
};

/** Read the registered config state. Returns `undefined` before registration. */
export const getConfigState = (): ConfigState | undefined => current;

/** Clear registered state. Primarily useful in tests. */
export const clearConfigState = (): void => {
  current = undefined;
};
