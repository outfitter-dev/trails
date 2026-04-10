import type { z } from 'zod';

import type { FieldOverride } from './derive.js';
import type { Result } from './result.js';
import type { AnyResource } from './resource.js';
import type { AnySignal } from './signal.js';
import type {
  Implementation,
  PermitRequirement,
  TrailContext,
} from './types.js';

// ---------------------------------------------------------------------------
// Trail example
// ---------------------------------------------------------------------------

/**
 * A named example for documentation and testing.
 *
 * The `input` field accepts `Partial<I>` so that fields with schema defaults
 * (e.g. `z.number().default(20)`) can be omitted from examples. The schema
 * fills in defaults at validation time.
 */
export interface TrailExample<I, O> {
  /** Human-readable name */
  readonly name: string;
  /** Optional description of what this example demonstrates */
  readonly description?: string | undefined;
  /** The input value — fields with schema defaults may be omitted */
  readonly input: Partial<I>;
  /** Expected output for success-path examples */
  readonly expected?: O | undefined;
  /** Error class name for error-path examples */
  readonly error?: string | undefined;
}

// ---------------------------------------------------------------------------
// Blaze input — merges crossInput when declared
// ---------------------------------------------------------------------------

/**
 * The input type received by a trail's blaze function.
 *
 * When a trail declares `crossInput`, the runtime merges those fields into
 * the input object before calling blaze. This type makes the compiler aware
 * of the merged shape so developers can access crossInput fields without a
 * cast. Falls back to plain `I` when `CI` is `never` (the default).
 */
export type BlazeInput<I, CI> = [CI] extends [never] ? I : I & CI;

// ---------------------------------------------------------------------------
// Trail spec
// ---------------------------------------------------------------------------

/** Everything needed to define a trail (minus the id) */
export interface TrailSpec<I, O, CI = never> {
  /** Zod schema for validating input */
  readonly input: z.ZodType<I>;
  /** Zod schema for validating output (optional — some trails are fire-and-forget) */
  readonly output?: z.ZodType<O> | undefined;
  /** The pure function that does the work (sync or async authoring) */
  readonly blaze: Implementation<BlazeInput<I, CI>, O>;
  /** Human-readable description */
  readonly description?: string | undefined;
  /** Named examples for docs and testing */
  readonly examples?: readonly TrailExample<I, O>[] | undefined;
  /** What this trail does to the world: read, write (default), or destroy */
  readonly intent?: 'read' | 'write' | 'destroy' | undefined;
  /** Trail is idempotent (safe to retry) */
  readonly idempotent?: boolean | undefined;
  /** Arbitrary meta for tooling and filtering */
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
  /** Named sets of downstream trail IDs that may be invoked */
  readonly detours?: Readonly<Record<string, readonly string[]>> | undefined;
  /** Per-field overrides for deriveFields() (labels, hints, options) */
  readonly fields?: Readonly<Record<string, FieldOverride>> | undefined;
  /** IDs or trail objects of downstream trails this trail may invoke via ctx.cross() */
  readonly crosses?: readonly (string | AnyTrail)[] | undefined;
  /**
   * Composition-only input schema — merged with `input` for `ctx.cross()` calls,
   * invisible to public trailheads (CLI, MCP, HTTP).
   *
   * Fields here are available in the blaze but are not derived into CLI flags,
   * MCP tool parameters, or HTTP request bodies. Use for data that only makes
   * sense when one trail crosses another (e.g. `forkedFrom`).
   */
  readonly crossInput?: z.ZodType<CI> | undefined;
  /** Resources this trail may access via resource.from(ctx) */
  readonly resources?: readonly AnyResource[] | undefined;
  /**
   * Signals this trail emits via `ctx.fire()`.
   *
   * Accepts either a string id or a `Signal` value. Both forms are
   * normalized to the signal's id at trail definition time, so
   * `trail.fires` is always `readonly string[]`.
   *
   * Note: `crosses` is still string-only — only signal references are
   * loosened here because callers typically have the `Signal` value in
   * scope at the definition site.
   */
  readonly fires?: readonly (string | AnySignal)[] | undefined;
  /**
   * Signals that activate this trail (framework auto-subscribes).
   *
   * Accepts either a string id or a `Signal` value. Both forms are
   * normalized to the signal's id at trail definition time.
   */
  readonly on?: readonly (string | AnySignal)[] | undefined;
  /** Auth requirement: scopes object, 'public', or omitted (undeclared) */
  readonly permit?: PermitRequirement | undefined;
  /** Primary input fields and their order. CLI projects as positional args. */
  readonly args?: readonly string[] | false | undefined;
}

// ---------------------------------------------------------------------------
// Trail (the frozen runtime object)
// ---------------------------------------------------------------------------

