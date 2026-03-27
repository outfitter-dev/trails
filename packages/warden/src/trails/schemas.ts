/**
 * Shared Zod schemas for warden rule trails.
 */

import { z } from 'zod';

/**
 * Input schema for simple (non-project-aware) warden rules.
 */
export const ruleInputSchema = z.object({
  filePath: z.string(),
  sourceCode: z.string(),
});

/**
 * Input schema for project-aware warden rules that need cross-file context.
 */
export const projectAwareRuleInputSchema = ruleInputSchema.extend({
  detourTargetTrailIds: z.array(z.string()).optional(),
  knownTrailIds: z.array(z.string()),
});

/**
 * Output schema for all warden rule trails.
 */
export const ruleOutputSchema = z.object({
  diagnostics: z.array(
    z.object({
      filePath: z.string(),
      line: z.number(),
      message: z.string(),
      rule: z.string(),
      severity: z.enum(['error', 'warn']),
    })
  ),
});

export type RuleInput = z.infer<typeof ruleInputSchema>;
export type ProjectAwareRuleInput = z.infer<typeof projectAwareRuleInputSchema>;
export type RuleOutput = z.infer<typeof ruleOutputSchema>;
