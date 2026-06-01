/**
 * Hono adapter for Trails HTTP routes.
 *
 * Takes framework-agnostic HttpRouteDefinition[] and wires them into a
 * Hono application, handling request parsing, response mapping, and errors.
 *
 * ```ts
 * const graph = topo("myapp", entity);
 * await surface(graph, { port: 3000 });
 * ```
 */

import type {
  BaseSurfaceOptions,
  Layer,
  ResourceOverrideMap,
  Topo,
  TrailContextInit,
} from '@ontrails/core';
import { Hono } from 'hono';
import type { Context as HonoContext } from 'hono';
import { createRouteHandler, deriveHttpRoutes } from '@ontrails/http';
import type {
  HttpMethod,
  HttpRouteDefinition,
  ResolveHttpPermit,
} from '@ontrails/http';
import { handleCaughtHonoError } from './caught-error.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Options for building a Trails HTTP app on Hono.
 */
export interface CreateAppOptions extends BaseSurfaceOptions {
  readonly basePath?: string | undefined;
  readonly createContext?:
    | (() => TrailContextInit | Promise<TrailContextInit>)
    | undefined;
  readonly hostname?: string | undefined;
  readonly layers?: readonly Layer[] | undefined;
  /** Maximum JSON request body size in bytes. Defaults to 1 MiB. */
  readonly maxJsonBodyBytes?: number | undefined;
  readonly name?: string | undefined;
  readonly port?: number | undefined;
  readonly resources?: ResourceOverrideMap | undefined;
  readonly resolvePermit?: ResolveHttpPermit | undefined;
}

interface RuntimeOptions {
  readonly maxJsonBodyBytes?: number | undefined;
}

/**
 * Runtime handle returned by the Hono surface.
 */
export interface SurfaceHttpResult {
  readonly close: () => Promise<void>;
  readonly url: string;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

const materializeHonoRequest = async (c: HonoContext): Promise<Request> => {
  if (!c.req.raw.bodyUsed) {
    return c.req.raw;
  }

  const body = await c.req.text();
  return new Request(c.req.raw.url, {
    body,
    headers: c.req.raw.headers,
    method: c.req.raw.method,
    signal: c.req.raw.signal,
  });
};

/** Create a Hono handler from a route definition. */
const createHonoHandler = (
  route: HttpRouteDefinition,
  options: RuntimeOptions
): ((c: HonoContext) => Promise<Response>) => {
  const handler = createRouteHandler(route, {
    maxJsonBodyBytes: options.maxJsonBodyBytes,
  });
  return async (c) => handler(await materializeHonoRequest(c));
};

/** Route registration keyed by HTTP method. */
const routeRegistrars: Record<
  HttpMethod,
  (
    hono: Hono,
    path: string,
    handler: (c: HonoContext) => Promise<Response>
  ) => void
> = {
  DELETE: (hono, path, handler) => {
    hono.delete(path, handler);
  },
  GET: (hono, path, handler) => {
    hono.get(path, handler);
  },
  PATCH: (hono, path, handler) => {
    hono.patch(path, handler);
  },
  POST: (hono, path, handler) => {
    hono.post(path, handler);
  },
  PUT: (hono, path, handler) => {
    hono.put(path, handler);
  },
};

const registerRoutes = (
  hono: Hono,
  routes: HttpRouteDefinition[],
  options: RuntimeOptions
): void => {
  for (const route of routes) {
    const handler = createHonoHandler(route, options);
    routeRegistrars[route.method](hono, route.path, handler);
  }
};

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------

const handleCaughtError = async (
  error: unknown,
  c: HonoContext
): Promise<Response> => handleCaughtHonoError(error, c.req.raw);

const registerErrorHandler = (hono: Hono): void => {
  // oxlint-disable-next-line prefer-await-to-callbacks -- Hono's onError API requires a callback
  hono.onError((err, c) => handleCaughtError(err, c));
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// createApp
// ---------------------------------------------------------------------------

/**
 * Build HTTP routes from a topo and register them on a Hono app.
 *
 * @remarks This is a host materialization boundary. Derivation failures are
 * thrown for HTTP bootstrap code after `deriveHttpRoutes` has already
 * represented the framework error as a Result.
 *
 * @example
 * ```ts
 * import { createApp } from '@ontrails/hono';
 *
 * const app = createApp(graph, { basePath: '/api' });
 * Bun.serve({ fetch: app.fetch, port: 3000 });
 * ```
 */
export const createApp = (
  graph: Topo,
  options: CreateAppOptions = {}
): Hono => {
  const hono = new Hono();
  const runtimeOptions = {
    maxJsonBodyBytes: options.maxJsonBodyBytes,
  };

  registerErrorHandler(hono);

  const routesResult = deriveHttpRoutes(graph, {
    basePath: options.basePath,
    configValues: options.configValues,
    createContext: options.createContext,
    exclude: options.exclude,
    include: options.include,
    intent: options.intent,
    layers: options.layers,
    resolvePermit: options.resolvePermit,
    resources: options.resources,
    validate: options.validate,
  });

  if (routesResult.isErr()) {
    throw routesResult.error;
  }

  registerRoutes(hono, routesResult.value, runtimeOptions);
  return hono;
};

const startServer = (
  hono: Hono,
  options: CreateAppOptions
): SurfaceHttpResult => {
  const server = Bun.serve({
    fetch: hono.fetch,
    hostname: options.hostname ?? '0.0.0.0',
    port: options.port ?? 3000,
  });

  return {
    close: async () => {
      await server.stop(true);
    },
    url: String(server.url),
  };
};

// ---------------------------------------------------------------------------
// surface
// ---------------------------------------------------------------------------

/**
 * Build a Hono app from a topo and start serving it with Bun.
 *
 * @remarks Always starts a Bun server. Use `createApp(graph)` for an
 * unserved Hono app that you can wire into your own server.
 *
 * @example
 * ```ts
 * import { surface } from '@ontrails/hono';
 *
 * const server = await surface(graph, { port: 3000 });
 * console.log(server.url);
 * ```
 */
export const surface = async (
  graph: Topo,
  options: CreateAppOptions = {}
): Promise<SurfaceHttpResult> => {
  // oxlint-disable-next-line require-await -- async ensures createApp() throws become rejected promises, not uncaught exceptions
  const hono = createApp(graph, options);
  return startServer(hono, options);
};
