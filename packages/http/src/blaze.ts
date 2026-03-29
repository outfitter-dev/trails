/**
 * blaze() -- the one-liner HTTP server launcher.
 *
 * ```ts
 * const app = topo("myapp", entity);
 * await blaze(app, { port: 3000 });
 * ```
 */

import type { Layer, Topo, TrailContext } from '@ontrails/core';
import { Hono } from 'hono';

import type { HttpMethod, HttpRouteDefinition } from './build.js';
import { buildHttpRoutes } from './build.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface BlazeHttpOptions {
  readonly basePath?: string | undefined;
  readonly createContext?:
    | (() => TrailContext | Promise<TrailContext>)
    | undefined;
  readonly hostname?: string | undefined;
  readonly layers?: readonly Layer[] | undefined;
  readonly name?: string | undefined;
  readonly port?: number | undefined;
  /** Set false to return the Hono app without starting a server. */
  readonly serve?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Internal: register routes on Hono app
// ---------------------------------------------------------------------------

/** Route registration keyed by HTTP method. */
const routeRegistrars: Record<
  HttpMethod,
  (hono: Hono, route: HttpRouteDefinition) => void
> = {
  DELETE: (hono, route) => {
    hono.delete(route.path, route.handler);
  },
  GET: (hono, route) => {
    hono.get(route.path, route.handler);
  },
  POST: (hono, route) => {
    hono.post(route.path, route.handler);
  },
};

const registerRoutes = (
  hono: Hono,
  app: Topo,
  options: BlazeHttpOptions
): void => {
  const routes = buildHttpRoutes(app, {
    basePath: options.basePath,
    createContext: options.createContext,
    layers: options.layers,
  });

  for (const route of routes) {
    routeRegistrars[route.method](hono, route);
  }
};

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------

const registerErrorHandler = (hono: Hono): void => {
  // oxlint-disable-next-line prefer-await-to-callbacks -- Hono's onError API requires a callback
  hono.onError((err, c) =>
    c.json(
      {
        error: {
          category: 'internal',
          code: 'InternalError',
          message: err.message,
        },
      },
      500
    )
  );
};

// ---------------------------------------------------------------------------
// blaze
// ---------------------------------------------------------------------------

/**
 * Build HTTP routes from a topo, create a Hono app, and optionally start serving.
 */
// oxlint-disable-next-line require-await -- async for consistency with other blaze() surfaces
export const blaze = async (
  app: Topo,
  options: BlazeHttpOptions = {}
): Promise<Hono> => {
  const hono = new Hono();

  registerErrorHandler(hono);
  registerRoutes(hono, app, options);

  if (options.serve !== false) {
    Bun.serve({
      fetch: hono.fetch,
      hostname: options.hostname ?? '0.0.0.0',
      port: options.port ?? 3000,
    });
  }

  return hono;
};
