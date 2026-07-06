import {
  CancelledError,
  isBlobRef,
  isTrailsError,
  matchWebhookPath,
  NotFoundError,
  parseWebhookPathParams,
  projectErrorDiagnostics,
  projectPublicSurfaceError,
  ValidationError,
} from '@ontrails/core';
import type { BlobRef, Topo } from '@ontrails/core';

import { isBlobOutputSchema } from './blob-output.js';
import { deriveHttpRoutes } from './build.js';
import type { DeriveHttpRoutesOptions, HttpRouteDefinition } from './build.js';

export interface CreateRouteHandlerOptions {
  /** Maximum JSON request body size in bytes. Defaults to 1 MiB. */
  readonly maxJsonBodyBytes?: number | undefined;
}

export interface CreateFetchHandlerOptions
  extends DeriveHttpRoutesOptions, CreateRouteHandlerOptions {}

interface RuntimeOptions {
  readonly maxJsonBodyBytes: number;
}

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
  | typeof JSON_BODY_TOO_LARGE
  | typeof JSON_PARSE_ERROR;
type JsonBodyTextReadResult = string | typeof JSON_BODY_TOO_LARGE;
type InputReadResult = Record<string, unknown> | JsonBodyReadResult;
type ParsedContentLength =
  | number
  | typeof JSON_BODY_INVALID_CONTENT_LENGTH
  | undefined;

const DEFAULT_MAX_JSON_BODY_BYTES = 1024 * 1024;
const CONTENT_LENGTH_DECIMAL_PATTERN = /^\d+$/;

const JSON_PARSE_ERROR = Symbol('JSON_PARSE_ERROR');
const JSON_BODY_TOO_LARGE = Symbol('JSON_BODY_TOO_LARGE');
const JSON_BODY_INVALID_CONTENT_LENGTH = Symbol(
  'JSON_BODY_INVALID_CONTENT_LENGTH'
);

const LOG_UNSAFE_LABEL_CHARACTERS = /[^\w:.-]/g;
const MAX_DIAGNOSTIC_LABEL_VALUE_LENGTH = 128;

const routeKey = (method: string, path: string): `${string} ${string}` =>
  `${method.toUpperCase()} ${path}`;

const parseQueryParams = (request: Request): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  const url = new URL(request.url);
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

const isEmptyBody = (request: Request): boolean => {
  const contentLength = parseContentLength(
    request.headers.get('Content-Length')
  );
  if (contentLength === JSON_BODY_INVALID_CONTENT_LENGTH) {
    return false;
  }
  if (contentLength !== undefined) {
    return contentLength === 0;
  }
  return request.headers.get('Content-Type') === null;
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
  request: Request,
  maxJsonBodyBytes: number
): boolean => {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength === null) {
    return false;
  }
  const size = parseContentLength(contentLength);
  if (size === JSON_BODY_INVALID_CONTENT_LENGTH) {
    return false;
  }
  return size !== undefined && size > maxJsonBodyBytes;
};

const measureBodyTextBytes = (text: string): number => new Blob([text]).size;

const validateBodyText = (
  text: string,
  maxJsonBodyBytes: number
): JsonBodyTextReadResult =>
  measureBodyTextBytes(text) > maxJsonBodyBytes ? JSON_BODY_TOO_LARGE : text;

const cancelBodyReader = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason?: unknown
): Promise<void> => {
  try {
    await reader.cancel(reason);
  } catch {
    // The request is already being cancelled; preserve the surface-level
    // cancelled response instead of replacing it with a reader cleanup error.
  }
};

