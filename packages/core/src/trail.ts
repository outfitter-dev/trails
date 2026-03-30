import type { z } from 'zod';

import type { FieldOverride } from './derive.js';
import type { Result } from './result.js';
import type { AnyService } from './service.js';
import type { Implementation, TrailContext } from './types.js';

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
  readonly run: Implementation<I, O>;
  /** Human-readable description */
  readonly description?: string | undefined;
  /** Named examples for docs and testing */
  readonly examples?: readonly TrailExample<I, O>[] | undefined;
  /** What this trail does to the world: read, write (default), or destroy */
  readonly intent?: 'read' | 'write' | 'destroy' | undefined;
  /** Trail is idempotent (safe to retry) */
  readonly idempotent?: boolean | undefined;
  /** Arbitrary metadata for tooling and filtering */
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  /** Named sets of downstream trail IDs that may be invoked */
  readonly detours?: Readonly<Record<string, readonly string[]>> | undefined;
  /** Per-field overrides for deriveFields() (labels, hints, options) */
  readonly fields?: Readonly<Record<string, FieldOverride>> | undefined;
  /** IDs of downstream trails this trail may invoke via ctx.follow() */
  readonly follow?: readonly string[] | undefined;
  /** Services this trail may access via service.from(ctx) */
  readonly services?: readonly AnyService[] | undefined;
}

// ---------------------------------------------------------------------------
// Trail (the frozen runtime object)
// ---------------------------------------------------------------------------

/** Intent describes what a trail does to the world */
export type Intent = 'read' | 'write' | 'destroy';

/** A fully-defined trail — the unit of work in the Trails system */
export interface Trail<I, O> extends Omit<
  TrailSpec<I, O>,
  'run' | 'follow' | 'intent' | 'services'
> {
  readonly kind: 'trail';
  readonly id: string;
  readonly run: Implementation<I, O>;
  /** IDs of downstream trails this trail may invoke via ctx.follow() (always present, default []) */
  readonly follow: readonly string[];
  /** Services this trail may access via service.from(ctx) (always present, default []) */
  readonly services: readonly AnyService[];
  /** What this trail does to the world (always present, default 'write') */
  readonly intent: Intent;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

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
 *   run: (input) => Result.ok(entity),
 * });
 *
 * // Full spec object (for programmatic generation)
 * const show = trail({
 *   id: "entity.show",
 *   input: z.object({ name: z.string() }),
 *   run: (input) => Result.ok(entity),
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
    run,
    follow: rawFollow,
    intent: rawIntent,
    services: rawServices,
    ...spec
  } = resolved.spec;

  return Object.freeze({
    ...spec,
    follow: Object.freeze([...(rawFollow ?? [])]),
    id: resolved.id,
    intent: rawIntent ?? 'write',
    kind: 'trail' as const,
    run: async (input: I, ctx: TrailContext) => await run(input, ctx),
    services: Object.freeze([...(rawServices ?? [])]),
  });
}

// Re-export types that callers of trail() will need
// oxlint-disable-next-line no-explicit-any -- existential type for heterogeneous collections; `any` is correct here because Implementation is contravariant in I
export type AnyTrail = Trail<any, any>;

export type { Implementation, TrailContext, Result };
