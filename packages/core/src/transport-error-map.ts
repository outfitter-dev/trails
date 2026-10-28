import type {
  ErrorCategory,
  ErrorCategoryCodes,
  ErrorClassRegistryEntry,
  FixedErrorClassRegistryEntry,
  TrailsError,
} from './errors.js';
import {
  codesByCategory,
  errorClasses,
  exitCodeMap,
  jsonRpcCodeMap,
  statusCodeMap,
  surfaceErrorCodeOverrides,
} from './errors.js';
import type { PublicErrorRendering } from './error-rendering.js';
import { renderPublicError } from './error-rendering.js';

const CLI_INTERNAL_ERROR_PUBLIC_MESSAGE = 'Internal error';

export const surfaceNames = ['cli', 'http', 'jsonRpc', 'mcp'] as const;

export type SurfaceName = (typeof surfaceNames)[number];

const surfaceCodeKeys = {
  cli: 'exit',
  http: 'http',
  jsonRpc: 'jsonRpc',
  mcp: 'jsonRpc',
} as const satisfies Record<SurfaceName, keyof ErrorCategoryCodes>;

export type SurfaceErrorMapper<T> = (error: TrailsError) => T;

export type SurfaceErrorMappings<T> = Record<ErrorCategory, T>;

/**
 * Union of every surface-specific error code emitted by {@link surfaceErrorMap}.
 *
 * @remarks
 * Previously parameterized by surface (`SurfaceErrorCode<'cli'>` etc.), but
 * the generic collapsed to `number` because the underlying maps were typed as
 * `Record<ErrorCategory, number>`. With `as const satisfies` on the maps the
 * per-surface literals are now observable, but TypeScript cannot narrow
 * `surfaceErrorMap[surface][error.category]` through a generic `TSurface`
 * without an unsound cast. The non-generic union honestly reflects what
 * `mapSurfaceError` returns at the call site.
 */
export type SurfaceErrorCode =
  (typeof codesByCategory)[ErrorCategory][(typeof surfaceCodeKeys)[SurfaceName]];

/** The taxonomy data carried inside a JSON-RPC error response. */
export type JsonRpcErrorData = Pick<
  PublicErrorRendering,
  'category' | 'name' | 'retryable'
>;

/** A public JSON-RPC error body, without the request's id or envelope. */
export interface JsonRpcErrorRendering {
  readonly code: SurfaceErrorCode;
  readonly data: JsonRpcErrorData;
  readonly message: string;
}

/** Protocol methods with a core-owned surface code override. */
export type SurfaceErrorMethod = keyof typeof surfaceErrorCodeOverrides.mcp;

export interface SurfaceErrorRendering extends JsonRpcErrorData {
  readonly code: SurfaceErrorCode;
  readonly message: string;
  readonly surface: SurfaceName;
}

export interface ErrorClassSurfaceRendering {
  readonly category: ErrorCategory;
  readonly code: SurfaceErrorCode;
  readonly name: string;
  readonly retryable: boolean;
  readonly surface: SurfaceName;
}

export const createSurfaceErrorMapper =
  <T>(mappings: SurfaceErrorMappings<T>): SurfaceErrorMapper<T> =>
  (error) =>
    mappings[error.category];

export const surfaceErrorMap = {
  cli: exitCodeMap,
  http: statusCodeMap,
  jsonRpc: jsonRpcCodeMap,
  mcp: jsonRpcCodeMap,
} as const satisfies Record<SurfaceName, SurfaceErrorMappings<number>>;

export const surfaceErrorRegistry = {
  cli: {
    map: createSurfaceErrorMapper(surfaceErrorMap.cli),
    values: surfaceErrorMap.cli,
  },
  http: {
    map: createSurfaceErrorMapper(surfaceErrorMap.http),
    values: surfaceErrorMap.http,
  },
  jsonRpc: {
    map: createSurfaceErrorMapper(surfaceErrorMap.jsonRpc),
    values: surfaceErrorMap.jsonRpc,
  },
  mcp: {
    map: createSurfaceErrorMapper(surfaceErrorMap.mcp),
    values: surfaceErrorMap.mcp,
  },
} as const;

