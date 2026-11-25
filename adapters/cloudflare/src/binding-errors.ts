import {
  InternalError,
  NetworkError,
  ValidationError,
  isTrailsError,
} from '@ontrails/core';
import type { z } from 'zod';

type BindingRole = 'kv' | 'blob' | 'queue';

const errorCause = (error: unknown): Error =>
  error instanceof Error
    ? error
    : new Error('Provider rejected with a non-Error value', { cause: error });

/** Local validation stays outside the native dependency-operation boundary. */
export const parseBindingArgument = <T>(
  schema: z.ZodType<T>,
  value: unknown
): T => {
  try {
    const parsed = schema.safeParse(value);
    if (parsed.success) {
      return parsed.data;
    }
    throw new ValidationError('Invalid Cloudflare binding argument', {
      cause: parsed.error,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError('Could not inspect Cloudflare binding argument', {
      cause: errorCause(error),
    });
  }
};

/** Preserve native typed failures and the consumer's unknown-dependency retry policy. */
export const invokeBinding = async <T>(
  role: BindingRole,
  operation: string,
  invoke: () => T | Promise<T>
): Promise<T> => {
  try {
    return await invoke();
  } catch (error) {
    if (isTrailsError(error)) {
      throw error;
    }
    throw new NetworkError(`Cloudflare ${role} ${operation} failed`, {
      cause: errorCause(error),
      context: { operation, role },
    });
  }
};

export const invalidBindingResponse = (
  role: BindingRole,
  operation: string
): InternalError =>
  new InternalError(
    `Cloudflare ${role} ${operation} returned an invalid response`,
    { context: { operation, role } }
  );

export const parseBindingResponse = <T>(
  schema: z.ZodType<T>,
  value: unknown,
  role: BindingRole,
  operation: string
): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw invalidBindingResponse(role, operation);
  }
  return parsed.data;
};
