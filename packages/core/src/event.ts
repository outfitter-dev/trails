/**
 * Event — a named payload schema with optional provenance metadata.
 */

import type { z } from 'zod';

// ---------------------------------------------------------------------------
// Spec (input to the factory)
// ---------------------------------------------------------------------------

export interface EventSpec<T> {
  readonly payload: z.ZodType<T>;
  readonly description?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  /** Trail IDs that produce this event (e.g. the trails it originates from). */
  readonly from?: readonly string[] | undefined;
}

// ---------------------------------------------------------------------------
// Shape (output of the factory)
// ---------------------------------------------------------------------------

export interface Event<T> {
  readonly id: string;
  readonly kind: 'event';
  readonly payload: z.ZodType<T>;
  readonly description?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  /** Trail IDs that produce this event (e.g. the trails it originates from). */
  readonly from?: readonly string[] | undefined;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an event definition.
 *
 * An event is a named payload schema describing something that happened.
 * Returns a frozen object with `kind: "event"` and all spec fields.
 *
 * @example
 * ```typescript
 * // ID as first argument
 * const updated = event("entity.updated", {
 *   payload: EntityUpdatedSchema,
 *   from: ["entity.add", "entity.update"],
 * });
 *
 * // Full spec object (programmatic)
 * const updated = event({ id: "entity.updated", payload: ..., from: [...] });
 * ```
 */
export function event<T>(id: string, spec: EventSpec<T>): Event<T>;
export function event<T>(
  spec: EventSpec<T> & { readonly id: string }
): Event<T>;
export function event<T>(
  idOrSpec: string | (EventSpec<T> & { readonly id: string }),
  maybeSpec?: EventSpec<T>
): Event<T> {
  const resolvedId = typeof idOrSpec === 'string' ? idOrSpec : idOrSpec.id;
  // oxlint-disable-next-line no-non-null-assertion -- overload guarantees maybeSpec when idOrSpec is string
  const resolvedSpec = typeof idOrSpec === 'string' ? maybeSpec! : idOrSpec;
  return Object.freeze({
    description: resolvedSpec.description,
    from: resolvedSpec.from ? Object.freeze([...resolvedSpec.from]) : undefined,
    id: resolvedId,
    kind: 'event' as const,
    metadata: resolvedSpec.metadata,
    payload: resolvedSpec.payload,
  });
}

/** Existential type for heterogeneous event collections */
export type AnyEvent = Event<unknown>;
