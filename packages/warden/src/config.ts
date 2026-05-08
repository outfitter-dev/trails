import { z } from 'zod';

export const wardenDepthValues = ['source', 'project', 'topo', 'all'] as const;
export const wardenFailOnValues = ['error', 'warning'] as const;
export const wardenFormatValues = ['summary', 'github', 'json'] as const;
export const wardenLockValues = ['auto', 'cached', 'refresh', 'skip'] as const;
export const wardenDraftsValues = ['include', 'exclude', 'only'] as const;

const appNameSchema = z.string().min(1);

const wardenConfigObjectSchema = z
  .object({
    apps: z.array(appNameSchema).min(1).optional(),
    depth: z.enum(wardenDepthValues).default('all'),
    drafts: z.enum(wardenDraftsValues).default('include'),
    failOn: z.enum(wardenFailOnValues).default('error'),
    format: z.enum(wardenFormatValues).default('summary'),
    lock: z.enum(wardenLockValues).default('auto'),
  })
  .strict();

export const wardenConfigSchema = wardenConfigObjectSchema
  .optional()
  .transform((value) => wardenConfigObjectSchema.parse(value ?? {}));

export type WardenConfig = z.output<typeof wardenConfigSchema>;
export type WardenConfigInput = z.input<typeof wardenConfigSchema>;
export type WardenDepth = (typeof wardenDepthValues)[number];
export type WardenDraftsMode = (typeof wardenDraftsValues)[number];
export type WardenFailOn = (typeof wardenFailOnValues)[number];
export type WardenFormat = (typeof wardenFormatValues)[number];
export type WardenLockMode = (typeof wardenLockValues)[number];
