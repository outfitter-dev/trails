import { NotFoundError } from './errors.js';
import type { Result } from './result.js';
import type { ServiceLookup, TrailContext } from './types.js';
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
  /** Read the resolved service instance from a trail context. */
  from(ctx: TrailContext): T;
}

/**
 * Existential type for heterogeneous service collections.
 *
 * `Service<T>` includes function parameters in `dispose`/`health`, so `unknown`
 * is too narrow for mixed service arrays. `any` is the correct existential here.
 */
// oxlint-disable-next-line no-explicit-any -- existential type for heterogeneous service collections
export type AnyService = Service<any>;

/** Explicit runtime overrides keyed by service ID. */
export type ServiceOverrideMap = Readonly<Record<string, unknown>>;

const getServiceId = <T>(
  serviceOrId: string | Pick<Service<T>, 'id'>
): string => (typeof serviceOrId === 'string' ? serviceOrId : serviceOrId.id);

const getServiceInstance = <T>(
  ctx: Pick<TrailContext, 'extensions'>,
  serviceOrId: string | Pick<Service<T>, 'id'>
): T => {
  const id = getServiceId(serviceOrId);
  return ctx.extensions?.[id] as T;
};

const hasServiceInstance = (
  ctx: Pick<TrailContext, 'extensions'>,
  serviceOrId: string | Pick<AnyService, 'id'>
): boolean => Object.hasOwn(ctx.extensions ?? {}, getServiceId(serviceOrId));

/** Create a `ctx.service(...)` accessor bound to a concrete context snapshot. */
export const createServiceLookup = (
  getContext: () => Pick<TrailContext, 'extensions'>
): ServiceLookup =>
  ((serviceOrId: string | Pick<AnyService, 'id'>) => {
    const id = getServiceId(serviceOrId);
    const ctx = getContext();
    if (!hasServiceInstance(ctx, id)) {
      throw new NotFoundError(`Service "${id}" not found in trail context`);
    }
    return getServiceInstance(ctx, id);
  }) as ServiceLookup;

/**
 * Create a typed service definition.
 *
 * The service object is inert until a later execution branch resolves concrete
 * instances into TrailContext extensions.
 */
export const service = <T>(id: string, spec: ServiceSpec<T>): Service<T> =>
  Object.freeze({
    ...spec,
    from(ctx: TrailContext): T {
      const lookup = ctx.service ?? createServiceLookup(() => ctx);
      return lookup(this);
    },
    id,
    kind: 'service' as const,
  });

/** Narrow unknown values to service definitions during topo discovery. */
export const isService = (value: unknown): value is AnyService => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as { kind?: unknown; id?: unknown };
  return v.kind === 'service' && typeof v.id === 'string';
};

/**
 * Return the first duplicate service ID in a collection, if any.
 *
 * This supports later topo registration without each caller duplicating the
 * same scan logic.
 */
export const findDuplicateServiceId = (
  services: readonly Pick<AnyService, 'id'>[]
): string | undefined => {
  const seen = new Set<string>();
  for (const candidate of services) {
    if (seen.has(candidate.id)) {
      return candidate.id;
    }
    seen.add(candidate.id);
  }
  return undefined;
};
