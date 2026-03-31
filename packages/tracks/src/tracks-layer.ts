import type {
  Implementation,
  Layer,
  Result,
  Trail,
  TrailContext,
} from '@ontrails/core';
import {
  CancelledError,
  InternalError,
  Result as ResultCtor,
  SURFACE_KEY,
  TrailsError,
} from '@ontrails/core';

import type { TrackRecord } from './record.js';
import { createTrackRecord } from './record.js';
import type { SamplingConfig } from './sampling.js';
import { shouldSample } from './sampling.js';
import type { TraceContext } from './trace-context.js';
import { createTracksApi, TRACKS_API_KEY } from './tracks-api.js';
import {
  TRACE_CONTEXT_KEY,
  childTraceContext,
  getTraceContext,
} from './trace-context.js';

/** Sink that receives completed TrackRecords. */
export interface TrackSink {
  readonly write: (record: TrackRecord) => void | Promise<void>;
}

/** Options for configuring the tracks layer. */
export interface TracksLayerOptions {
  /** Intent-based sampling overrides. */
  readonly sampling?: Partial<SamplingConfig> | undefined;
  /** Promote sampled-out traces to sampled on error. Default true. */
  readonly keepOnError?: boolean | undefined;
  /** Observe sink write failures without affecting trail delivery. */
  readonly onSinkError?: ((error: unknown) => void) | undefined;
}

/** Outcome fields derived from a trail execution result. */
interface TrackOutcome {
  readonly status: TrackRecord['status'];
  readonly errorCategory: string | undefined;
}

/** Derive status and errorCategory from a trail result. */
const deriveOutcome = (result: Result<unknown, Error>): TrackOutcome =>
  result.match<TrackOutcome>({
    err: (error) => ({
      errorCategory: error instanceof TrailsError ? error.category : undefined,
      status: error instanceof CancelledError ? 'cancelled' : 'err',
    }),
    ok: () => ({ errorCategory: undefined, status: 'ok' }),
  });

/** Normalize thrown implementation errors into Trails-friendly failures. */
const normalizeThrownError = (error: unknown): Error => {
  if (error instanceof TrailsError) {
    return error;
  }
  if (error instanceof Error) {
    return new InternalError(error.message, { cause: error });
  }
  return new InternalError(String(error));
};

/** Create a root trace context for a new trace. */
const createRootTrace = (sampled: boolean): TraceContext => {
  const spanId = Bun.randomUUIDv7();
  return {
    rootId: spanId,
    sampled,
    spanId,
    traceId: Bun.randomUUIDv7(),
  };
};

/** Build a completed record from a base record and execution result. */
const completeRecord = (
  record: TrackRecord,
  result: Result<unknown, Error>
): TrackRecord => ({
  ...record,
  ...deriveOutcome(result),
  endedAt: Date.now(),
});

/** Merge manual annotations into a completed trail record. */
const mergeAnnotations = (
  record: TrackRecord,
  attrs: Readonly<Record<string, unknown>>
): TrackRecord =>
  Object.keys(attrs).length === 0
    ? record
    : {
        ...record,
        attrs: {
          ...record.attrs,
          ...attrs,
        },
      };

/** Resolve whether this invocation should be sampled. */
const resolveSampled = (
  parentTrace: TraceContext | undefined,
  intent: 'read' | 'write' | 'destroy' | undefined,
  sampling: Partial<SamplingConfig> | undefined
): boolean => {
  if (parentTrace) {
    return parentTrace.sampled;
  }
  if (sampling && Object.keys(sampling).length > 0) {
    return shouldSample(intent, sampling);
  }
  return true;
};

/** Enrich a context with trace context in extensions. */
const enrichExtensions = (
  ctx: TrailContext,
  trace: TraceContext
): TrailContext => ({
  ...ctx,
  extensions: {
    ...ctx.extensions,
    [TRACE_CONTEXT_KEY]: trace,
  },
});

