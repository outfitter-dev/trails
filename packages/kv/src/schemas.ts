import { z } from 'zod';

/** Portable write options; TTL is measured in positive whole seconds. */
export const kvPutOptionsSchema = z
  .object({
    ttlSeconds: z.number().int().positive().optional(),
  })
  .strict();

/** Portable listing options. A cursor belongs to one binding and prefix query. */
export const kvListOptionsSchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.number().int().positive().optional(),
    prefix: z.string().optional(),
  })
  .strict();

/** A short or empty page may be incomplete; only complete ends iteration. */
export const kvListPageSchema = z.discriminatedUnion('complete', [
  z
    .object({ complete: z.literal(true), keys: z.array(z.string()).readonly() })
    .strict(),
  z
    .object({
      complete: z.literal(false),
      cursor: z.string().min(1),
      keys: z.array(z.string()).readonly(),
    })
    .strict(),
]);

/** Options accepted by Kv.put. */
export type KvPutOptions = z.infer<typeof kvPutOptionsSchema>;
/** Options accepted by Kv.list. */
export type KvListOptions = z.infer<typeof kvListOptionsSchema>;
/** Provider-neutral continuation page. */
export type KvListPage = z.infer<typeof kvListPageSchema>;
