/**
 * Hono adapter for Trails HTTP routes.
 *
 * Takes framework-agnostic HttpRouteDefinition[] and wires them into a
 * Hono application, handling request parsing, response mapping, and errors.
 *
 * ```ts
 * const app = topo("myapp", entity);
 * await blaze(app, { port: 3000 });
 * ```
 */

import { isTrailsError, statusCodeMap } from '@ontrails/core';
import type { Layer, Topo, TrailContext } from '@ontrails/core';
import { Hono } from 'hono';
import type { Context as HonoContext } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import type { HttpMethod, HttpRouteDefinition } from '../build.js';
import { buildHttpRoutes } from '../build.js';

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
// Request parsing
// ---------------------------------------------------------------------------

/** Parse query params into a plain object, preserving raw strings for Zod. */
const parseQueryParams = (c: HonoContext): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  const url = new URL(c.req.url);

  for (const key of url.searchParams.keys()) {
    // Already collected via getAll
    if (key in result) {
      continue;
    }
    const all = url.searchParams.getAll(key);
    result[key] = all.length > 1 ? all : all[0];
  }

  return result;
};

/** Sentinel indicating a JSON parse failure. */
const JSON_PARSE_ERROR = Symbol('JSON_PARSE_ERROR');

/** Read input from request based on input source. */
const readInput = async (
  c: HonoContext,
  inputSource: 'query' | 'body'
): Promise<unknown> => {
  if (inputSource === 'query') {
    return parseQueryParams(c);
  }
  try {
    return await c.req.json();
  } catch {
    return JSON_PARSE_ERROR;
  }
};

// ---------------------------------------------------------------------------
// Response mapping
// ---------------------------------------------------------------------------

/** Map a TrailsError or generic Error to an HTTP error response. */
const mapErrorResponse = (
  error: Error
): { body: Record<string, unknown>; status: ContentfulStatusCode } => {
  if (isTrailsError(error)) {
    return {
      body: {
        error: {
          category: error.category,
          code: error.name,
          message: error.message,
        },
      },
      status: statusCodeMap[error.category] as ContentfulStatusCode,
    };
  }
  return {
    body: {
      error: {
        category: 'internal',
        code: 'InternalError',
        message: error.message,
      },
    },
    status: 500,
  };
};

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

/** Map a Result to an HTTP response via Hono context. */
const mapResultToResponse = (
  result: { isOk(): boolean; value?: unknown; error?: Error },
  c: HonoContext
): Response => {
  if (result.isOk()) {
    return c.json({ data: result.value }, 200);
  }
  const { body, status } = mapErrorResponse(
    result.error ?? new Error('Unknown error')
  );
  return c.json(body, status);
};

/** Convert a caught unknown value to an error response. */
const handleCaughtError = (error: unknown, c: HonoContext): Response => {
  const err = error instanceof Error ? error : new Error(String(error));
  const { body, status } = mapErrorResponse(err);
  return c.json(body, status);
};

/** Create a Hono handler from a route definition. */
const createHonoHandler =
  (route: HttpRouteDefinition) =>
  async (c: HonoContext): Promise<Response> => {
    const rawInput = await readInput(c, route.inputSource);

    if (rawInput === JSON_PARSE_ERROR) {
      return c.json(
        {
          error: {
            category: 'validation',
            code: 'validation',
            message: 'Invalid JSON in request body',
          },
        },
        400
      );
    }

    const requestId = c.req.header('X-Request-ID') ?? undefined;

    try {
      const result = await route.execute(rawInput, requestId);
      return mapResultToResponse(result, c);
    } catch (error: unknown) {
      return handleCaughtError(error, c);
    }
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
  POST: (hono, path, handler) => {
    hono.post(path, handler);
  },
};

const registerRoutes = (hono: Hono, routes: HttpRouteDefinition[]): void => {
  for (const route of routes) {
    const handler = createHonoHandler(route);
    routeRegistrars[route.method](hono, route.path, handler);
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

  const routes = buildHttpRoutes(app, {
    basePath: options.basePath,
    createContext: options.createContext,
    layers: options.layers,
  });
  registerRoutes(hono, routes);

  if (options.serve !== false) {
    Bun.serve({
      fetch: hono.fetch,
      hostname: options.hostname ?? '0.0.0.0',
      port: options.port ?? 3000,
    });
  }

  return hono;
};
