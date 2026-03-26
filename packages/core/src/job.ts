import { z } from 'zod';

import { progressFields } from './patterns/progress.js';
import { statusFields } from './patterns/status.js';

/**
 * Proof: job-style output schema composes from existing pattern helpers.
 * No dedicated `kind: "job"` needed — regular trails with status+progress output work.
 */
export const jobOutputSchema = z.object({
  ...progressFields().shape,
  ...statusFields().shape,
  completedAt: z.string().optional(),
  error: z.string().optional(),
  jobId: z.string(),
  result: z.unknown().optional(),
  startedAt: z.string().optional(),
});

export type JobOutput = z.infer<typeof jobOutputSchema>;