/** Intent describes what a trail does to the world */
export type Intent = 'read' | 'write' | 'destroy';

/** A fully-defined trail — the unit of work in the Trails system */
export interface Trail<I, O, CI = never> extends Omit<
  TrailSpec<I, O, CI>,
  | 'args'
  | 'blaze'
  | 'crosses'
  | 'crossInput'
  | 'fires'
  | 'intent'
  | 'on'
  | 'resources'
> {
  readonly kind: 'trail';
  readonly id: string;
  readonly blaze: Implementation<BlazeInput<I, CI>, O>;
  /** IDs of downstream trails this trail may invoke via ctx.cross() (always present, default []) */
  readonly crosses: readonly string[];
  /** Composition-only input schema, merged with `input` for ctx.cross() calls (optional) */
  readonly crossInput?: z.ZodType<CI> | undefined;
  /** Resources this trail may access via resource.from(ctx) (always present, default []) */
  readonly resources: readonly AnyResource[];
  /** IDs of signals this trail emits via ctx.fire() (always present, default []) */
  readonly fires: readonly string[];
  /** IDs of signals that activate this trail (always present, default []) */
  readonly on: readonly string[];
  /** What this trail does to the world (always present, default 'write') */
  readonly intent: Intent;
  /** Primary input fields and their order (always present, default undefined) */
  readonly args?: readonly string[] | false | undefined;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const normalizeSignalRef = (entry: string | AnySignal): string =>
  typeof entry === 'string' ? entry : entry.id;

/** Normalize a crosses entry — trail objects are reduced to their id. */
const normalizeCrossRef = (entry: string | AnyTrail): string =>
  typeof entry === 'string' ? entry : entry.id;

/**
 * Create a trail definition.
 *
 * Returns a frozen object with `kind: "trail"` and all spec fields.
 * The trail is inert until handed to a runner.
 *
 * @example
 * ```typescript
 * // ID as first argument (recommended for human authoring)
 * const show = trail("entity.show", {
 *   input: z.object({ name: z.string() }),
 *   blaze: (input) => Result.ok(entity),
 * });
 *
 * // Full spec object (for programmatic generation)
 * const show = trail({
 *   id: "entity.show",
 *   input: z.object({ name: z.string() }),
 *   blaze: (input) => Result.ok(entity),
 * });
 * ```
 */
export function trail<I, O, CI = never>(
  id: string,
  spec: TrailSpec<I, O, CI>
): Trail<I, O, CI>;
export function trail<I, O, CI = never>(
  spec: TrailSpec<I, O, CI> & { readonly id: string }
): Trail<I, O, CI>;
export function trail<I, O, CI = never>(
  idOrSpec: string | (TrailSpec<I, O, CI> & { readonly id: string }),
  maybeSpec?: TrailSpec<I, O, CI>
): Trail<I, O, CI> {
  const resolved =
    typeof idOrSpec === 'string'
      ? { id: idOrSpec, spec: maybeSpec }
      : { id: idOrSpec.id, spec: idOrSpec };

  if (!resolved.spec) {
    throw new TypeError('trail() requires a spec when an id is provided');
  }

  const {
    args: rawArgs,
    blaze,
    crossInput,
    crosses: rawCrosses,
    fires: rawFires,
    intent: rawIntent,
    on: rawOn,
    resources: rawResources,
    ...spec
  } = resolved.spec;
  const resources = Object.freeze([...(rawResources ?? [])]);
  const fires = Object.freeze((rawFires ?? []).map(normalizeSignalRef));
  const on = Object.freeze((rawOn ?? []).map(normalizeSignalRef));
  const args = Array.isArray(rawArgs) ? Object.freeze([...rawArgs]) : rawArgs;

  return Object.freeze({
    ...spec,
    args,
    blaze: async (input: BlazeInput<I, CI>, ctx: TrailContext) =>
      await blaze(input, ctx),
    crossInput,
    crosses: Object.freeze((rawCrosses ?? []).map(normalizeCrossRef)),
    fires,
    id: resolved.id,
    intent: rawIntent ?? 'write',
    kind: 'trail' as const,
    on,
    resources,
  });
}

// Re-export types that callers of trail() will need
// The Omit+override avoids a TypeScript limitation where BlazeInput's conditional type
// makes Trail<any, any, any> structurally incompatible with Trail<I, O, never>.
/* oxlint-disable no-explicit-any -- existential type for heterogeneous collections */
export type AnyTrail = Omit<Trail<any, any, any>, 'blaze'> & {
  readonly blaze: Implementation<any, any>;
};
/* oxlint-enable no-explicit-any */

export type { Implementation, TrailContext, Result };
