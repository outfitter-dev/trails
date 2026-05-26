/**
 * Type utilities for extracting input/output types from trails.
 */

import type { Result } from './result.js';
import type { AnyTrail } from './trail.js';
import type { Implementation } from './types.js';
import type { z } from 'zod';

// ---------------------------------------------------------------------------
// Utility types
// ---------------------------------------------------------------------------

/* oxlint-disable no-explicit-any -- `any` required for conditional type inference; `unknown` breaks inference */

/** Extract the input type from a Trail. */
export type TrailInput<T extends AnyTrail> = T extends {
  readonly input: z.ZodType<infer I>;
}
  ? I
  : never;

/** Extract the output type from a Trail. */
export type TrailOutput<T extends AnyTrail> = T extends {
  readonly blaze: Implementation<any, infer O>;
}
  ? O
  : never;

/**
 * Extract the compose-callable input type from a trail.
 *
 * When a trail declares `composeInput`, callers via `ctx.compose()` must pass
 * both the public input fields and the composition-only fields. This type
 * merges both schemas so the compiler enforces the full shape at the call
 * site. Falls back to plain `TrailInput<T>` when no `composeInput` exists.
 */
export type ComposeInput<T extends AnyTrail> =
  NonNullable<T['composeInput']> extends z.ZodType<infer CI>
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
