/**
 * Bun.serve adapter for Trails HTTP routes.
 *
 * Takes framework-agnostic `HttpRouteDefinition[]` and projects them onto
 * `Bun.serve`'s native routes API with no Hono dependency.
 *
 * ```ts
 * const graph = topo("myapp", entity);
 * await surface(graph, { port: 3000 });
 * ```
 */

import {
  isTrailsError,
  projectSurfaceError,
  ValidationError,
} from '@ontrails/core';
import type {
  BaseSurfaceOptions,
  Layer,
  ResourceOverrideMap,
  Topo,
  TrailContextInit,
} from '@ontrails/core';
import { deriveHttpRoutes } from '@ontrails/http';
import type { HttpMethod, HttpRouteDefinition } from '@ontrails/http';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

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
}

interface RuntimeOptions {
  readonly maxJsonBodyBytes: number;
}

const DEFAULT_MAX_JSON_BODY_BYTES = 1024 * 1024;

export interface SurfaceHttpResult {
  readonly close: () => Promise<void>;
  readonly url: string;
}

type RouteHandler = (req: Request) => Response | Promise<Response>;

/**
 * Bun.serve `routes` shape produced by `createApp`. Indexed by static path
 * (paths are derived from trail IDs and contain no dynamic segments), with
 * per-method handlers that adapt the route's input source to a Web Standard
 * `Request` and map the trail's `Result` to a `Response`.
 */
export type BunRouteRecord = Record<
  string,
  Partial<Record<HttpMethod, RouteHandler>>
>;

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

/**
 * Parse query params into a plain object, preserving scalar-vs-array shape.
 *
 * A single `?tag=one` stays a scalar string, while repeated keys like
 * `?tag=one&tag=two` become arrays. Schema validation owns whether that shape
 * is accepted; the adapter does not coerce singleton values into arrays.
 */
const parseQueryParams = (req: Request): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  const url = new URL(req.url);
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

/** Sentinel indicating a JSON body rejected before parsing. */
const JSON_BODY_TOO_LARGE = Symbol('JSON_BODY_TOO_LARGE');

/** Sentinel indicating malformed body metadata. */
const JSON_BODY_INVALID_CONTENT_LENGTH = Symbol(
  'JSON_BODY_INVALID_CONTENT_LENGTH'
);

