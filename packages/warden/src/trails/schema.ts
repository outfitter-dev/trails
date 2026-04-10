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
  contourReferencesByName: z
    .record(z.string(), z.array(z.string()))
    .optional()
    .describe('Declared contour references keyed by source contour name'),
  crossTargetTrailIds: z
    .array(z.string())
    .optional()
    .describe('Trail IDs referenced by crosses arrays across the project'),
  detourTargetTrailIds: z
    .array(z.string())
    .optional()
    .describe('Trail IDs referenced as detour targets across the project'),
  knownContourIds: z
    .array(z.string())
    .optional()
    .describe('Contour names known across the project'),
  knownResourceIds: z
    .array(z.string())
    .optional()
    .describe('Resource IDs known across the project'),
  knownSignalIds: z
    .array(z.string())
    .optional()
    .describe('Signal IDs known across the project'),
  knownTrailIds: z
    .array(z.string())
    .optional()
    .describe('Trail IDs known across the project'),
  trailIntentsById: z
    .record(z.string(), z.enum(['read', 'write', 'destroy']))
    .optional()
    .describe('Normalized trail intents keyed by trail ID'),
});

/** Output returned by every warden rule trail. */
export const ruleOutput = z.object({
  diagnostics: z.array(diagnosticSchema).describe('Diagnostics found'),
});

export type RuleInput = z.infer<typeof ruleInput>;
export type ProjectAwareRuleInput = z.infer<typeof projectAwareRuleInput>;
export type RuleOutput = z.infer<typeof ruleOutput>;
