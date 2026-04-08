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
// Trail spec
// ---------------------------------------------------------------------------

/** Everything needed to define a trail (minus the id) */
export interface TrailSpec<I, O> {
  /** Zod schema for validating input */
  readonly input: z.ZodType<I>;
  /** Zod schema for validating output (optional — some trails are fire-and-forget) */
  readonly output?: z.ZodType<O> | undefined;
  /** The pure function that does the work (sync or async authoring) */
  readonly blaze: Implementation<I, O>;
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
  /** IDs of downstream trails this trail may invoke via ctx.cross() */
  readonly crosses?: readonly string[] | undefined;
  /** Resources this trail may access via resource.from(ctx) */
  readonly resources?: readonly AnyResource[] | undefined;
  /** IDs of signals this trail emits via ctx.fire() */
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
}

// ---------------------------------------------------------------------------
// Trail (the frozen runtime object)
// ---------------------------------------------------------------------------

/** Intent describes what a trail does to the world */
export type Intent = 'read' | 'write' | 'destroy';

/** A fully-defined trail — the unit of work in the Trails system */
export interface Trail<I, O> extends Omit<
  TrailSpec<I, O>,
  'blaze' | 'crosses' | 'fires' | 'intent' | 'on' | 'resources'
> {
  readonly kind: 'trail';
  readonly id: string;
  readonly blaze: Implementation<I, O>;
  /** IDs of downstream trails this trail may invoke via ctx.cross() (always present, default []) */
  readonly crosses: readonly string[];
  /** Resources this trail may access via resource.from(ctx) (always present, default []) */
  readonly resources: readonly AnyResource[];
  /** IDs of signals this trail emits via ctx.fire() (always present, default []) */
  readonly fires: readonly string[];
  /** IDs of signals that activate this trail (always present, default []) */
  readonly on: readonly string[];
  /** What this trail does to the world (always present, default 'write') */
  readonly intent: Intent;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const normalizeSignalRef = (entry: string | AnySignal): string =>
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
export function trail<I, O>(id: string, spec: TrailSpec<I, O>): Trail<I, O>;
export function trail<I, O>(
  spec: TrailSpec<I, O> & { readonly id: string }
): Trail<I, O>;
export function trail<I, O>(
  idOrSpec: string | (TrailSpec<I, O> & { readonly id: string }),
  maybeSpec?: TrailSpec<I, O>
): Trail<I, O> {
  const resolved =
    typeof idOrSpec === 'string'
      ? { id: idOrSpec, spec: maybeSpec }
      : { id: idOrSpec.id, spec: idOrSpec };

  if (!resolved.spec) {
    throw new TypeError('trail() requires a spec when an id is provided');
  }

  const {
    blaze,
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

  return Object.freeze({
    ...spec,
    blaze: async (input: I, ctx: TrailContext) => await blaze(input, ctx),
    crosses: Object.freeze([...(rawCrosses ?? [])]),
    fires,
    id: resolved.id,
    intent: rawIntent ?? 'write',
    kind: 'trail' as const,
    on,
    resources,
  });
}

// Re-export types that callers of trail() will need
// oxlint-disable-next-line no-explicit-any -- existential type for heterogeneous collections; `any` is correct here because Implementation is contravariant in I
export type AnyTrail = Trail<any, any>;

export type { Implementation, TrailContext, Result };