interface JsonObject {
  readonly [key: string]: JsonValue;
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | JsonObject;

type JsonBodyReadResult =
  | JsonValue
  | typeof JSON_BODY_INVALID_CONTENT_LENGTH
  | typeof JSON_PARSE_ERROR
  | typeof JSON_BODY_TOO_LARGE;

type InputReadResult = Record<string, unknown> | JsonBodyReadResult;

const CONTENT_LENGTH_DECIMAL_PATTERN = /^\d+$/;

type ParsedContentLength =
  | number
  | typeof JSON_BODY_INVALID_CONTENT_LENGTH
  | undefined;

const parseContentLength = (
  contentLength: string | null | undefined
): ParsedContentLength => {
  if (contentLength === null || contentLength === undefined) {
    return undefined;
  }
  if (!CONTENT_LENGTH_DECIMAL_PATTERN.test(contentLength)) {
    return JSON_BODY_INVALID_CONTENT_LENGTH;
  }
  const size = Number(contentLength);
  return Number.isSafeInteger(size) ? size : Number.MAX_SAFE_INTEGER;
};

/** Return true when the request has no body content. */
const isEmptyBody = (req: Request): boolean => {
  const contentLength = parseContentLength(req.headers.get('Content-Length'));
  if (contentLength === JSON_BODY_INVALID_CONTENT_LENGTH) {
    return false;
  }
  if (contentLength !== undefined) {
    return contentLength === 0;
  }
  // No Content-Length header — treat as empty when Content-Type is also absent.
  return req.headers.get('Content-Type') === null;
};

const resolveMaxJsonBodyBytes = (value: number | undefined): number => {
  const maxJsonBodyBytes = value ?? DEFAULT_MAX_JSON_BODY_BYTES;

  if (!Number.isFinite(maxJsonBodyBytes) || maxJsonBodyBytes < 1) {
    throw new ValidationError(
      'maxJsonBodyBytes must be a positive finite number'
    );
  }

  return maxJsonBodyBytes;
};

const hasOversizedContentLength = (
  req: Request,
  maxJsonBodyBytes: number
): boolean => {
  const contentLength = req.headers.get('Content-Length');
  const size = parseContentLength(contentLength);
  if (size === JSON_BODY_INVALID_CONTENT_LENGTH || size === undefined) {
    return false;
  }
  return size > maxJsonBodyBytes;
};

/**
 * Stream the request body into a UTF-8 string, aborting mid-stream when the
 * accumulated byte count exceeds `maxJsonBodyBytes`.
 *
 * Single-pass read with no `req.clone()` in the hot path. Cloning before the
 * cap check would let an attacker double per-connection memory by sending
 * chunked near-cap payloads; this function never clones.
 */
const readBodyText = async (
  req: Request,
  maxJsonBodyBytes: number
): Promise<string | typeof JSON_BODY_TOO_LARGE> => {
  const { body } = req;
  if (body === null) {
    return '';
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value === undefined) {
        continue;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxJsonBodyBytes) {
        await reader.cancel();
        return JSON_BODY_TOO_LARGE;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
};

const readJsonBody = async (
  req: Request,
  maxJsonBodyBytes: number
): Promise<JsonBodyReadResult> => {
  if (
    parseContentLength(req.headers.get('Content-Length')) ===
    JSON_BODY_INVALID_CONTENT_LENGTH
  ) {
    return JSON_BODY_INVALID_CONTENT_LENGTH;
  }

  if (hasOversizedContentLength(req, maxJsonBodyBytes)) {
    return JSON_BODY_TOO_LARGE;
  }

  const text = await readBodyText(req, maxJsonBodyBytes);
  if (text === JSON_BODY_TOO_LARGE) {
    return JSON_BODY_TOO_LARGE;
  }

  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return JSON_PARSE_ERROR;
  }
};

const readInput = async (
  req: Request,
  inputSource: 'query' | 'body',
  options: RuntimeOptions
): Promise<InputReadResult> => {
  if (inputSource === 'query') {
    return parseQueryParams(req);
  }
  if (isEmptyBody(req)) {
    return {};
  }
  return await readJsonBody(req, options.maxJsonBodyBytes);
};

// ---------------------------------------------------------------------------
// Response mapping
// ---------------------------------------------------------------------------

const jsonResponse = (body: unknown, status: number): Response =>
  Response.json(body, { status });

const mapErrorResponse = (
  error: Error
): { body: Record<string, unknown>; status: number } => {
  if (isTrailsError(error)) {
    const projection = projectSurfaceError('http', error);
    return {
      body: {
        error: {
          category: projection.category,
          code: projection.name,
          message: projection.message,
        },
      },
      status: projection.code,
    };
  }
  return {
    body: {
      error: {
        category: 'internal',
        code: 'InternalError',
        message: 'Internal server error',
      },
    },
    status: 500,
  };
};

const LOG_UNSAFE_LABEL_CHARACTERS = /[^\w:.-]/g;
const MAX_DIAGNOSTIC_LABEL_VALUE_LENGTH = 128;

const sanitizeDiagnosticLabelValue = (value: string): string =>
  value
    .replace(LOG_UNSAFE_LABEL_CHARACTERS, '_')
    .slice(0, MAX_DIAGNOSTIC_LABEL_VALUE_LENGTH);

const reportInternalDiagnostics = (error: Error, req?: Request): void => {
  if (isTrailsError(error)) {
    return;
  }

  const requestId = req?.headers.get('X-Request-ID') ?? undefined;
  const safeRequestId =
    requestId === null || requestId === undefined
      ? undefined
      : sanitizeDiagnosticLabelValue(requestId);
  const label =
    safeRequestId === undefined
      ? '[ontrails:bun] Internal error'
      : `[ontrails:bun] Internal error (${safeRequestId})`;
  console.error(label, error);
};

const mapResultToResponse = (
  result: { isOk(): boolean; value?: unknown; error?: Error },
  req: Request
): Response => {
  if (result.isOk()) {
    return jsonResponse({ data: result.value }, 200);
  }
  const error = result.error ?? new Error('Unknown error');
  reportInternalDiagnostics(error, req);
  const { body, status } = mapErrorResponse(error);
  return jsonResponse(body, status);
};

const handleCaughtError = (error: unknown, req: Request): Response => {
  const err = error instanceof Error ? error : new Error(String(error));
  reportInternalDiagnostics(err, req);
  const { body, status } = mapErrorResponse(err);
  return jsonResponse(body, status);
};

const invalidJsonResponse = (): Response =>
  jsonResponse(
    {
      error: {
        category: 'validation',
        code: 'ValidationError',
        message: 'Invalid JSON in request body',
      },
    },
    400
  );

const invalidContentLengthResponse = (): Response =>
  jsonResponse(
    {
      error: {
        category: 'validation',
        code: 'ValidationError',
        message: 'Invalid Content-Length header',
      },
    },
    400
  );

const oversizedJsonBodyResponse = (options: RuntimeOptions): Response =>
  jsonResponse(
    {
      error: {
        category: 'validation',
        code: 'ValidationError',
        message: `JSON request body exceeds ${options.maxJsonBodyBytes} bytes`,
      },
    },
    413
  );

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

const createRouteHandler =
  (route: HttpRouteDefinition, options: RuntimeOptions): RouteHandler =>
  async (req: Request): Promise<Response> => {
    if (route.inputSource === 'webhook') {
      // Defensive: createApp filters webhook routes at build time; this branch
      // only fires if a caller wires a route definition directly into a Bun.serve
      // routes object without going through createApp.
      return jsonResponse(
        {
          error: {
            category: 'internal',
            code: 'WebhookNotSupported',
            message:
              'Webhook input source is not supported by @ontrails/bun. Use @ontrails/hono until webhook support lands.',
          },
        },
        501
      );
    }

    const rawInput = await readInput(req, route.inputSource, options);

    if (rawInput === JSON_PARSE_ERROR) {
      return invalidJsonResponse();
    }

    if (rawInput === JSON_BODY_INVALID_CONTENT_LENGTH) {
      return invalidContentLengthResponse();
    }

    if (rawInput === JSON_BODY_TOO_LARGE) {
      return oversizedJsonBodyResponse(options);
    }

    const requestId = req.headers.get('X-Request-ID') ?? undefined;

    try {
      const result = await route.execute(rawInput, requestId, req.signal);
      return mapResultToResponse(result, req);
    } catch (error: unknown) {
      return handleCaughtError(error, req);
    }
  };

const buildRouteRecord = (
  routes: HttpRouteDefinition[],
  options: RuntimeOptions
): BunRouteRecord => {
  const record: BunRouteRecord = {};
  for (const route of routes) {
    const handler = createRouteHandler(route, options);
    const existing = record[route.path] ?? {};
    existing[route.method] = handler;
    record[route.path] = existing;
  }
  return record;
};

const findWebhookRoutes = (routes: HttpRouteDefinition[]): string[] =>
  routes
    .filter((route) => route.inputSource === 'webhook')
    .map((route) => route.trailId);

// ---------------------------------------------------------------------------
// createApp
// ---------------------------------------------------------------------------

/**
 * Build HTTP routes from a topo and project them onto a `Bun.serve` route
 * record.
 *
 * v0 rejects webhook trails at build time with a `ValidationError` rather than
 * silently 501-ing at request time. This is a deliberate departure from the
 * "skeleton with TODOs" pattern: a loud build-time error is more contract-first
 * than a runtime failure that ships to production unnoticed.
 *
 * @remarks This is a host materialization boundary. Derivation failures are
 * thrown for HTTP bootstrap code after `deriveHttpRoutes` has already
 * represented the framework error as a Result.
 */
export const createApp = (
  graph: Topo,
  options: CreateAppOptions = {}
): {
  routes: BunRouteRecord;
  fetch: RouteHandler;
  onError: (error: Error) => Response;
} => {
  const runtimeOptions: RuntimeOptions = {
    maxJsonBodyBytes: resolveMaxJsonBodyBytes(options.maxJsonBodyBytes),
  };

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

  const routes = routesResult.value;
  const webhookTrails = findWebhookRoutes(routes);
  if (webhookTrails.length > 0) {
    throw new ValidationError(
      `Webhook routes are not supported by @ontrails/bun v0. Trails with inputSource='webhook': ${webhookTrails.join(', ')}. Use @ontrails/hono until webhook support lands.`
    );
  }

  const routeRecord = buildRouteRecord(routes, runtimeOptions);

  const fetchFallback: RouteHandler = (_req: Request): Response =>
    jsonResponse(
      {
        error: {
          category: 'not_found',
          code: 'RouteNotFound',
          message: 'Route not found',
        },
      },
      404
    );

  const onError = (error: Error): Response => {
    reportInternalDiagnostics(error);
    const { body, status } = mapErrorResponse(error);
    return jsonResponse(body, status);
  };

  return { fetch: fetchFallback, onError, routes: routeRecord };
};

// ---------------------------------------------------------------------------
// surface
// ---------------------------------------------------------------------------

/**
 * Build a route record from a topo and start serving it with `Bun.serve`.
 *
 * @remarks Always starts a Bun server. Use `createApp(graph)` for an unserved
 * route record that you can wire into your own `Bun.serve` invocation.
 */
export const surface = async (
  graph: Topo,
  options: CreateAppOptions = {}
): Promise<SurfaceHttpResult> => {
  // oxlint-disable-next-line require-await -- async ensures createApp() throws become rejected promises, not uncaught exceptions
  const handler = createApp(graph, options);

  const server = Bun.serve({
    error: handler.onError,
    fetch: handler.fetch,
    hostname: options.hostname ?? '0.0.0.0',
    port: options.port ?? 3000,
    routes: handler.routes,
  });

  return {
    close: async () => {
      await server.stop(true);
    },
    url: String(server.url),
  };
};
