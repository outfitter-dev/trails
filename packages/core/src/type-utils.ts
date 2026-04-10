/**
 * Type utilities for extracting input/output types from trails.
 */

import type { z } from 'zod';

import type { Result } from './result.js';
import type { AnyTrail, Trail } from './trail.js';

// ---------------------------------------------------------------------------
// Utility types
// ---------------------------------------------------------------------------

/* oxlint-disable no-explicit-any -- `any` required for conditional type inference; `unknown` breaks inference */

/** Extract the input type from a Trail. */
export type TrailInput<T extends AnyTrail> =
  T extends Trail<infer I, any> ? I : never;

/** Extract the output type from a Trail. */
export type TrailOutput<T extends AnyTrail> =
  T extends Trail<any, infer O> ? O : never;

/**
 * Extract the cross-callable input type from a trail.
 *
 * When a trail declares `crossInput`, callers via `ctx.cross()` must pass
 * both the public input fields and the composition-only fields. This type
 * merges both schemas so the compiler enforces the full shape at the call
 * site. Falls back to plain `TrailInput<T>` when no `crossInput` exists.
 */
export type CrossInput<T extends AnyTrail> = T extends {
  crossInput: z.ZodType<infer CI>;
}
  ? TrailInput<T> & CI
  : TrailInput<T>;

/**
 * Extracts the full `Result<Output, Error>` type from a trail definition.
 *
 * @example
 * ```typescript
 * type SearchResult = TrailResult<typeof searchTrail>;
 * // Result<{ results: Item[]; count: number }, Error>
 * ```
 */
export type TrailResult<T extends AnyTrail> = Result<TrailOutput<T>, Error>;

/* oxlint-enable no-explicit-any */

// ---------------------------------------------------------------------------
// Runtime schema accessors
// ---------------------------------------------------------------------------

/** Get the input Zod schema from a trail, preserving the specific schema type. */
export const inputOf = <T extends AnyTrail>(trail: T): T['input'] =>
  trail.input;

/** Get the output Zod schema from a trail, if defined, preserving the specific schema type. */
export const outputOf = <T extends AnyTrail>(trail: T): T['output'] =>
  trail.output;