const assertRequestNotAborted = async (
  request: Request,
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<void> => {
  if (!request.signal.aborted) {
    return;
  }
  await cancelBodyReader(reader, request.signal.reason);
  throw new CancelledError('Request aborted');
};

const readBodyText = async (
  request: Request,
  maxJsonBodyBytes: number
): Promise<JsonBodyTextReadResult> => {
  const { body } = request;
  if (body === null) {
    return '';
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      await assertRequestNotAborted(request, reader);
      let read: Awaited<ReturnType<typeof reader.read>>;
      try {
        read = await reader.read();
      } catch (error) {
        await assertRequestNotAborted(request, reader);
        throw error;
      }
      await assertRequestNotAborted(request, reader);
      const { done, value } = read;
      if (done) {
        break;
      }
      if (value === undefined) {
        continue;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxJsonBodyBytes) {
        await cancelBodyReader(reader);
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
  request: Request,
  maxJsonBodyBytes: number
): Promise<JsonBodyReadResult> => {
  if (
    parseContentLength(request.headers.get('Content-Length')) ===
    JSON_BODY_INVALID_CONTENT_LENGTH
  ) {
    return JSON_BODY_INVALID_CONTENT_LENGTH;
  }

  if (hasOversizedContentLength(request, maxJsonBodyBytes)) {
    return JSON_BODY_TOO_LARGE;
  }

  const text = await readBodyText(request, maxJsonBodyBytes);
  if (text === JSON_BODY_TOO_LARGE) {
    return JSON_BODY_TOO_LARGE;
  }

  const validated = validateBodyText(text, maxJsonBodyBytes);
  if (validated === JSON_BODY_TOO_LARGE) {
    return JSON_BODY_TOO_LARGE;
  }

  try {
    return JSON.parse(validated) as JsonValue;
  } catch {
    return JSON_PARSE_ERROR;
  }
};

const parseJsonBodyText = (text: string): JsonBodyReadResult => {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return JSON_PARSE_ERROR;
  }
};

const parseWebhookBodyText = (
  request: Request,
  text: string
): JsonBodyReadResult =>
  isEmptyBody(request) || text.length === 0 ? {} : parseJsonBodyText(text);

const readWebhookBodyText = async (
  request: Request,
  maxJsonBodyBytes: number
): Promise<
  string | typeof JSON_BODY_INVALID_CONTENT_LENGTH | typeof JSON_BODY_TOO_LARGE
> => {
  if (
    parseContentLength(request.headers.get('Content-Length')) ===
    JSON_BODY_INVALID_CONTENT_LENGTH
  ) {
    return JSON_BODY_INVALID_CONTENT_LENGTH;
  }
  if (hasOversizedContentLength(request, maxJsonBodyBytes)) {
    return JSON_BODY_TOO_LARGE;
  }
  return await readBodyText(request, maxJsonBodyBytes);
};

const readInput = async (
  request: Request,
  inputSource: 'body' | 'query',
  options: RuntimeOptions
): Promise<InputReadResult> => {
  if (inputSource === 'query') {
    return parseQueryParams(request);
  }
  if (isEmptyBody(request)) {
    return {};
  }
  return await readJsonBody(request, options.maxJsonBodyBytes);
};

const json = (body: Record<string, unknown>, status: number): Response =>
  Response.json(body, { status });

const mapErrorResponse = (error: Error): Response => {
  const projection = projectPublicSurfaceError('http', error);
  return json(
    {
      error: {
        category: projection.category,
        code: projection.name,
        message: projection.message,
      },
    },
    projection.code
  );
};

const sanitizeDiagnosticLabelValue = (value: string): string =>
  value
    .replace(LOG_UNSAFE_LABEL_CHARACTERS, '_')
    .slice(0, MAX_DIAGNOSTIC_LABEL_VALUE_LENGTH);

const reportInternalDiagnostics = (error: Error, request: Request): void => {
  if (isTrailsError(error)) {
    return;
  }

  const requestId = request.headers.get('X-Request-ID') ?? undefined;
  const safeRequestId =
    requestId === undefined
      ? undefined
      : sanitizeDiagnosticLabelValue(requestId);
  const label =
    safeRequestId === undefined
      ? '[ontrails:http/fetch] Internal error'
      : `[ontrails:http/fetch] Internal error (${safeRequestId})`;
  console.error(label, projectErrorDiagnostics(error));
};

interface ResultLike {
  readonly error?: Error | undefined;
  isOk(): boolean;
  readonly value?: unknown;
}

/**
 * True when the route's trail declares a BlobRef output schema — the
 * authored fact that selects byte streaming over the JSON envelope.
 */
const rendersBlobOutput = (route: HttpRouteDefinition): boolean =>
  isBlobOutputSchema(route.trail.output);

/**
 * Narrow blob bytes for `Response`. `BlobRef.data` is typed `Uint8Array`
 * (ArrayBufferLike backing) while `BodyInit` wants a plain-ArrayBuffer
 * view; blob producers construct views over plain buffers, so narrowing
 * here avoids copying the bytes.
 */
const blobBody = (data: BlobRef['data']): BodyInit =>
  data instanceof ReadableStream ? data : (data as Uint8Array<ArrayBuffer>);

/** Stream a BlobRef's bytes with its declared content type and length. */
const blobResponse = (blob: BlobRef): Response =>
  new Response(blobBody(blob.data), {
    headers: {
      'Content-Length': String(blob.size),
      'Content-Type': blob.mimeType,
    },
    status: 200,
  });

const mapResultToResponse = (
  result: ResultLike,
  request: Request,
  options?: { readonly rendersBlob?: boolean }
): Response => {
  if (result.isOk()) {
    if (options?.rendersBlob === true && isBlobRef(result.value)) {
      return blobResponse(result.value);
    }
    return json({ data: result.value }, 200);
  }
  const error = result.error ?? new Error('Unknown error');
  reportInternalDiagnostics(error, request);
  return mapErrorResponse(error);
};

const handleCaughtError = (error: unknown, request: Request): Response => {
  const err = error instanceof Error ? error : new Error(String(error));
  reportInternalDiagnostics(err, request);
  return mapErrorResponse(err);
};

const invalidJsonResponse = (): Response =>
  json(
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
  json(
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
  json(
    {
      error: {
        category: 'validation',
        code: 'ValidationError',
        message: `JSON request body exceeds ${options.maxJsonBodyBytes} bytes`,
      },
    },
    413
  );

const notFoundResponse = (request: Request): Response => {
  const path = new URL(request.url).pathname;
  return mapErrorResponse(new NotFoundError(`HTTP route not found: ${path}`));
};

const collectHeaders = (request: Request): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const [key, value] of request.headers) {
    headers[key] = value;
  }
  return headers;
};

const createWebhookVerifyRequest = (
  request: Request,
  body: string
): {
  readonly body: string;
  readonly headers: Record<string, string>;
  readonly method: string;
  readonly path: string;
} => ({
  body,
  headers: collectHeaders(request),
  method: request.method,
  path: new URL(request.url).pathname,
});

const recordInvalidWebhook = async (
  route: HttpRouteDefinition,
  errorCategory = 'validation'
): Promise<void> => {
  await route.recordWebhookInvalid?.(errorCategory);
};

const errorCategoryForWebhookFailure = (error: Error | undefined): string =>
  error !== undefined && isTrailsError(error) ? error.category : 'internal';

/**
 * True when the route's webhook source opts into ingress-envelope
 * delivery: dynamic path segments, raw body, or allowlisted headers.
 */
const usesWebhookEnvelope = (route: HttpRouteDefinition): boolean => {
  const source = route.webhookSource;
  return (
    source !== undefined &&
    (source.rawBody === true ||
      source.headers !== undefined ||
      parseWebhookPathParams(source.path).length > 0)
  );
};

const pickAllowlistedHeaders = (
  headers: Headers,
  allowlist: readonly string[]
): Record<string, string> => {
  const allowed = new Set(allowlist.map((name) => name.toLowerCase()));
  const kept: Record<string, string> = {};
  for (const [name, value] of headers) {
    const normalized = name.toLowerCase();
    if (allowed.has(normalized)) {
      kept[normalized] = value;
    }
  }
  return kept;
};

/**
 * Assemble the delivered webhook value.
 *
 * Classic webhooks deliver the parsed JSON body directly. Envelope-mode
 * webhooks deliver `{ ...pathParams, body?, headers?, rawBody? }` — the
 * schema-declared boundary shape TRL-1194 lifts from the hand-mounted
 * ingress routes.
 */
const buildWebhookDeliveredValue = (
  route: HttpRouteDefinition,
  request: Request,
  rawBody: string,
  jsonBody: unknown,
  pathParams: Readonly<Record<string, string>> | undefined
): unknown => {
  const source = route.webhookSource;
  if (source === undefined || !usesWebhookEnvelope(route)) {
    return jsonBody;
  }
  return {
    ...(jsonBody === undefined ? {} : { body: jsonBody }),
    ...(source.headers === undefined
      ? {}
      : { headers: pickAllowlistedHeaders(request.headers, source.headers) }),
    ...(source.rawBody === true ? { rawBody } : {}),
    ...pathParams,
  };
};

const handleWebhookRoute = async (
  route: HttpRouteDefinition,
  options: RuntimeOptions,
  request: Request
): Promise<Response> => {
  const envelope = usesWebhookEnvelope(route);
  // Self-derive dynamic segment values from the route's own pattern so
  // every adapter (fetch dispatcher, Bun routes, Hono) gets pattern
  // support without threading params through handler signatures.
  const pathParams = envelope
    ? matchWebhookPath(route.path, new URL(request.url).pathname)
    : undefined;
  const rawBody = await readWebhookBodyText(request, options.maxJsonBodyBytes);

  if (rawBody === JSON_BODY_INVALID_CONTENT_LENGTH) {
    await recordInvalidWebhook(route);
    return invalidContentLengthResponse();
  }

  if (rawBody === JSON_BODY_TOO_LARGE) {
    await recordInvalidWebhook(route);
    return oversizedJsonBodyResponse(options);
  }

  const verified = await route.verifyWebhook?.(
    createWebhookVerifyRequest(request, rawBody)
  );
  if (verified?.isErr()) {
    await recordInvalidWebhook(
      route,
      errorCategoryForWebhookFailure(verified.error)
    );
    return mapResultToResponse(verified, request);
  }

  const jsonBody = parseWebhookBodyText(request, rawBody);
  // With rawBody delivery the trail owns payload interpretation, so a
  // non-JSON body is not a surface-level failure.
  if (jsonBody === JSON_PARSE_ERROR && route.webhookSource?.rawBody !== true) {
    await recordInvalidWebhook(route);
    return invalidJsonResponse();
  }

  const delivered = buildWebhookDeliveredValue(
    route,
    request,
    rawBody,
    jsonBody === JSON_PARSE_ERROR ? undefined : jsonBody,
    pathParams
  );

  const parsed = route.parseWebhookInput?.(delivered);
  if (parsed === undefined) {
    await recordInvalidWebhook(route, 'internal');
    return mapResultToResponse(
      {
        error: new Error('Webhook route is missing parse handler'),
        isOk: () => false,
      },
      request
    );
  }
  if (parsed.isErr()) {
    await recordInvalidWebhook(route);
    return mapResultToResponse(parsed, request);
  }

  const requestId = request.headers.get('X-Request-ID') ?? undefined;
  const result = await route.execute(parsed.value, requestId, request.signal, {
    headers: request.headers,
  });
  // Envelope-mode ingress acknowledges accepted work with 202, matching
  // the accepted-for-processing semantics of webhook receivers.
  if (envelope && result.isOk()) {
    return json({ data: result.value }, 202);
  }
  return mapResultToResponse(result, request);
};

/**
 * Build a Web Fetch handler for one framework-agnostic HTTP route.
 *
 * @example
 * ```ts
 * import { deriveHttpRoutes } from '@ontrails/http';
 * import { createRouteHandler } from '@ontrails/http/fetch';
 *
 * const routes = deriveHttpRoutes(graph, { basePath: '/api' });
 * if (routes.isErr()) throw routes.error;
 *
 * const route = routes.value[0];
 * if (!route) throw new Error('No routes derived');
 *
 * const handle = createRouteHandler(route);
 * const response = await handle(new Request('https://example.test/api/hello'));
 * ```
 */
export const createRouteHandler = (
  route: HttpRouteDefinition,
  options: CreateRouteHandlerOptions = {}
): ((request: Request) => Promise<Response>) => {
  const runtimeOptions = {
    maxJsonBodyBytes: resolveMaxJsonBodyBytes(options.maxJsonBodyBytes),
  };
  const rendersBlob = rendersBlobOutput(route);

  return async (request) => {
    try {
      if (route.inputSource === 'webhook') {
        return await handleWebhookRoute(route, runtimeOptions, request);
      }

      const rawInput = await readInput(
        request,
        route.inputSource,
        runtimeOptions
      );

      if (rawInput === JSON_PARSE_ERROR) {
        return invalidJsonResponse();
      }

      if (rawInput === JSON_BODY_INVALID_CONTENT_LENGTH) {
        return invalidContentLengthResponse();
      }

      if (rawInput === JSON_BODY_TOO_LARGE) {
        return oversizedJsonBodyResponse(runtimeOptions);
      }

      const requestId = request.headers.get('X-Request-ID') ?? undefined;
      const result = await route.execute(rawInput, requestId, request.signal, {
        headers: request.headers,
      });
      return mapResultToResponse(result, request, { rendersBlob });
    } catch (error: unknown) {
      return handleCaughtError(error, request);
    }
  };
};

/**
 * Build a Web Fetch dispatcher for all HTTP routes in a topo.
 *
 * @example
 * ```ts
 * import { createFetchHandler } from '@ontrails/http/fetch';
 *
 * const fetch = createFetchHandler(graph, { basePath: '/api' });
 * const response = await fetch(
 *   new Request('https://example.test/api/hello?name=Matt')
 * );
 * ```
 */
export const createFetchHandler = (
  graph: Topo,
  options: CreateFetchHandlerOptions = {}
): ((request: Request) => Promise<Response>) => {
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

  type BoundRouteHandler = (request: Request) => Promise<Response>;

  const routeHandlers = new Map<string, BoundRouteHandler>();
  const patternRoutes: {
    readonly handler: BoundRouteHandler;
    readonly method: string;
    readonly pattern: string;
  }[] = [];
  for (const route of routesResult.value) {
    const handler = createRouteHandler(route, {
      maxJsonBodyBytes: options.maxJsonBodyBytes,
    });
    if (parseWebhookPathParams(route.path).length > 0) {
      patternRoutes.push({
        handler,
        method: route.method.toUpperCase(),
        pattern: route.path,
      });
      continue;
    }
    routeHandlers.set(routeKey(route.method, route.path), handler);
  }

  return async (request) => {
    const path = new URL(request.url).pathname;
    const handler = routeHandlers.get(routeKey(request.method, path));
    if (handler !== undefined) {
      return handler(request);
    }
    // Exact routes win; dynamic-segment routes match in registration order.
    const method = request.method.toUpperCase();
    for (const candidate of patternRoutes) {
      if (candidate.method !== method) {
        continue;
      }
      if (matchWebhookPath(candidate.pattern, path) !== undefined) {
        return candidate.handler(request);
      }
    }
    return notFoundResponse(request);
  };
};