const resolveSurfaceErrorCode = (
  surface: SurfaceName,
  category: ErrorCategory,
  method?: SurfaceErrorMethod
): SurfaceErrorCode => {
  if (surface === 'mcp' && method !== undefined) {
    const overrides: Partial<Record<ErrorCategory, SurfaceErrorCode>> =
      surfaceErrorCodeOverrides.mcp[method];
    const override = overrides[category];
    if (override !== undefined) {
      return override;
    }
  }
  return codesByCategory[category][surfaceCodeKeys[surface]];
};

export const mapSurfaceError = (
  surface: SurfaceName,
  error: TrailsError,
  method?: SurfaceErrorMethod
): SurfaceErrorCode => resolveSurfaceErrorCode(surface, error.category, method);

export const renderSurfaceError = (
  surface: SurfaceName,
  error: TrailsError,
  method?: SurfaceErrorMethod
): SurfaceErrorRendering => ({
  category: error.category,
  code: mapSurfaceError(surface, error, method),
  message: error.message,
  name: error.name,
  retryable: error.retryable,
  surface,
});

export const renderPublicSurfaceError = (
  surface: SurfaceName,
  error: Error,
  method?: SurfaceErrorMethod
): SurfaceErrorRendering => {
  const rendering = renderPublicError(error);
  return {
    ...rendering,
    code: resolveSurfaceErrorCode(surface, rendering.category, method),
    message:
      surface === 'cli' && rendering.category === 'internal'
        ? CLI_INTERNAL_ERROR_PUBLIC_MESSAGE
        : rendering.message,
    surface,
  };
};

const isFixedErrorClassEntry = (
  entry: ErrorClassRegistryEntry
): entry is FixedErrorClassRegistryEntry => entry.category !== 'dynamic';

const fixedErrorClassByName: ReadonlyMap<string, FixedErrorClassRegistryEntry> =
  new Map(
    errorClasses.flatMap((entry): [string, FixedErrorClassRegistryEntry][] =>
      isFixedErrorClassEntry(entry) ? [[entry.name, entry]] : []
    )
  );

/**
 * Render a known error class name onto a surface without constructing it.
 *
 * Dynamic-category errors such as `RetryExhaustedError` return `undefined`
 * because their surface code depends on the wrapped runtime error.
 */
export const renderErrorClassSurface = (
  surface: SurfaceName,
  errorName: string,
  method?: SurfaceErrorMethod
): ErrorClassSurfaceRendering | undefined => {
  const entry = fixedErrorClassByName.get(errorName);
  if (entry === undefined) {
    return undefined;
  }
  return {
    category: entry.category,
    code: resolveSurfaceErrorCode(surface, entry.category, method),
    name: entry.name,
    retryable: entry.retryable,
    surface,
  };
};

/**
 * Render a protocol error using core codes, public redaction, and taxonomy data.
 *
 * @remarks
 * MCP trail failures remain tool results; use this for protocol failures such
 * as an unknown resource. A method override never changes the category default.
 *
 * @example
 * ```ts
 * renderJsonRpcError('mcp', new NotFoundError('missing'), 'resources/read');
 * // { code: -32602, message: 'missing', data: { category: 'not_found', name: 'NotFoundError', retryable: false } }
 * ```
 */
export const renderJsonRpcError = (
  surface: Extract<SurfaceName, 'jsonRpc' | 'mcp'>,
  error: Error,
  method?: SurfaceErrorMethod
): JsonRpcErrorRendering => {
  const { category, code, message, name, retryable } = renderPublicSurfaceError(
    surface,
    error,
    method
  );
  return { code, data: { category, name, retryable }, message };
};
