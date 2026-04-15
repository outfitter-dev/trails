/**
 * Branded types and validated constructors for @ontrails/core.
 *
 * Branded types enforce domain constraints at the type level while remaining
 * plain primitives at runtime. Factory functions return Result so callers
 * handle validation failures explicitly.
 */

import { ValidationError } from './errors.js';
import type { Result } from './result.js';
import { Result as R } from './result.js';

// ---------------------------------------------------------------------------
// Branding primitive
// ---------------------------------------------------------------------------

/** Attach a phantom tag to a base type. */
export type Branded<T, Tag extends string> = T & { readonly __brand: Tag };

/** Brand a value. No validation — use factory functions for safe construction. */
export const brand = <T, Tag extends string>(
  _tag: Tag,
  value: T
): Branded<T, Tag> => value as Branded<T, Tag>;

/** Strip the brand and recover the underlying value. */
export const unbrand = <T>(value: Branded<T, string>): T => value as T;

// ---------------------------------------------------------------------------
// Built-in branded types
// ---------------------------------------------------------------------------

export type UUID = Branded<string, 'UUID'>;
export type Email = Branded<string, 'Email'>;
export type NonEmptyString = Branded<string, 'NonEmptyString'>;
export type PositiveInt = Branded<number, 'PositiveInt'>;

// ---------------------------------------------------------------------------
// Validation patterns
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Factory functions — each returns Result<BrandedType, ValidationError>
// ---------------------------------------------------------------------------

export const uuid = (value: string): Result<UUID, ValidationError> => {
  if (!UUID_RE.test(value)) {
    return R.err(
      new ValidationError(`Invalid UUID: "${value}"`, {
        context: { value },
      })
    );
  }
  return R.ok(value as UUID);
};

export const email = (value: string): Result<Email, ValidationError> => {
  if (!EMAIL_RE.test(value)) {
    return R.err(
      new ValidationError(`Invalid email: "${value}"`, {
        context: { value },
      })
    );
  }
  return R.ok(value as Email);
};

export const nonEmptyString = (
  value: string
): Result<NonEmptyString, ValidationError> => {
  if (value.length === 0) {
    return R.err(new ValidationError('String must not be empty'));
  }
  return R.ok(value as NonEmptyString);
};

export const positiveInt = (
  value: number
): Result<PositiveInt, ValidationError> => {
  if (!Number.isInteger(value) || value <= 0) {
    return R.err(
      new ValidationError(`Expected positive integer, got ${value}`, {
        context: { value },
      })
    );
  }
  return R.ok(value as PositiveInt);
};

// ---------------------------------------------------------------------------
// ID utilities
// ---------------------------------------------------------------------------

const ALPHANUMERIC =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Generate a random alphanumeric ID.
 * Runtime-agnostic: uses `crypto.getRandomValues`.
 */
export const shortId = (length = 8): string => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let id = '';
  for (let i = 0; i < length; i += 1) {
    const byte = bytes[i];
    if (byte !== undefined) {
      id += ALPHANUMERIC[byte % ALPHANUMERIC.length];
    }
  }
  return id;
};

/**
 * Produce a deterministic hex hash from an input string.
 * Uses a simple FNV-1a 32-bit hash — good enough for non-cryptographic IDs.
 */
export const deriveIdHash = (input: string): string => {
  // FNV offset basis
  let hash = 2_166_136_261;
  for (let i = 0; i < input.length; i += 1) {
    // oxlint-disable-next-line no-bitwise -- FNV-1a hash requires XOR
    hash ^= input.codePointAt(i) ?? 0;
    // FNV prime
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  // Convert to unsigned 32-bit then hex
  // oxlint-disable-next-line no-bitwise, prefer-math-trunc -- unsigned right shift needed for u32 conversion (Math.trunc differs semantically)
  return (hash >>> 0).toString(16).padStart(8, '0');
};
