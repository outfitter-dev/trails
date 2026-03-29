/**
 * Build framework-agnostic HTTP route definitions from a Trails topo.
 *
 * Each route definition describes the path, method, input source, and an
 * `execute` function that validates input, composes layers, and runs the
 * implementation -- all without referencing any HTTP framework types.
 */

import { Result, ValidationError, executeTrail } from '@ontrails/core';
import type { Layer, Topo, Trail, TrailContext } from '@ontrails/core';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BuildHttpRoutesOptions {
  readonly basePath?: string | undefined;
  readonly createContext?:
    | (() => TrailContext | Promise<TrailContext>)
    | undefined;
  readonly layers?: readonly Layer[] | undefined;
}

export type HttpMethod = 'GET' | 'POST' | 'DELETE';

/** Input source derived from the HTTP method. */
export type InputSource = 'query' | 'body';

export interface HttpRouteDefinition {
  readonly method: HttpMethod;
  readonly path: string;
  readonly trailId: string;
  readonly inputSource: InputSource;
  readonly trail: Trail<unknown, unknown>;
  /**
   * Validate input, compose layers, and execute the trail implementation.
   *
   * The caller is responsible for parsing raw input from the request and
   * mapping the Result to an HTTP response. This function is framework-agnostic.
   *
   * @param signal - Optional AbortSignal from the HTTP request. When provided,
   *   it takes final precedence over any context factory signal, allowing
   *   client-initiated cancellation to propagate into trail execution.
   */
  readonly execute: (
    input: unknown,
    requestId?: string | undefined,
    signal?: AbortSignal | undefined
  ) => Promise<Result<unknown, Error>>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Derive HTTP method from trail intent. */
const deriveMethod = (trail: Trail<unknown, unknown>): HttpMethod => {
  const intentToMethod: Record<string, HttpMethod> = {
    destroy: 'DELETE',
    read: 'GET',
  };
  return intentToMethod[trail.intent] ?? 'POST';
};

/** Derive HTTP path from trail ID: `entity.show` -> `/entity/show`. */
const derivePath = (basePath: string, trailId: string): string => {
  const segments = trailId.replaceAll('.', '/');
  const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  return `${base}/${segments}`;
};

/** Derive input source from HTTP method. */
const deriveInputSource = (method: HttpMethod): InputSource =>
  method === 'GET' ? 'query' : 'body';

/** Check if a trail should be included (skip internal trails). */
const shouldInclude = (trail: Trail<unknown, unknown>): boolean =>
  trail.metadata?.['internal'] !== true;

// ---------------------------------------------------------------------------
// Execute factory
// ---------------------------------------------------------------------------

/**
 * Create an `execute` function for a single trail.
 *
 * Delegates to the centralized `executeTrail` pipeline in core.
 * The returned function returns a `Result` and never throws.
 */
const createExecute =
  (
    t: Trail<unknown, unknown>,
    layers: readonly Layer[],
    options: BuildHttpRoutesOptions
  ): HttpRouteDefinition['execute'] =>
  (input, requestId, signal) =>
    executeTrail(t, input, {
      createContext: options.createContext,
      ctx: requestId === undefined ? undefined : { requestId },
      layers,
      signal,
    });

// ---------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------

/** Filter topo items to eligible trails. */
const eligibleTrails = (app: Topo): Trail<unknown, unknown>[] =>
  app
    .list()
    .filter(
      (item): item is Trail<unknown, unknown> =>
        item.kind === 'trail' && shouldInclude(item)
    );

/** Build a single route definition from a trail. */
const buildRoute = (
  trail: Trail<unknown, unknown>,
  basePath: string,
  layers: readonly Layer[],
  options: BuildHttpRoutesOptions
): HttpRouteDefinition => {
  const method = deriveMethod(trail);
  const path = derivePath(basePath, trail.id);
  return {
    execute: createExecute(trail, layers, options),
    inputSource: deriveInputSource(method),
    method,
    path,
    trail,
    trailId: trail.id,
  };
};

// ---------------------------------------------------------------------------
// Collision detection
// ---------------------------------------------------------------------------

/** Derive the lookup key for (method, path) collision detection. */
const routeKey = (route: HttpRouteDefinition): `${string} ${string}` =>
  `${route.method} ${route.path}`;

/** Register a route, checking for (path, method) collisions. */
const registerRoute = (
  route: HttpRouteDefinition,
  seenRoutes: Map<string, string>,
  routes: HttpRouteDefinition[]
): Result<void, Error> => {
  const key = routeKey(route);
  const existingId = seenRoutes.get(key);
  if (existingId !== undefined) {
    return Result.err(
      new ValidationError(
        `HTTP route collision: trails "${existingId}" and "${route.trailId}" both derive ${route.method} ${route.path}`
      )
    );
  }
  seenRoutes.set(key, route.trailId);
  routes.push(route);
  return Result.ok();
};

/** Accumulate route definitions, returning early on the first collision. */
const accumulateRoutes = (
  trails: Trail<unknown, unknown>[],
  basePath: string,
  layers: readonly Layer[],
  options: BuildHttpRoutesOptions
): Result<HttpRouteDefinition[], Error> => {
  const routes: HttpRouteDefinition[] = [];
  const seenRoutes = new Map<string, string>();

  for (const trail of trails) {
    const route = buildRoute(trail, basePath, layers, options);
    const registered = registerRoute(route, seenRoutes, routes);
    if (registered.isErr()) {
      return registered;
    }
  }

  return Result.ok(routes);
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build HTTP route definitions from a topo.
 *
 * Each trail becomes an HttpRouteDefinition with:
 * - An HTTP method derived from intent (read -> GET, destroy -> DELETE, default -> POST)
 * - A path derived from the trail ID (dots become slashes)
 * - An input source derived from the method (GET -> query, others -> body)
 * - An `execute` function that validates, layers, and runs the implementation
 *
 * Returns `Result.err(ValidationError)` if two trails derive the same
 * (method, path) pair. Returns `Result.ok(routes)` on success.
 */
export const buildHttpRoutes = (
  app: Topo,
  options: BuildHttpRoutesOptions = {}
): Result<HttpRouteDefinition[], Error> => {
  const basePath = (options.basePath ?? '').replace(/\/+$/, '');
  const layers = options.layers ?? [];
  return accumulateRoutes(eligibleTrails(app), basePath, layers, options);
};
