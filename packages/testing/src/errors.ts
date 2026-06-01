import {
  errorClasses,
  InternalError,
  RetryExhaustedError,
  TrailsError,
} from '@ontrails/core';

type ErrorConstructor = new (...args: never[]) => Error;
type MessageErrorConstructor = new (message: string) => Error;

const ERROR_CLASS_BY_NAME = new Map<string, ErrorConstructor>([
  ...errorClasses.map(
    (entry) => [entry.name, entry.ctor as ErrorConstructor] as const
  ),
  ['TrailsError', TrailsError as unknown as ErrorConstructor],
]);

/**
 * Resolve an error class name string to the actual constructor.
 * Falls back to generic Error if the name is not in the core taxonomy.
 */
export const resolveErrorClass = (name: string): ErrorConstructor =>
  ERROR_CLASS_BY_NAME.get(name) ?? (Error as ErrorConstructor);

/**
 * Create an error instance for an authored example error name.
 */
export const createErrorFromName = (name: string): Error => {
  if (name === 'TrailsError') {
    return new InternalError(name);
  }

  const entry = errorClasses.find((candidate) => candidate.name === name);
  if (entry === undefined) {
    return new Error(name);
  }

  if (entry.name === 'RetryExhaustedError') {
    return new RetryExhaustedError(new InternalError(name), {
      attempts: 1,
      detour: 'testComposes',
    });
  }

  const ErrorClass = entry.ctor as unknown as MessageErrorConstructor;
  return new ErrorClass(name);
};
