import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import type { DevStoreQueryOptions } from '../stores/dev.js';
import { crumbsService } from '../crumbs-service.js';

/** Output schema for individual crumb records. */
const trackRecordOutput = z.object({
  endedAt: z.number().optional(),
  id: z.string(),
  intent: z.string().optional(),
  kind: z.enum(['trail', 'span']),
  name: z.string(),
  parentId: z.string().optional(),
  startedAt: z.number(),
  status: z.enum(['ok', 'err', 'cancelled']),
  surface: z.string().optional(),
  traceId: z.string(),
  trailId: z.string().optional(),
});

/** Output schema for the crumbs.query trail. */
const crumbsQueryOutput = z.object({
  count: z.number(),
  records: z.array(trackRecordOutput),
});

/** Map a Crumb to the output shape, dropping internal fields. */
const mapRecord = (r: {
  readonly endedAt?: number | undefined;
  readonly id: string;
  readonly intent?: string | undefined;
  readonly kind: 'trail' | 'span';
  readonly name: string;
  readonly parentId?: string | undefined;
  readonly startedAt: number;
  readonly status: 'ok' | 'err' | 'cancelled';
  readonly surface?: string | undefined;
  readonly traceId: string;
  readonly trailId?: string | undefined;
}) => ({
  endedAt: r.endedAt,
  id: r.id,
  intent: r.intent,
  kind: r.kind,
  name: r.name,
  parentId: r.parentId,
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
 * Query execution history from the crumbs dev store.
 *
 * Reads the store from the `crumbsService` state. Returns an empty
 * result set when no store has been configured.
 */
export const crumbsQuery = trail('crumbs.query', {
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
  metadata: { category: 'infrastructure' },
  output: crumbsQueryOutput,
  run: (input, ctx) => {
    const state = crumbsService.from(ctx);
    if (!state.store) {
      return Result.ok({ count: 0, records: [] });
    }
    const records = state.store.query(buildQueryOptions(input));
    const mapped = records.map(mapRecord);
    return Result.ok({ count: mapped.length, records: mapped });
  },
  services: [crumbsService],
});
