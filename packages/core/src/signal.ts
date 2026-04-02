/**
 * Signal — a named payload schema with optional provenance metadata.
 */

import type { z } from 'zod';

// ---------------------------------------------------------------------------
// Spec (input to the factory)
// ---------------------------------------------------------------------------

export interface SignalSpec<T> {
  readonly payload: z.ZodType<T>;
  readonly description?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  /** Trail IDs that produce this signal (e.g. the trails it originates from). */
  readonly from?: readonly string[] | undefined;
}

// ---------------------------------------------------------------------------
// Shape (output of the factory)
// ---------------------------------------------------------------------------

export interface Signal<T> {
  readonly id: string;
  readonly kind: 'signal';
  readonly payload: z.ZodType<T>;
  readonly description?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  /** Trail IDs that produce this signal (e.g. the trails it originates from). */
  readonly from?: readonly string[] | undefined;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a signal definition.
 *
 * A signal is a named payload schema describing something that happened.
 * Returns a frozen object with `kind: "signal"` and all spec fields.
 */
export function signal<T>(id: string, spec: SignalSpec<T>): Signal<T>;
export function signal<T>(
  spec: SignalSpec<T> & { readonly id: string }
): Signal<T>;
export function signal<T>(
  idOrSpec: string | (SignalSpec<T> & { readonly id: string }),
  maybeSpec?: SignalSpec<T>
): Signal<T> {
  const resolvedId = typeof idOrSpec === 'string' ? idOrSpec : idOrSpec.id;
  // oxlint-disable-next-line no-non-null-assertion -- overload guarantees maybeSpec when idOrSpec is string
  const resolvedSpec = typeof idOrSpec === 'string' ? maybeSpec! : idOrSpec;
  return Object.freeze({
    description: resolvedSpec.description,
    from: resolvedSpec.from ? Object.freeze([...resolvedSpec.from]) : undefined,
    id: resolvedId,
    kind: 'signal' as const,
    metadata: resolvedSpec.metadata,
    payload: resolvedSpec.payload,
  });
}

/** Existential type for heterogeneous signal collections */
export type AnySignal = Signal<unknown>;
