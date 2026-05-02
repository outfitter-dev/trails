/**
 * Runtime diagnostics for typed signal emission.
 *
 * Diagnostics are side-channel records: they make signal runtime problems
 * observable without changing the best-effort producer API.
 */

import { createHash } from 'node:crypto';

import type { z } from 'zod';

import type { ActivationProvenance } from './activation-provenance.js';
import type { Logger } from './types.js';

export const SIGNAL_DIAGNOSTICS_SINK_KEY =
  '__trails_signal_diagnostics_sink' as const;

export const SIGNAL_DIAGNOSTICS_STRICT_MODE_KEY =
  '__trails_signal_diagnostics_strict_mode' as const;

export const signalDiagnosticDefinitions = {
  'signal.fire.suppressed': {
    category: 'activation',
    description:
      'A signal fire was intentionally suppressed by a runtime guard.',
    level: 'warning',
  },
  'signal.handler.failed': {
    category: 'handler',
    description: 'A signal consumer returned a failed Result.',
    level: 'error',
  },
  'signal.handler.predicate_failed': {
    category: 'activation',
    description: 'A signal consumer activation predicate threw or rejected.',
    level: 'error',
  },
  'signal.handler.rejected': {
    category: 'handler',
    description: 'A signal consumer rejected outside Result normalization.',
    level: 'error',
  },
  'signal.invalid': {
    category: 'validation',
    description:
      'A signal payload failed schema validation at the fire boundary.',
    level: 'error',
  },
  'signal.unknown': {
    category: 'topology',
    description: 'A producer fired a signal that is not present in the topo.',
    level: 'error',
  },
} as const;

export type SignalDiagnosticCode = keyof typeof signalDiagnosticDefinitions;

export type SignalDiagnosticLevel =
  (typeof signalDiagnosticDefinitions)[SignalDiagnosticCode]['level'];

export type SignalDiagnosticCategory =
  (typeof signalDiagnosticDefinitions)[SignalDiagnosticCode]['category'];

export type SignalDiagnosticOrigin =
  | 'fan-out-guard'
  | 'fire-boundary'
  | 'handler'
  | 'predicate';

export type SignalPayloadShape =
  | 'array'
  | 'bigint'
  | 'boolean'
  | 'function'
  | 'null'
  | 'number'
  | 'object'
  | 'string'
  | 'symbol'
  | 'undefined';

export interface SignalPayloadSummary {
  readonly byteLength: number;
  readonly digest: string;
  readonly redacted: true;
  readonly shape: SignalPayloadShape;
  readonly topLevelEntryCount?: number | undefined;
}

export type SignalDiagnosticPathSegment = number | string;

export interface SignalDiagnosticSchemaIssue {
  readonly code?: string | undefined;
  readonly message: string;
  readonly path: readonly SignalDiagnosticPathSegment[];
}

export interface SignalDiagnosticCause {
  readonly message: string;
  readonly name?: string | undefined;
}

export interface SignalDiagnosticSourceLocation {
  readonly column?: number | undefined;
  readonly filePath?: string | undefined;
  readonly line?: number | undefined;
}

interface SignalDiagnosticBase<
  TCode extends SignalDiagnosticCode,
  TOrigin extends SignalDiagnosticOrigin,
> {
  readonly activation?: ActivationProvenance | undefined;
  readonly category: (typeof signalDiagnosticDefinitions)[TCode]['category'];
  readonly code: TCode;
  readonly level: (typeof signalDiagnosticDefinitions)[TCode]['level'];
  readonly message: string;
  readonly origin: TOrigin;
  readonly producerTrailId?: string | undefined;
  readonly runId?: string | undefined;
  readonly signalId: string;
  readonly sourceLocation?: SignalDiagnosticSourceLocation | undefined;
  readonly traceId?: string | undefined;
}

export interface SignalInvalidDiagnostic extends SignalDiagnosticBase<
  'signal.invalid',
  'fire-boundary'
> {
  readonly payload: SignalPayloadSummary;
  readonly schemaIssues: readonly SignalDiagnosticSchemaIssue[];
}

export type SignalUnknownDiagnostic = SignalDiagnosticBase<
  'signal.unknown',
  'fire-boundary'
>;

export interface SignalHandlerFailedDiagnostic extends SignalDiagnosticBase<
  'signal.handler.failed',
  'handler'
> {
  readonly cause: SignalDiagnosticCause;
  readonly handlerTrailId: string;
  readonly payload?: SignalPayloadSummary | undefined;
}

export interface SignalHandlerRejectedDiagnostic extends SignalDiagnosticBase<
  'signal.handler.rejected',
  'handler'
