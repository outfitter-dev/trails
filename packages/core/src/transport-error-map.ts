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
} from './errors.js';
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

export interface SurfaceErrorRendering {
  readonly category: ErrorCategory;
  readonly code: SurfaceErrorCode;
  readonly message: string;
  readonly name: string;
  readonly retryable: boolean;
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

export const mapSurfaceError = (
  surface: SurfaceName,
  error: TrailsError
): SurfaceErrorCode =>
  codesByCategory[error.category][surfaceCodeKeys[surface]];

export const renderSurfaceError = (
  surface: SurfaceName,
  error: TrailsError
): SurfaceErrorRendering => ({
  category: error.category,
  code: mapSurfaceError(surface, error),
  message: error.message,
  name: error.name,
  retryable: error.retryable,
  surface,
});

export const renderPublicSurfaceError = (
  surface: SurfaceName,
  error: Error
): SurfaceErrorRendering => {
  const rendering = renderPublicError(error);
  return {
    ...rendering,
    code: codesByCategory[rendering.category][surfaceCodeKeys[surface]],
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
  errorName: string
): ErrorClassSurfaceRendering | undefined => {
  const entry = fixedErrorClassByName.get(errorName);
  if (entry === undefined) {
    return undefined;
  }
  return {
    category: entry.category,
    code: codesByCategory[entry.category][surfaceCodeKeys[surface]],
    name: entry.name,
    retryable: entry.retryable,
    surface,
  };
};
