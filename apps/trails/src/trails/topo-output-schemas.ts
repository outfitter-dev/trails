import { z } from 'zod';

export const trailDetailOutput = z.object({
  crosses: z.array(z.string()),
  description: z.string().nullable(),
  detours: z
    .array(
      z.object({
        maxAttempts: z.number(),
        on: z.string(),
      })
    )
    .nullable(),
  examples: z.array(z.unknown()),
  id: z.string(),
  intent: z.enum(['read', 'write', 'destroy']),
  kind: z.literal('trail'),
  pattern: z.string().nullable(),
  resources: z.array(z.string()),
  safety: z.string(),
});

export const resourceDetailOutput = z.object({
  description: z.string().nullable(),
  health: z.enum(['available', 'none']),
  id: z.string(),
  kind: z.literal('resource'),
  lifetime: z.literal('singleton'),
  usedBy: z.array(z.string()),
});

export const topoDetailOutput = z.discriminatedUnion('kind', [
  trailDetailOutput,
  resourceDetailOutput,
]);
