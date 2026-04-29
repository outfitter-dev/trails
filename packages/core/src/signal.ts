/**
 * Signal — a named payload schema with optional provenance meta.
 */

import type { z } from 'zod';

const formatExampleIssues = (issues: readonly z.core.$ZodIssue[]): string =>
  issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      return `${path}: ${issue.message}`;
    })
    .join('; ');

const assertSignalExamples = <T>(
  id: string,
  payload: z.ZodType<T>,
  examples: readonly T[]
): void => {
  for (const [index, example] of examples.entries()) {
    const parsed = payload.safeParse(example);
    if (!parsed.success) {
      throw new TypeError(
        `signal("${id}") example ${index} is invalid: ${formatExampleIssues(parsed.error.issues)}`
      );
    }
  }
};

// ---------------------------------------------------------------------------
// Spec (input to the factory)
// ---------------------------------------------------------------------------

export interface SignalSpec<T> {
  readonly payload: z.ZodType<T>;
  readonly description?: string | undefined;
  /** Example payloads validated against the signal payload schema. */
  readonly examples?: readonly T[] | undefined;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
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
  /** Example payloads validated against the signal payload schema. */
  readonly examples?: readonly T[] | undefined;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
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
  if (resolvedSpec.examples !== undefined) {
    assertSignalExamples(
      resolvedId,
      resolvedSpec.payload,
      resolvedSpec.examples
    );
  }
  return Object.freeze({
    description: resolvedSpec.description,
    examples: resolvedSpec.examples
      ? Object.freeze([...resolvedSpec.examples])
      : undefined,
    from: resolvedSpec.from ? Object.freeze([...resolvedSpec.from]) : undefined,
    id: resolvedId,
    kind: 'signal' as const,
    meta: resolvedSpec.meta,
    payload: resolvedSpec.payload,
  });
}

/** Existential type for heterogeneous signal collections */
export type AnySignal = Signal<unknown>;