> {
  readonly cause: SignalDiagnosticCause;
  readonly handlerTrailId: string;
  readonly payload?: SignalPayloadSummary | undefined;
}

export interface SignalPredicateFailedDiagnostic extends SignalDiagnosticBase<
  'signal.handler.predicate_failed',
  'predicate'
> {
  readonly cause: SignalDiagnosticCause;
  readonly handlerTrailId: string;
  readonly payload?: SignalPayloadSummary | undefined;
}

export interface SignalFireSuppressedDiagnostic extends SignalDiagnosticBase<
  'signal.fire.suppressed',
  'fan-out-guard'
> {
  readonly fireStack?: readonly string[] | undefined;
  readonly limit?: number | undefined;
  readonly reason: 'cycle' | 'depth';
}

export type SignalDiagnostic =
  | SignalFireSuppressedDiagnostic
  | SignalHandlerFailedDiagnostic
  | SignalHandlerRejectedDiagnostic
  | SignalPredicateFailedDiagnostic
  | SignalInvalidDiagnostic
  | SignalUnknownDiagnostic;

export type SignalDiagnosticSink = (
  diagnostic: SignalDiagnostic
) => Promise<void> | void;

export type SignalDiagnosticStrictMode =
  | 'all'
  | 'error'
  | 'off'
  | boolean
  | readonly SignalDiagnosticCode[]
  | ((diagnostic: SignalDiagnostic) => boolean);

export interface SignalDiagnosticContext {
  readonly extensions?: Readonly<Record<string, unknown>> | undefined;
  readonly logger?: Pick<Logger, 'warn'> | undefined;
}

export interface SignalDiagnosticRecordResult {
  readonly delivered: boolean;
  readonly diagnostic: SignalDiagnostic;
  readonly promoted: boolean;
  readonly sinkError?: SignalDiagnosticCause | undefined;
}

export interface SignalDiagnosticCommonInput {
  readonly activation?: ActivationProvenance | undefined;
  readonly message?: string | undefined;
  readonly producerTrailId?: string | undefined;
  readonly runId?: string | undefined;
  readonly signalId: string;
  readonly sourceLocation?: SignalDiagnosticSourceLocation | undefined;
  readonly traceId?: string | undefined;
}

export interface CreateSignalInvalidDiagnosticInput extends SignalDiagnosticCommonInput {
  readonly payload: unknown;
  readonly schemaIssues: readonly z.core.$ZodIssue[];
}

export interface CreateSignalHandlerDiagnosticInput extends SignalDiagnosticCommonInput {
  readonly cause: unknown;
  readonly handlerTrailId: string;
  readonly payload?: unknown;
}

export interface CreateSignalFireSuppressedDiagnosticInput extends SignalDiagnosticCommonInput {
  readonly fireStack?: readonly string[] | undefined;
  readonly limit?: number | undefined;
  readonly reason: 'cycle' | 'depth';
}

const payloadShape = (payload: unknown): SignalPayloadShape => {
  if (payload === null) {
    return 'null';
  }

  const type = typeof payload;
  if (type !== 'object') {
    return type;
  }

  try {
    if (Array.isArray(payload)) {
      return 'array';
    }
  } catch {
    return 'object';
  }

  return 'object';
};

