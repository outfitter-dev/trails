import { errorClasses } from '../errors.js';
import type { ErrorCategory, TrailsError } from '../errors.js';

export type TestErrorConstructor = new (
  message: string,
  options?: { cause?: Error; context?: Record<string, unknown> }
) => TrailsError;

export const isFixedRegistryEntry = (
  entry: (typeof errorClasses)[number]
): entry is Extract<
  (typeof errorClasses)[number],
  { category: ErrorCategory }
> => entry.category !== 'dynamic';

export const fixedErrorEntries = errorClasses.filter(isFixedRegistryEntry);
