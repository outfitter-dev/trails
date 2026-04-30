import type { ErrorCategory, TrailsError } from './errors.js';
import { exitCodeMap, jsonRpcCodeMap, statusCodeMap } from './errors.js';

export const transportNames = ['cli', 'http', 'mcp'] as const;

export type TransportName = (typeof transportNames)[number];

export type TransportErrorMapper<T> = (error: TrailsError) => T;

export type TransportErrorMappings<T> = Record<ErrorCategory, T>;

/**
 * Union of every transport-specific error code emitted by {@link transportErrorMap}.
 *
 * @remarks
 * Previously parameterised by transport (`TransportErrorCode<'cli'>` etc.), but
 * the generic collapsed to `number` because the underlying maps were typed as
 * `Record<ErrorCategory, number>`. With `as const satisfies` on the maps the
 * per-transport literals are now observable, but TypeScript cannot narrow
 * `transportErrorMap[transport][error.category]` through a generic
 * `TTransport` without an unsound cast. The non-generic union honestly reflects
 * what `mapTransportError` returns at the call site.
 */
export type TransportErrorCode =
  (typeof transportErrorMap)[TransportName][ErrorCategory];

export const createTransportErrorMapper =
  <T>(mappings: TransportErrorMappings<T>): TransportErrorMapper<T> =>
  (error) =>
    mappings[error.category];

export const transportErrorMap = {
  cli: exitCodeMap,
  http: statusCodeMap,
  mcp: jsonRpcCodeMap,
} as const satisfies Record<TransportName, TransportErrorMappings<number>>;

export const transportErrorRegistry = {
  cli: {
    map: createTransportErrorMapper(transportErrorMap.cli),
    values: transportErrorMap.cli,
  },
  http: {
    map: createTransportErrorMapper(transportErrorMap.http),
    values: transportErrorMap.http,
  },
  mcp: {
    map: createTransportErrorMapper(transportErrorMap.mcp),
    values: transportErrorMap.mcp,
  },
} as const;

export type MapTransportError = (
  transport: TransportName,
  error: TrailsError
) => TransportErrorCode;

export const mapTransportError: MapTransportError = (
  transport: TransportName,
  error: TrailsError
) => transportErrorMap[transport][error.category];
