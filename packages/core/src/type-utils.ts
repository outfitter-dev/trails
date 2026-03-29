/**
 * Type utilities for extracting input/output types from trails.
 */

import type { z } from 'zod';

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

/* oxlint-enable no-explicit-any */

// ---------------------------------------------------------------------------
// Runtime schema accessors
// ---------------------------------------------------------------------------

/** Get the input Zod schema from a trail. */
export const inputOf = <I, O>(trail: Trail<I, O>): z.ZodType<I> => trail.input;

/** Get the output Zod schema from a trail, if defined. */
export const outputOf = <I, O>(trail: Trail<I, O>): z.ZodType<O> | undefined =>
  trail.output;
