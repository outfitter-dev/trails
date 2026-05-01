/**
 * Shared Zod schemas for warden rule trails.
 *
 * Every rule trail shares the same input (source file) and output
 * (array of diagnostics) shape.
 */

import { intentValues } from '@ontrails/core';
import type { Topo } from '@ontrails/core';
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
 * false positives for `@see` references or cross-file contour relationships.
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
  crudCoverageByEntity: z
    .record(z.string(), z.array(z.string()))
    .optional()
    .describe(
      'CRUD operation coverage per entity aggregated across the project'
    ),
  crudTableIds: z
    .array(z.string())
    .optional()
    .describe('Store table IDs used with CRUD factories across the project'),
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
  onTargetSignalIds: z
    .array(z.string())
    .optional()
    .describe('Signal IDs referenced by trail on arrays across the project'),
  reconcileTableIds: z
    .array(z.string())
    .optional()
    .describe('Store table IDs used with reconcile trails across the project'),
  trailIntentsById: z
    .record(z.string(), z.enum(intentValues))
    .optional()
    .describe('Normalized trail intents keyed by trail ID'),
});

/**
 * Input for topo-aware warden rule trails.
 *
 * The `Topo` graph is not a serializable value, so the schema accepts it
 * as an opaque `z.custom`. Topo-aware rules are invoked from the warden
 * runtime with a live, resolved topo reference — they are not expected
 * to be called across a network boundary.
 */
export const topoAwareRuleInput = z.object({
  topo: z
    .custom<Topo>(
      (value) =>
        typeof value === 'object' &&
        value !== null &&
        'trails' in value &&
        'resources' in value &&
        'contours' in value &&
        'signals' in value,
      { message: 'Expected a resolved Topo instance' }
    )
    .describe('Resolved topo graph under inspection'),
});

/** Output returned by every warden rule trail. */
export const ruleOutput = z.object({
  diagnostics: z.array(diagnosticSchema).describe('Diagnostics found'),
});

export type RuleInput = z.infer<typeof ruleInput>;
export type ProjectAwareRuleInput = z.infer<typeof projectAwareRuleInput>;
export type TopoAwareRuleInput = z.infer<typeof topoAwareRuleInput>;
export type RuleOutput = z.infer<typeof ruleOutput>;
