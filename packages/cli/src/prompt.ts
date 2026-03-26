/**
 * Surface-agnostic input resolution contracts for CLI commands.
 *
 * The core CLI package does not depend on any concrete prompt library.
 * Callers can provide a resolver that gathers missing input however they want
 * (Clack, forms, conversational UI, or no prompting at all).
 */

import type { Field } from '@ontrails/core';

/**
 * Options passed to an input resolver.
 *
 * `isTTY` is provided so callers can override interactivity in tests.
 */
export interface ResolveInputOptions {
  readonly isTTY?: boolean | undefined;
}

/**
 * A resolver that fills in missing values for derived schema fields.
 *
 * The resolver receives the current input as field-name keyed values and
 * returns a merged record with any newly gathered answers.
 */
export type InputResolver = (
  fields: readonly Field[],
  provided: Record<string, unknown>,
  options?: ResolveInputOptions
) => Promise<Record<string, unknown>>;

/** Default passthrough resolver for non-interactive execution. */
export const passthroughResolver: InputResolver = async (_fields, provided) =>
  await provided;

/** Shared TTY check for resolver implementations. */
export const isInteractive = (options?: ResolveInputOptions): boolean =>
  options?.isTTY ?? process.stdin.isTTY ?? false;

export type { Field };
