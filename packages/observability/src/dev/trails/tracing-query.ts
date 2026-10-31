import { Result, trail, tracePermitSchema } from '@ontrails/core';
import type { TraceRecord } from '@ontrails/core';
import { z } from 'zod';

import type { DevStoreQueryOptions } from '../store.js';
import { tracingResource } from '../tracing-resource.js';

/** Output schema for individual trace records. */
const traceRecordOutput = z.object({
  attrs: z.record(z.string(), z.unknown()),
  endedAt: z.number().optional(),
  errorCategory: z.string().optional(),
  id: z.string(),
  intent: z.string().optional(),
  kind: z.enum(['activation', 'signal', 'span', 'trail']),
  name: z.string(),
  parentId: z.string().optional(),
  permit: tracePermitSchema.optional(),
  rootId: z.string(),
  startedAt: z.number(),
  status: z.enum(['ok', 'err', 'cancelled']),
  surface: z.string().optional(),
  traceId: z.string(),
  trailId: z.string().optional(),
});

/** Output schema for the tracing.query trail. */
const tracingQueryOutput = z.object({
  count: z.number(),
  records: z.array(traceRecordOutput),
});

/** Map a TraceRecord to the output shape, dropping internal fields. */
const mapRecord = (r: TraceRecord) => ({
  attrs: r.attrs,
  endedAt: r.endedAt,
  errorCategory: r.errorCategory,
  id: r.id,
  intent: r.intent,
  kind: r.kind,
  name: r.name,
  parentId: r.parentId,
  permit: r.permit,
  rootId: r.rootId,
  startedAt: r.startedAt,
  status: r.status,
  surface: r.surface,
  traceId: r.traceId,
  trailId: r.trailId,
});

/** Build DevStoreQueryOptions, omitting undefined fields for exactOptionalPropertyTypes. */
const buildQueryOptions = (input: {
  readonly errorsOnly: boolean;
  readonly limit: number;
  readonly traceId?: string | undefined;
  readonly trailId?: string | undefined;
}): DevStoreQueryOptions => ({
  errorsOnly: input.errorsOnly,
  limit: input.limit,
  ...(input.trailId === undefined ? {} : { trailId: input.trailId }),
  ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
});

/**
 * Query execution history from the tracing dev store.
 *
 * Reads the store from the `tracingResource` state. Returns an empty
 * result set when no store has been configured.
 */
export const tracingQuery = trail('tracing.query', {
  examples: [
    { input: {}, name: 'Recent traces' },
    { input: { trailId: 'user.create' }, name: 'Filter by trail' },
    { input: { errorsOnly: true }, name: 'Errors only' },
  ],
  implementation: (input, ctx) => {
    const state = tracingResource.from(ctx);
    if (!state.store) {
      return Result.ok({ count: 0, records: [] });
    }
    const records = state.store.query(buildQueryOptions(input));
    const mapped = records.map(mapRecord);
    return Result.ok({ count: mapped.length, records: mapped });
  },
  input: z.object({
    errorsOnly: z.boolean().describe('Show only failed traces').default(false),
    limit: z.number().describe('Max results').default(20),
    traceId: z.string().describe('Show full trace tree').optional(),
    trailId: z.string().describe('Filter by trail ID').optional(),
  }),
  intent: 'read',
  meta: { category: 'infrastructure' },
  output: tracingQueryOutput,
  resources: [tracingResource],
});