/** Decide whether a completed record should be written to the sink. */
const shouldWrite = (
  record: TrackRecord,
  sampled: boolean,
  keepOnError: boolean
): boolean => {
  if (sampled) {
    return true;
  }
  return keepOnError && record.status === 'err';
};

/** Resolve the trace context for this invocation — child or root. */
const resolveTrace = (
  parentTrace: TraceContext | undefined,
  sampled: boolean
): TraceContext =>
  parentTrace
    ? { ...childTraceContext(parentTrace), sampled }
    : createRootTrace(sampled);

/** Extract permit fields from ctx for the track record. */
const extractPermit = (
  ctx: TrailContext
): { readonly id: string; readonly tenantId?: string } | undefined => {
  if (ctx.permit === undefined) {
    return undefined;
  }
  const tenantId =
    'tenantId' in ctx.permit
      ? (ctx.permit as { tenantId?: string }).tenantId
      : undefined;
  return tenantId === undefined
    ? { id: ctx.permit.id }
    : { id: ctx.permit.id, tenantId };
};

/** Notify sink observers without letting secondary failures escape. */
const notifySinkError = (
  options: TracksLayerOptions | undefined,
  error: unknown
): void => {
  try {
    options?.onSinkError?.(error);
  } catch {
    // Observer failures must never affect trail result delivery.
  }
};

/** Prepare the trace, record, and enriched context for a trail execution. */
const prepareExecution = <I, O>(
  trail: Trail<I, O>,
  ctx: TrailContext,
  sink: TrackSink,
  options?: TracksLayerOptions
) => {
  const parentTrace = getTraceContext(ctx);
  const sampled = resolveSampled(parentTrace, trail.intent, options?.sampling);
  const trace = resolveTrace(parentTrace, sampled);
  const isRoot = parentTrace === undefined;

  const record = createTrackRecord({
    intent: trail.intent,
    parentId: parentTrace?.spanId,
    permit: extractPermit(ctx),
    rootId: isRoot ? undefined : trace.rootId,
    surface: ctx.extensions?.[SURFACE_KEY] as TrackRecord['surface'],
    traceId: trace.traceId,
    trailId: trail.id,
  });

  const enrichedTrace: TraceContext = {
    ...trace,
    rootId: isRoot ? record.id : trace.rootId,
    spanId: record.id,
  };
  const traceCtx = enrichExtensions(ctx, enrichedTrace);
  const tracksApi = createTracksApi(traceCtx, sink);

  return {
    ctx: {
      ...traceCtx,
      extensions: {
        ...traceCtx.extensions,
        [TRACKS_API_KEY]: tracksApi.api,
      },
    },
    getAnnotations: tracksApi.getAnnotations,
    record,
    sampled,
  };
};

/**
 * Layer that automatically records every trail execution.
 *
 * Wraps each trail implementation to capture timing, status, and parentage,
 * then writes the completed record to the provided sink. Injects trace
 * context into `ctx.extensions` so child trails inherit the trace. Supports
 * intent-based sampling and error promotion for sampled-out traces.
 */
export const createTracksLayer = (
  sink: TrackSink,
  options?: TracksLayerOptions
): Layer => ({
  description: 'Automatic trail execution recording',
  name: 'tracks',
  wrap:
    <I, O>(trail: Trail<I, O>, impl: Implementation<I, O>) =>
    async (input: I, ctx) => {
      const execution = prepareExecution(trail, ctx, sink, options);
      let result: Result<O, Error>;

      try {
        result = await impl(input, execution.ctx);
      } catch (error: unknown) {
        result = ResultCtor.err(normalizeThrownError(error));
      }

      const completed = mergeAnnotations(
        completeRecord(execution.record, result),
        execution.getAnnotations()
      );

      if (
        shouldWrite(completed, execution.sampled, options?.keepOnError ?? true)
      ) {
        await Promise.resolve(sink.write(completed)).catch((error) => {
          notifySinkError(options, error);
        });
      }

      return result;
    },
});
