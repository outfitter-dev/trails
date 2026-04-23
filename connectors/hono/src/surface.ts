/**
 * Hono connector for Trails HTTP routes.
 *
 * Takes framework-agnostic HttpRouteDefinition[] and wires them into a
 * Hono application, handling request parsing, response mapping, and errors.
 *
 * ```ts
 * const graph = topo("myapp", entity);
 * await surface(graph, { port: 3000 });
 * ```
 */

import { isTrailsError, mapTransportError } from '@ontrails/core';
import type {
  Intent,
  Layer,
  ResourceOverrideMap,
  Topo,
  TrailContextInit,
} from '@ontrails/core';
import { Hono } from 'hono';
import type { Context as HonoContext } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { deriveHttpRoutes } from '@ontrails/http';
import type { HttpMethod, HttpRouteDefinition } from '@ontrails/http';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CreateAppOptions {
  readonly basePath?: string | undefined;
  /** Config values for resources that declare a `config` schema, keyed by resource ID. */
  readonly configValues?:
    | Readonly<Record<string, Record<string, unknown>>>
    | undefined;
  readonly createContext?:
    | (() => TrailContextInit | Promise<TrailContextInit>)
    | undefined;
  readonly exclude?: readonly string[] | undefined;
  readonly hostname?: string | undefined;
  readonly include?: readonly string[] | undefined;
  readonly intent?: readonly Intent[] | undefined;
  readonly layers?: readonly Layer[] | undefined;
  readonly name?: string | undefined;
  readonly port?: number | undefined;
  readonly resources?: ResourceOverrideMap | undefined;
  /** Set to `false` to skip topo validation at startup. Defaults to `true`. */
  readonly validate?: boolean | undefined;
}

export interface SurfaceHttpResult {
  readonly close: () => Promise<void>;
  readonly url: string;
}

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

/**
 * Parse query params into a plain object, preserving scalar-vs-array shape.
 *
 * A single `?tag=one` stays a scalar string, while repeated keys like
 * `?tag=one&tag=two` become arrays. Schema validation owns whether that shape
 * is accepted; the connector does not coerce singleton values into arrays.
 */
const parseQueryParams = (c: HonoContext): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  const url = new URL(c.req.url);
  const seenKeys = new Set<string>();

  for (const key of url.searchParams.keys()) {
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    const all = url.searchParams.getAll(key);
    result[key] = all.length > 1 ? all : all[0];
  }

  return result;
};

/** Sentinel indicating a JSON parse failure. */
const JSON_PARSE_ERROR = Symbol('JSON_PARSE_ERROR');

/** Return true when the request has no body content. */
const isEmptyBody = (c: HonoContext): boolean => {
  const contentLength = c.req.header('Content-Length');
  if (contentLength !== undefined) {
    return Number.parseInt(contentLength, 10) === 0;
  }
  // No Content-Length header — treat as empty when Content-Type is also absent.
  return c.req.header('Content-Type') === undefined;
};

/** Read input from request based on input source. */
const readInput = async (
  c: HonoContext,
  inputSource: 'query' | 'body'
): Promise<unknown> => {
  if (inputSource === 'query') {
    return parseQueryParams(c);
  }
  if (isEmptyBody(c)) {
    return {};
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
      status: mapTransportError('http', error) as ContentfulStatusCode,
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
            code: 'ValidationError',
            message: 'Invalid JSON in request body',
          },
        },
        400
      );
    }

    const requestId = c.req.header('X-Request-ID') ?? undefined;
    const { signal: abortSignal } = c.req.raw;

    try {
      const result = await route.execute(rawInput, requestId, abortSignal);
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
// Validation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// createApp
// ---------------------------------------------------------------------------

/**
 * Build HTTP routes from a topo and register them on a Hono app.
 */
export const createApp = (
  graph: Topo,
  options: CreateAppOptions = {}
): Hono => {
  const hono = new Hono();

  registerErrorHandler(hono);

  const routesResult = deriveHttpRoutes(graph, {
    basePath: options.basePath,
    configValues: options.configValues,
    createContext: options.createContext,
    exclude: options.exclude,
    include: options.include,
    intent: options.intent,
    layers: options.layers,
    resources: options.resources,
    validate: options.validate,
  });

  if (routesResult.isErr()) {
    throw routesResult.error;
  }

  registerRoutes(hono, routesResult.value);
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
 */
export const surface = async (
  graph: Topo,
  options: CreateAppOptions = {}
): Promise<SurfaceHttpResult> => {
  // oxlint-disable-next-line require-await -- async ensures createApp() throws become rejected promises, not uncaught exceptions
  const hono = createApp(graph, options);
  return startServer(hono, options);
};
