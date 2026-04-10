/**
 * Compile-time type assertions for type-utils.
 *
 * This file lives in src/ (not __tests__/) so it is included in the
 * typecheck pass. It contains no runtime code — only type-level
 * assertions that fail the build when type inference regresses.
 *
 * Assertion types are exported to satisfy `noUnusedLocals` but are not
 * re-exported from the package index.
 */

import type { Trail } from './trail.js';
import type { CrossInput, TrailInput } from './type-utils.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A trail with crossInput declared. */
type CrossTrail = Trail<
  { name: string },
  { id: string },
  { forkedFrom: string }
>;

/** A trail without crossInput. */
type PlainTrail = Trail<{ name: string }, { id: string }>;

// ---------------------------------------------------------------------------
// CrossInput<T> must include crossInput fields
// ---------------------------------------------------------------------------

type WithCrossInput = CrossInput<CrossTrail>;

// Must require both `name` AND `forkedFrom`.
// Before the fix, `forkedFrom` was erased.
type AssertMerged = WithCrossInput extends { name: string; forkedFrom: string }
  ? true
  : false;
export type Merged = [AssertMerged] extends [true] ? 'pass' : never;

// ---------------------------------------------------------------------------
// CrossInput<T> falls back to TrailInput<T> when no crossInput
// ---------------------------------------------------------------------------

type WithoutCrossInput = CrossInput<PlainTrail>;
type BaseInput = TrailInput<PlainTrail>;

// These should be mutually assignable (identical).
type AssertFallback1 = WithoutCrossInput extends BaseInput ? true : false;
type AssertFallback2 = BaseInput extends WithoutCrossInput ? true : false;
export type Fallback = [AssertFallback1, AssertFallback2] extends [true, true]
  ? 'pass'
  : never;

// ---------------------------------------------------------------------------
// CI = never default preserves backward compat
// ---------------------------------------------------------------------------

// Trail<I, O> (two generics) should be assignable to Trail<I, O, never>
type AssertDefault =
  Trail<{ x: number }, { y: number }> extends Trail<
    { x: number },
    { y: number },
    never
  >
    ? true
    : false;
export type Default = [AssertDefault] extends [true] ? 'pass' : never;
