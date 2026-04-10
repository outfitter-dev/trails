import type { ErrorCategory, TrailsError } from './errors.js';
import { exitCodeMap, jsonRpcCodeMap, statusCodeMap } from './errors.js';

export const transportNames = ['cli', 'http', 'mcp'] as const;

export type TransportName = (typeof transportNames)[number];

export type TransportErrorMapper<T> = (error: TrailsError) => T;

export type TransportErrorMappings<T> = Record<ErrorCategory, T>;

export type TransportErrorCode<TTransport extends TransportName> =
  (typeof transportErrorMap)[TTransport][ErrorCategory];

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

export const mapTransportError = <TTransport extends TransportName>(
  transport: TTransport,
  error: TrailsError
): TransportErrorCode<TTransport> =>
  transportErrorRegistry[transport].map(error);
