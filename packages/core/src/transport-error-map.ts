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

export interface SurfaceErrorProjection {
  readonly category: ErrorCategory;
  readonly code: SurfaceErrorCode;
  readonly message: string;
  readonly name: string;
  readonly retryable: boolean;
  readonly surface: SurfaceName;
}

export interface ErrorClassSurfaceProjection {
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

export const projectSurfaceError = (
  surface: SurfaceName,
  error: TrailsError
): SurfaceErrorProjection => ({
  category: error.category,
  code: mapSurfaceError(surface, error),
  message: error.message,
  name: error.name,
  retryable: error.retryable,
  surface,
});

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
 * Project a known error class name onto a surface without constructing it.
 *
 * Dynamic-category errors such as `RetryExhaustedError` return `undefined`
 * because their surface code depends on the wrapped runtime error.
 */
export const projectErrorClassSurface = (
  surface: SurfaceName,
  errorName: string
): ErrorClassSurfaceProjection | undefined => {
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

export const transportNames = ['cli', 'http', 'mcp'] as const;

export type TransportName = (typeof transportNames)[number];

/** @deprecated Prefer `SurfaceErrorMapper`. */
export type TransportErrorMapper<T> = SurfaceErrorMapper<T>;

/** @deprecated Prefer `SurfaceErrorMappings`. */
export type TransportErrorMappings<T> = SurfaceErrorMappings<T>;

/** @deprecated Prefer `SurfaceErrorCode`. */
export type TransportErrorCode = SurfaceErrorCode;

/** @deprecated Prefer `createSurfaceErrorMapper`. */
export const createTransportErrorMapper = createSurfaceErrorMapper;

/** @deprecated Prefer `surfaceErrorMap`. */
export const transportErrorMap = {
  cli: surfaceErrorMap.cli,
  http: surfaceErrorMap.http,
  mcp: surfaceErrorMap.mcp,
} as const satisfies Record<TransportName, SurfaceErrorMappings<number>>;

/** @deprecated Prefer `surfaceErrorRegistry`. */
export const transportErrorRegistry = {
  cli: surfaceErrorRegistry.cli,
  http: surfaceErrorRegistry.http,
  mcp: surfaceErrorRegistry.mcp,
} as const;

/** @deprecated Prefer `MapSurfaceError` once available, or `typeof mapSurfaceError`. */
export type MapTransportError = (
  transport: TransportName,
  error: TrailsError
) => TransportErrorCode;

/** @deprecated Prefer `mapSurfaceError`. */
export const mapTransportError: MapTransportError = (
  transport: TransportName,
  error: TrailsError
) => mapSurfaceError(transport, error);
