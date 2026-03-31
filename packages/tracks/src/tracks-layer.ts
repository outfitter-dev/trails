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

/** Sink that receives completed TrackRecords. */
export interface TrackSink {
  readonly write: (record: TrackRecord) => void | Promise<void>;
}

/** Outcome fields derived from a trail execution result. */
interface TrackOutcome {
  readonly status: TrackRecord['status'];
  readonly errorCategory: string | undefined;
}

/** Derive status and errorCategory from a trail result. */
const deriveOutcome = (result: Result<unknown, Error>): TrackOutcome =>
  result.match<TrackOutcome>({
    err: (e) => ({
      errorCategory: e instanceof TrailsError ? e.category : undefined,
      status: e instanceof CancelledError ? 'cancelled' : 'err',
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

export const createTracksLayer = (sink: TrackSink): Layer => ({
  description: 'Automatic trail execution recording',
  name: 'tracks',
  wrap:
    <I, O>(trail: Trail<I, O>, impl: Implementation<I, O>) =>
    async (input: I, ctx) => {
      const record = createTrackRecord({
        intent: trail.intent,
        permit: extractPermit(ctx),
        surface: ctx.extensions?.[SURFACE_KEY] as TrackRecord['surface'],
        trailId: trail.id,
      });
      let result: Result<O, Error>;
      try {
        result = await impl(input, ctx);
      } catch (error: unknown) {
        result = ResultCtor.err(normalizeThrownError(error));
      }
      const completed: TrackRecord = {
        ...record,
        ...deriveOutcome(result),
        endedAt: Date.now(),
      };

      await Promise.resolve(sink.write(completed)).catch(() => {
        // sink failures must not affect trail result delivery
      });
      return result;
    },
});
