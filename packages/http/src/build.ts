/**
 * Build framework-agnostic HTTP route definitions from a Trails topo.
 *
 * Each route definition describes the path, method, input source, and an
 * `execute` function that validates input, composes layers, and runs the
 * implementation -- all without referencing any HTTP framework types.
 */

import {
  Result,
  TRAILHEAD_KEY,
  ValidationError,
  executeTrail,
  filterSurfaceTrails,
  validateEstablishedTopo,
} from '@ontrails/core';
import type {
  Intent,
  Layer,
  ResourceOverrideMap,
  Topo,
  Trail,
  TrailContextInit,
} from '@ontrails/core';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DeriveHttpRoutesOptions {
  readonly basePath?: string | undefined;
  /** Config values for resources that declare a `config` schema, keyed by resource ID. */
  readonly configValues?:
    | Readonly<Record<string, Record<string, unknown>>>
    | undefined;
  readonly createContext?:
    | (() => TrailContextInit | Promise<TrailContextInit>)
    | undefined;
  readonly exclude?: readonly string[] | undefined;
  readonly include?: readonly string[] | undefined;
  readonly intent?: readonly Intent[] | undefined;
  readonly layers?: readonly Layer[] | undefined;
  readonly resources?: ResourceOverrideMap | undefined;
  /** Set to `false` to skip topo validation while building routes. */
  readonly validate?: boolean | undefined;
}

export type HttpMethod = 'GET' | 'POST' | 'DELETE';

/** Input source derived from the HTTP method. */
export type InputSource = 'query' | 'body';

export interface HttpRouteDefinition {
  readonly method: HttpMethod;
  readonly path: string;
  readonly trailId: string;
  readonly inputSource: InputSource;
  readonly trail: Trail<unknown, unknown, unknown>;
  /**
   * Validate input, compose layers, and execute the trail implementation.
   *
   * The caller is responsible for parsing raw input from the request and
   * mapping the Result to an HTTP response. This function is framework-agnostic.
   *
   * @param abortSignal - Optional AbortSignal from the HTTP request. When provided,
   *   it takes final precedence over any context factory signal, allowing
   *   client-initiated cancellation to propagate into trail execution.
   */
  readonly execute: (
    input: unknown,
    requestId?: string | undefined,
    abortSignal?: AbortSignal | undefined
  ) => Promise<Result<unknown, Error>>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Explicit intent → HTTP method mapping. */
const intentToMethod: Record<string, HttpMethod> = {
  destroy: 'DELETE',
  read: 'GET',
  write: 'POST',
};

/** Derive HTTP method from trail intent. */
const deriveMethod = (trail: Trail<unknown, unknown, unknown>): HttpMethod =>
  intentToMethod[trail.intent] ?? 'POST';

/** Derive HTTP path from trail ID: `entity.show` -> `/entity/show`. */
const derivePath = (basePath: string, trailId: string): string => {
  const segments = trailId.replaceAll('.', '/');
  const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  return `${base}/${segments}`;
};

/** Derive input source from HTTP method. */
const deriveInputSource = (method: HttpMethod): InputSource =>
  method === 'GET' ? 'query' : 'body';

/** Build per-request context overrides with the HTTP trailhead marker. */
const withHttpTrailhead = (
  requestId: string | undefined
): Partial<TrailContextInit> => ({
  ...(requestId === undefined ? {} : { requestId }),
  extensions: {
    [TRAILHEAD_KEY]: 'http' as const,
  },
});

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
    graph: Topo,
    t: Trail<unknown, unknown, unknown>,
    layers: readonly Layer[],
    options: DeriveHttpRoutesOptions
  ): HttpRouteDefinition['execute'] =>
  (input, requestId, abortSignal) =>
    executeTrail(t, input, {
      abortSignal,
      configValues: options.configValues,
      createContext: options.createContext,
      ctx: withHttpTrailhead(requestId),
      layers,
      resources: options.resources,
      topo: graph,
    });

// ---------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------

/** Filter topo items to eligible trails. */
const eligibleTrails = (
  graph: Topo,
  options: DeriveHttpRoutesOptions
): Trail<unknown, unknown, unknown>[] =>
  filterSurfaceTrails(graph.list(), {
    exclude: options.exclude,
    include: options.include,
    intent: options.intent,
  });

/** Build a single route definition from a trail. */
const buildRoute = (
  graph: Topo,
  trail: Trail<unknown, unknown, unknown>,
  basePath: string,
  layers: readonly Layer[],
  options: DeriveHttpRoutesOptions
): HttpRouteDefinition => {
  const method = deriveMethod(trail);
  const path = derivePath(basePath, trail.id);
  return {
    execute: createExecute(graph, trail, layers, options),
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
  graph: Topo,
  trails: Trail<unknown, unknown, unknown>[],
  basePath: string,
  layers: readonly Layer[],
  options: DeriveHttpRoutesOptions
): Result<HttpRouteDefinition[], Error> => {
  const routes: HttpRouteDefinition[] = [];
  const seenRoutes = new Map<string, string>();

  for (const trail of trails) {
    const route = buildRoute(graph, trail, basePath, layers, options);
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
 * - An HTTP method derived from intent (read -> GET, write -> POST, destroy -> DELETE)
 * - A path derived from the trail ID (dots become slashes)
 * - An input source derived from the method (GET -> query, others -> body)
 * - An `execute` function that validates, layers, and runs the implementation
 *
 * Returns `Result.err(ValidationError)` if two trails derive the same
 * (method, path) pair. Returns `Result.ok(routes)` on success.
 */
export const deriveHttpRoutes = (
  graph: Topo,
  options: DeriveHttpRoutesOptions = {}
): Result<HttpRouteDefinition[], Error> => {
  if (options.validate !== false) {
    const validated = validateEstablishedTopo(graph);
    if (validated.isErr()) {
      return Result.err(validated.error);
    }
  }

  const basePath = (options.basePath ?? '').replace(/\/+$/, '');
  const layers = options.layers ?? [];
  return accumulateRoutes(
    graph,
    eligibleTrails(graph, options),
    basePath,
    layers,
    options
  );
};
