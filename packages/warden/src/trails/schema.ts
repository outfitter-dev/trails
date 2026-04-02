/**
 * Shared Zod schemas for warden rule trails.
 *
 * Every rule trail shares the same input (source file) and output
 * (array of diagnostics) shape.
 */

import { z } from 'zod';

/** A single diagnostic emitted by a warden rule trail. */
export const diagnosticSchema = z.object({
  filePath: z.string().describe('File path that was analyzed'),
  line: z.number().describe('1-based line number'),
  message: z.string().describe('Human-readable diagnostic message'),
  rule: z.string().describe('Rule name'),
  severity: z.enum(['error', 'warn']).describe('Diagnostic severity'),
});

/** Input accepted by every warden rule trail. */
export const ruleInput = z.object({
  filePath: z.string().describe('Path to the source file'),
  sourceCode: z.string().describe('Source code content'),
});

/**
 * Extended input for project-aware warden rule trails.
 *
 * Adds `knownTrailIds` so the caller can supply cross-file context and avoid
 * false positives for detour targets or `@see` references defined in other
 * files.
 */
export const projectAwareRuleInput = ruleInput.extend({
  knownProvisionIds: z
    .array(z.string())
    .optional()
    .describe('Provision IDs known across the project'),
  knownTrailIds: z
    .array(z.string())
    .optional()
    .describe('Trail IDs known across the project'),
});

/** Output returned by every warden rule trail. */
export const ruleOutput = z.object({
  diagnostics: z.array(diagnosticSchema).describe('Diagnostics found'),
});

export type RuleInput = z.infer<typeof ruleInput>;
export type ProjectAwareRuleInput = z.infer<typeof projectAwareRuleInput>;
export type RuleOutput = z.infer<typeof ruleOutput>;