const topLevelEntryCount = (payload: unknown): number | undefined => {
  try {
    if (Array.isArray(payload)) {
      return payload.length;
    }
    if (payload !== null && typeof payload === 'object') {
      return Object.keys(payload).length;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const UNREADABLE_PAYLOAD_VALUE = '[Unreadable]';

const canonicalLeaf = (value: unknown): unknown => {
  switch (typeof value) {
    case 'bigint': {
      return `[BigInt:${value.toString()}]`;
    }
    case 'function': {
      return '[Function]';
    }
    case 'symbol': {
      return `[Symbol:${value.description ?? ''}]`;
    }
    case 'undefined': {
      return '[Undefined]';
    }
    default: {
      return value;
    }
  }
};

const canonicalize = (value: unknown, seen: WeakSet<object>): unknown => {
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    const length = topLevelEntryCount(value) ?? 0;
    const entries: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      try {
        entries.push(canonicalize(value[index], seen));
      } catch {
        entries.push(UNREADABLE_PAYLOAD_VALUE);
      }
    }
    return entries;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? '[Invalid Date]'
      : value.toISOString();
  }
  if (value instanceof RegExp) {
    return value.toString();
  }
  if (value !== null && typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    const sorted: Record<string, unknown> = {};
    let keys: string[];
    try {
      keys = Object.keys(value).toSorted();
    } catch {
      return UNREADABLE_PAYLOAD_VALUE;
    }
    for (const key of keys) {
      try {
        const next = (value as Record<string, unknown>)[key];
        sorted[key] = canonicalize(next, seen);
      } catch {
        sorted[key] = UNREADABLE_PAYLOAD_VALUE;
      }
    }
    return sorted;
  }
  return canonicalLeaf(value);
};

const stableJson = (value: unknown): string => {
  try {
    return (
      JSON.stringify(canonicalize(value, new WeakSet<object>())) ??
      '"[Undefined]"'
    );
  } catch {
    return `"${UNREADABLE_PAYLOAD_VALUE}"`;
  }
};

const hashText = (text: string): string =>
  createHash('sha256').update(text).digest('hex');

export const summarizeSignalPayload = (
  payload: unknown
): SignalPayloadSummary => {
  const canonical = stableJson(payload);
  return {
    byteLength: new TextEncoder().encode(canonical).byteLength,
    digest: hashText(canonical),
    redacted: true,
    shape: payloadShape(payload),
    topLevelEntryCount: topLevelEntryCount(payload),
  };
};

export const schemaIssuesFromZod = (
  issues: readonly z.core.$ZodIssue[]
): readonly SignalDiagnosticSchemaIssue[] =>
  issues.map((issue) => ({
    code: typeof issue.code === 'string' ? issue.code : undefined,
    message: issue.message,
    path: issue.path.map((segment) =>
      typeof segment === 'number' ? segment : String(segment)
    ),
  }));

export const signalDiagnosticCauseFromUnknown = (
  cause: unknown
): SignalDiagnosticCause => {
  if (cause instanceof Error) {
    return {
      message: cause.message,
      name: cause.name,
    };
  }
  return {
    message: String(cause),
  };
};

export const shouldPromoteSignalDiagnostic = (
  diagnostic: SignalDiagnostic,
  strictMode?: SignalDiagnosticStrictMode
): boolean => {
  if (
    strictMode === undefined ||
    strictMode === false ||
    strictMode === 'off'
  ) {
    return false;
  }
  if (strictMode === true || strictMode === 'all') {
    return true;
  }
  if (strictMode === 'error') {
    return diagnostic.level === 'error';
  }
  if (Array.isArray(strictMode)) {
    return strictMode.includes(diagnostic.code);
  }
  if (typeof strictMode !== 'function') {
    return false;
  }
  try {
    return strictMode(diagnostic);
  } catch {
    return false;
  }
};

const signalDiagnosticSinkFrom = (
  ctx: SignalDiagnosticContext | undefined
): SignalDiagnosticSink | undefined => {
  const sink = ctx?.extensions?.[SIGNAL_DIAGNOSTICS_SINK_KEY];
  return typeof sink === 'function'
    ? (sink as SignalDiagnosticSink)
    : undefined;
};

const signalDiagnosticStrictModeFrom = (
  ctx: SignalDiagnosticContext | undefined
): SignalDiagnosticStrictMode | undefined => {
  const strictMode = ctx?.extensions?.[SIGNAL_DIAGNOSTICS_STRICT_MODE_KEY];
  if (
    strictMode === true ||
    strictMode === false ||
    strictMode === 'all' ||
    strictMode === 'error' ||
    strictMode === 'off' ||
    Array.isArray(strictMode) ||
    typeof strictMode === 'function'
  ) {
    return strictMode as SignalDiagnosticStrictMode;
  }
  return undefined;
};

export const recordSignalDiagnostic = async (
  ctx: SignalDiagnosticContext | undefined,
  diagnostic: SignalDiagnostic
): Promise<SignalDiagnosticRecordResult> => {
  const promoted = shouldPromoteSignalDiagnostic(
    diagnostic,
    signalDiagnosticStrictModeFrom(ctx)
  );
  const sink = signalDiagnosticSinkFrom(ctx);
  if (sink === undefined) {
    return {
      delivered: false,
      diagnostic,
      promoted,
    };
  }
  try {
    await sink(diagnostic);
    return {
      delivered: true,
      diagnostic,
      promoted,
    };
  } catch (error) {
    const sinkError = signalDiagnosticCauseFromUnknown(error);
    ctx?.logger?.warn('Signal diagnostic sink failed', {
      code: diagnostic.code,
      error: sinkError.message,
      signalId: diagnostic.signalId,
    });
    return {
      delivered: false,
      diagnostic,
      promoted,
      sinkError,
    };
  }
};

export const createSignalInvalidDiagnostic = (
  input: CreateSignalInvalidDiagnosticInput
): SignalInvalidDiagnostic => {
  const definition = signalDiagnosticDefinitions['signal.invalid'];
  return {
    activation: input.activation,
    category: definition.category,
    code: 'signal.invalid',
    level: definition.level,
    message: input.message ?? `Invalid payload for signal "${input.signalId}"`,
    origin: 'fire-boundary',
    payload: summarizeSignalPayload(input.payload),
    producerTrailId: input.producerTrailId,
    runId: input.runId,
    schemaIssues: schemaIssuesFromZod(input.schemaIssues),
    signalId: input.signalId,
    sourceLocation: input.sourceLocation,
    traceId: input.traceId,
  };
};

export const createSignalUnknownDiagnostic = (
  input: SignalDiagnosticCommonInput
): SignalUnknownDiagnostic => {
  const definition = signalDiagnosticDefinitions['signal.unknown'];
  return {
    activation: input.activation,
    category: definition.category,
    code: 'signal.unknown',
    level: definition.level,
    message: input.message ?? `Unknown signal "${input.signalId}"`,
    origin: 'fire-boundary',
    producerTrailId: input.producerTrailId,
    runId: input.runId,
    signalId: input.signalId,
    sourceLocation: input.sourceLocation,
    traceId: input.traceId,
  };
};

export const createSignalHandlerFailedDiagnostic = (
  input: CreateSignalHandlerDiagnosticInput
): SignalHandlerFailedDiagnostic => {
  const definition = signalDiagnosticDefinitions['signal.handler.failed'];
  return {
    activation: input.activation,
    category: definition.category,
    cause: signalDiagnosticCauseFromUnknown(input.cause),
    code: 'signal.handler.failed',
    handlerTrailId: input.handlerTrailId,
    level: definition.level,
    message:
      input.message ??
      `Signal handler "${input.handlerTrailId}" failed for "${input.signalId}"`,
    origin: 'handler',
    payload:
      input.payload === undefined
        ? undefined
        : summarizeSignalPayload(input.payload),
    producerTrailId: input.producerTrailId,
    runId: input.runId,
    signalId: input.signalId,
    sourceLocation: input.sourceLocation,
    traceId: input.traceId,
  };
};

export const createSignalHandlerRejectedDiagnostic = (
  input: CreateSignalHandlerDiagnosticInput
): SignalHandlerRejectedDiagnostic => {
  const definition = signalDiagnosticDefinitions['signal.handler.rejected'];
  return {
    activation: input.activation,
    category: definition.category,
    cause: signalDiagnosticCauseFromUnknown(input.cause),
    code: 'signal.handler.rejected',
    handlerTrailId: input.handlerTrailId,
    level: definition.level,
    message:
      input.message ??
      `Signal handler "${input.handlerTrailId}" rejected for "${input.signalId}"`,
    origin: 'handler',
    payload:
      input.payload === undefined
        ? undefined
        : summarizeSignalPayload(input.payload),
    producerTrailId: input.producerTrailId,
    runId: input.runId,
    signalId: input.signalId,
    sourceLocation: input.sourceLocation,
    traceId: input.traceId,
  };
};

export const createSignalPredicateFailedDiagnostic = (
  input: CreateSignalHandlerDiagnosticInput
): SignalPredicateFailedDiagnostic => {
  const definition =
    signalDiagnosticDefinitions['signal.handler.predicate_failed'];
  return {
    activation: input.activation,
    category: definition.category,
    cause: signalDiagnosticCauseFromUnknown(input.cause),
    code: 'signal.handler.predicate_failed',
    handlerTrailId: input.handlerTrailId,
    level: definition.level,
    message:
      input.message ??
      `Signal handler predicate for "${input.handlerTrailId}" failed for "${input.signalId}"`,
    origin: 'predicate',
    payload:
      input.payload === undefined
        ? undefined
        : summarizeSignalPayload(input.payload),
    producerTrailId: input.producerTrailId,
    runId: input.runId,
    signalId: input.signalId,
    sourceLocation: input.sourceLocation,
    traceId: input.traceId,
  };
};

export const createSignalFireSuppressedDiagnostic = (
  input: CreateSignalFireSuppressedDiagnosticInput
): SignalFireSuppressedDiagnostic => {
  const definition = signalDiagnosticDefinitions['signal.fire.suppressed'];
  return {
    activation: input.activation,
    category: definition.category,
    code: 'signal.fire.suppressed',
    fireStack: input.fireStack,
    level: definition.level,
    limit: input.limit,
    message:
      input.message ??
      `Signal "${input.signalId}" fire was suppressed by ${input.reason} guard`,
    origin: 'fan-out-guard',
    producerTrailId: input.producerTrailId,
    reason: input.reason,
    runId: input.runId,
    signalId: input.signalId,
    sourceLocation: input.sourceLocation,
    traceId: input.traceId,
  };
};
