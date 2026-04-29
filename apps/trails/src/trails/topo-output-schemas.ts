import { z } from 'zod';

export const trailDetailOutput = z.object({
  crosses: z.array(z.string()).readonly(),
  description: z.string().nullable(),
  detours: z
    .array(
      z.object({
        maxAttempts: z.number(),
        on: z.string(),
      })
    )
    .readonly()
    .nullable(),
  examples: z.array(z.unknown()).readonly(),
  id: z.string(),
  intent: z.enum(['read', 'write', 'destroy']),
  kind: z.literal('trail'),
  pattern: z.string().nullable(),
  resources: z.array(z.string()).readonly(),
  safety: z.string(),
});

export const resourceDetailOutput = z.object({
  description: z.string().nullable(),
  health: z.enum(['available', 'none']),
  id: z.string(),
  kind: z.literal('resource'),
  lifetime: z.literal('singleton'),
  usedBy: z.array(z.string()).readonly(),
});

export const signalDetailOutput = z.object({
  consumers: z.array(z.string()).readonly(),
  description: z.string().nullable(),
  examples: z.array(z.unknown()).readonly(),
  from: z.array(z.string()).readonly(),
  id: z.string(),
  kind: z.literal('signal'),
  // null when the surface-map entry is missing for this signal (e.g. partial
  // import or schema migration). Coherent with the list view's
  // `payloadSchema: false` flag — distinguishes "schema not found" from
  // "schema accepts any value" (the latter would be `{}`).
  payload: z.record(z.string(), z.unknown()).nullable(),
  producers: z.array(z.string()).readonly(),
});

export const topoDetailOutput = z.discriminatedUnion('kind', [
  trailDetailOutput,
  resourceDetailOutput,
  signalDetailOutput,
]);
