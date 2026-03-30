import type { Result } from './result.js';
import type { TrailContext } from './types.js';
import type { z } from 'zod';

/**
 * Stable process-scoped fields available when constructing a service.
 *
 * Services are app-level singletons, so they intentionally do not receive the
 * full per-request TrailContext.
 */
export type ServiceContext = Pick<
  TrailContext,
  'cwd' | 'env' | 'workspaceRoot'
>;

/**
 * Everything needed to describe a service before a factory is introduced.
 */
export interface ServiceSpec<T> {
  /** Create the service instance from stable process-scoped context. */
  readonly create: (
    svc: ServiceContext
  ) => Result<T, Error> | Promise<Result<T, Error>>;
  /** Reserved config schema for follow-up config composition work. */
  readonly config?: z.ZodType | undefined;
  /** Optional cleanup performed when the hosting surface shuts down. */
  readonly dispose?: ((service: T) => void | Promise<void>) | undefined;
  /** Optional operational readiness probe for introspection tooling. */
  readonly health?:
    | ((service: T) => Result<unknown, Error> | Promise<Result<unknown, Error>>)
    | undefined;
  /** Optional test factory used by higher-level helpers. */
  readonly mock?: (() => T | Promise<T>) | undefined;
  /** Human-readable description. */
  readonly description?: string | undefined;
  /** Arbitrary metadata for tooling and filtering. */
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * A typed service definition.
 *
 * TRL-73 introduces the structural contract only. The `service()` factory and
 * runtime helpers land in follow-up branches.
 */
export interface Service<T> extends ServiceSpec<T> {
  readonly kind: 'service';
  readonly id: string;
}

/**
 * Existential type for heterogeneous service collections.
 *
 * `Service<T>` includes function parameters in `dispose`/`health`, so `unknown`
 * is too narrow for mixed service arrays. `any` is the correct existential here.
 */
// oxlint-disable-next-line no-explicit-any -- existential type for heterogeneous service collections
export type AnyService = Service<any>;
