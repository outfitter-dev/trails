import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import type { DevStoreQueryOptions } from '../stores/dev.js';
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
  rootId: z.string(),
  startedAt: z.number(),
  status: z.enum(['ok', 'err', 'cancelled']),
  traceId: z.string(),
  trailId: z.string().optional(),
  trailhead: z.string().optional(),
});

/** Output schema for the tracing.query trail. */
const tracingQueryOutput = z.object({
  count: z.number(),
  records: z.array(traceRecordOutput),
});

/** Map a TraceRecord to the output shape, dropping internal fields. */
const mapRecord = (r: {
  readonly attrs: Readonly<Record<string, unknown>>;
  readonly endedAt?: number | undefined;
  readonly errorCategory?: string | undefined;
  readonly id: string;
  readonly intent?: string | undefined;
  readonly kind: 'activation' | 'signal' | 'span' | 'trail';
  readonly name: string;
  readonly parentId?: string | undefined;
  readonly rootId: string;
  readonly startedAt: number;
  readonly status: 'ok' | 'err' | 'cancelled';
  readonly trailhead?: string | undefined;
  readonly traceId: string;
  readonly trailId?: string | undefined;
}) => ({
  attrs: r.attrs,
  endedAt: r.endedAt,
  errorCategory: r.errorCategory,
  id: r.id,
  intent: r.intent,
  kind: r.kind,
  name: r.name,
  parentId: r.parentId,
  rootId: r.rootId,
  startedAt: r.startedAt,
  status: r.status,
  traceId: r.traceId,
  trailId: r.trailId,
  trailhead: r.trailhead,
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
  blaze: (input, ctx) => {
    const state = tracingResource.from(ctx);
    if (!state.store) {
      return Result.ok({ count: 0, records: [] });
    }
    const records = state.store.query(buildQueryOptions(input));
    const mapped = records.map(mapRecord);
    return Result.ok({ count: mapped.length, records: mapped });
  },
  examples: [
    { input: {}, name: 'Recent traces' },
    { input: { trailId: 'user.create' }, name: 'Filter by trail' },
    { input: { errorsOnly: true }, name: 'Errors only' },
  ],
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
