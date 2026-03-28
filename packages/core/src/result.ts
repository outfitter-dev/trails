/**
 * A type-safe Result monad for representing success/failure without exceptions.
 */

import { InternalError, ValidationError } from './errors.js';

class Ok<T, E> {
  readonly value: T;

  constructor(value: T) {
    this.value = value;
  }

  // oxlint-disable-next-line class-methods-use-this -- type guard for Result discriminated union
  isOk(): this is Ok<T, E> {
    return true;
  }

  // oxlint-disable-next-line class-methods-use-this -- type guard for Result discriminated union
  isErr(): this is Err<E> {
    return false;
  }

  map<U>(fn: (value: T) => U): Result<U, E> {
    return new Ok(fn(this.value));
  }

  flatMap<U, F = E>(fn: (value: T) => Result<U, F>): Result<U, E | F> {
    return fn(this.value);
  }

  mapErr<F>(_fn: (error: E) => F): Result<T, F> {
    return new Ok(this.value);
  }

  match<U>(handlers: { ok: (value: T) => U; err: (error: E) => U }): U {
    return handlers.ok(this.value);
  }

  unwrap(): T {
    return this.value;
  }

  unwrapOr(_fallback: T): T {
    return this.value;
  }
}

// oxlint-disable-next-line max-classes-per-file -- Result monad requires paired Ok/Err classes
class Err<E> {
  readonly error: E;

  constructor(error: E) {
    this.error = error;
  }

  // oxlint-disable-next-line class-methods-use-this -- type guard for Result discriminated union
  isOk(): this is Ok<never, E> {
    return false;
  }

  // oxlint-disable-next-line class-methods-use-this -- type guard for Result discriminated union
  isErr(): this is Err<E> {
    return true;
  }

  map<U>(_fn: (value: never) => U): Result<U, E> {
    return new Err(this.error);
  }

  flatMap<U, F = E>(_fn: (value: never) => Result<U, F>): Result<U, E | F> {
    return new Err(this.error);
  }

  mapErr<F>(fn: (error: E) => F): Result<never, F> {
    return new Err(fn(this.error));
  }

  match<U>(handlers: { ok: (value: never) => U; err: (error: E) => U }): U {
    return handlers.err(this.error);
  }

  unwrap(): never {
    throw this.error instanceof Error
      ? this.error
      : new Error(String(this.error));
  }

  // oxlint-disable-next-line class-methods-use-this -- symmetric API with Ok.unwrapOr
  unwrapOr<T>(fallback: T): T {
    return fallback;
  }
}

export type Result<T, E = Error> = Ok<T, E> | Err<E>;

// eslint-disable-next-line @typescript-eslint/no-namespace
export const Result = {
  combine<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
    const values: T[] = [];
    for (const result of results) {
      if (result.isErr()) {
        return new Err(result.error);
      }
      values.push(result.value);
    }
    return new Ok(values);
  },

  err<E>(error: E): Err<E> {
    return new Err(error);
  },

  /**
   * Wrap a fetch call in a Result, mapping failures to TrailsError subclasses.
   *
   * Network errors become NetworkError. Abort signals become CancelledError.
   * HTTP error status codes map to the appropriate error category.
   */
  async fromFetch(
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Result<Response, Error>> {
    // Lazy import avoids a circular dependency (fetch.ts imports Result)
    const { fromFetch: fetchImpl } = await import('./fetch.js');
    return fetchImpl(input, init);
  },

  /**
   * Parse a JSON string, returning a Result instead of throwing.
   */
  fromJson(json: string): Result<unknown, ValidationError> {
    try {
      return new Ok(JSON.parse(json) as unknown);
    } catch (error) {
      return new Err(
        new ValidationError('Invalid JSON', {
          cause: error instanceof Error ? error : new Error(String(error)),
          context: { input: json.slice(0, 200) },
        })
      );
    }
  },

  ok<T = void>(value?: T): Result<T, never> {
    return new Ok(value as T);
  },

  /**
   * Stringify a value to JSON, returning a Result. Handles circular references.
   */
  toJson(value: unknown): Result<string, InternalError> {
    try {
      const seen = new WeakSet();
      const json = JSON.stringify(value, (_key, val: unknown) => {
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) {
            return '[Circular]';
          }
          seen.add(val);
        }
        return val;
      });
      if (json === undefined) {
        return new Err(
          new InternalError('Value is not JSON-serializable', {
            context: { type: typeof value },
          })
        );
      }
      return new Ok(json);
    } catch (error) {
      return new Err(
        new InternalError('Failed to stringify value', {
          cause: error instanceof Error ? error : new Error(String(error)),
        })
      );
    }
  },
} as const;
