/**
 * Shared Zod schemas for warden rule trails.
 *
 * Every rule trail shares the same input (source file) and output
 * (array of diagnostics) shape.
 */

import { intentValues } from '@ontrails/core';
import type { Topo } from '@ontrails/core';
import type { TopoGraph } from '@ontrails/topography';
import { z } from 'zod';
import { wardenImportResolutionErrorKinds } from '../resolve.js';
import { wardenFixClasses, wardenFixSafeties } from '../rules/metadata.js';

export const guidanceLinkSchema = z.object({
  label: z.string(),
  path: z.string().optional(),
  url: z.string().optional(),
});

export const guidanceSchema = z.object({
  commands: z.array(z.string()).readonly().optional(),
  docs: z.array(guidanceLinkSchema).readonly().optional(),
  relatedRules: z.array(z.string()).readonly().optional(),
  steps: z.array(z.string()).readonly().optional(),
  summary: z.string(),
});

export const fixEditSchema = z.object({
  end: z.number(),
  replacement: z.string(),
  start: z.number(),
});

export const fixSchema = z.object({
  class: z.enum(wardenFixClasses),
  edits: z.array(fixEditSchema).readonly().optional(),
  fixture: z.string().optional(),
  reason: z.string(),
  safety: z.enum(wardenFixSafeties),
});

/** A single diagnostic emitted by a warden rule trail. */
export const diagnosticSchema = z.object({
  code: z.string().optional().describe('Optional rule-local diagnostic code'),
  filePath: z.string().describe('File path that was analyzed'),
  fix: fixSchema.optional().describe('Structured fix metadata'),
  guidance: guidanceSchema
    .optional()
    .describe('Structured remediation guidance'),
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

export const importResolutionSchema = z.object({
  builtinModule: z.string().optional(),
  crossesPackageBoundary: z.boolean(),
  errorKind: z.enum(wardenImportResolutionErrorKinds).optional(),
  errorMessage: z.string().optional(),
  importSource: z.string(),
  importerPath: z.string(),
  isInternalTarget: z.boolean(),
  line: z.number(),
  packageName: z.string().optional(),
  packageRoot: z.string().optional(),
  resolvedPath: z.string().optional(),
  usesPublicExport: z.boolean(),
});

export const publicWorkspaceSchema = z.object({
  bin: z.record(z.string(), z.string()).optional(),
  exportTargets: z.record(z.string(), z.string()).optional(),
  files: z.array(z.string()).optional(),
  hasExports: z.boolean(),
  name: z.string(),
  packageJsonPath: z.string(),
  rootDir: z.string(),
});

export const exportedSymbolDefinitionSchema = z.object({
  filePath: z.string(),
  kind: z.enum([
    'class',
    'const',
    'enum',
    'export',
    'function',
    'interface',
    'type',
  ]),
  line: z.number(),
  name: z.string(),
  workspaceName: z.string(),
  workspaceRoot: z.string(),
});

/**
 * Extended input for project-aware warden rule trails.
 *
 * Adds `knownTrailIds` so the caller can supply compose-file context and avoid
 * false positives for `@see` references or compose-file entity relationships.
 */
export const authoredMcpSurfaceBindingSetSchema = z.object({
  appName: z.string().describe('App/topo label the bindings were authored for'),
  bindings: z
    .record(z.string(), z.union([z.string(), z.array(z.string()).readonly()]))
    .describe('Surfaces overlay mcp bindings: binding name to selector(s)'),
  trailIds: z
    .array(z.string())
    .readonly()
    .describe('Trail ids registered in the owning app topo'),
});

const governedVocabularyHistoryFormJudgmentSchema = z.object({
  disposition: z.string(),
  form: z.string(),
  reason: z.string().optional(),
  representative: z
    .object({
      line: z.number().int().positive(),
      path: z.string(),
    })
    .optional(),
  target: z.string().optional(),
});

const governedVocabularyHistoryEvidenceSchema = z.object({
  caseSensitive: z.boolean(),
  id: z.string(),
  latestFormJudgments: z
    .array(governedVocabularyHistoryFormJudgmentSchema)
    .readonly(),
  path: z.string(),
  runCount: z.number().int().nonnegative(),
  transitionId: z.string(),
});

export const projectAwareRuleInput = ruleInput.extend({
  authoredMcpSurfaceBindingSets: z
    .array(authoredMcpSurfaceBindingSetSchema)
    .readonly()
    .optional()
    .describe(
      'Per-app authored surfaces overlay mcp bindings with owning-app trail ids'
    ),
  composeTargetTrailIds: z
    .array(z.string())
    .optional()
    .describe('Trail IDs referenced by composes arrays across the project'),
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
  documentedImportResolutionsByFile: z
    .record(z.string(), z.array(importResolutionSchema))
    .optional()
    .describe('Resolved docs/specifier facts keyed by documentation file path'),
  entityReferencesByName: z
    .record(z.string(), z.array(z.string()))
    .optional()
    .describe('Declared entity references keyed by source entity name'),
  exportedSymbolDefinitionsByName: z
    .record(z.string(), z.array(exportedSymbolDefinitionSchema))
    .optional()
    .describe('Public exported symbol definitions grouped by exported name'),
  governedVocabularyHistories: z
    .array(governedVocabularyHistoryEvidenceSchema)
    .readonly()
    .optional()
    .describe('Validated committed Regrade histories by governed transition'),
  governedVocabularyHistoryIssues: z
    .array(
      z.object({
        message: z.string(),
        path: z.string(),
        transitionId: z.string().optional(),
      })
    )
    .readonly()
    .optional()
    .describe('Invalid committed Regrade history artifacts'),
  governedVocabularyHistoryRequired: z
    .boolean()
    .optional()
    .describe('Whether the project must prove completed governed migrations'),
  importResolutionsByFile: z
    .record(z.string(), z.array(importResolutionSchema))
    .optional()
    .describe('Resolved import facts keyed by importer file path'),
  knownEntityIds: z
    .array(z.string())
    .optional()
    .describe('Entity names known across the project'),
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
  publicWorkspaces: z
    .record(z.string(), publicWorkspaceSchema)
    .optional()
    .describe('Non-private published @ontrails workspaces by package name'),
  reconcileTableIds: z
    .array(z.string())
    .optional()
    .describe('Store table IDs used with reconcile trails across the project'),
  topoTrailIds: z
    .array(z.string())
    .optional()
    .describe('Trail IDs registered in configured app topo targets'),
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
  graph: z
    .custom<TopoGraph>(
      (value) =>
        typeof value === 'object' && value !== null && 'entries' in value,
      { message: 'Expected a serialized TopoGraph object' }
    )
    .optional()
    .describe('Optional derived TopoGraph with graph-only audit annotations'),
  topo: z
    .custom<Topo>(
      (value) =>
        typeof value === 'object' &&
        value !== null &&
        'trails' in value &&
        'resources' in value &&
        'entities' in value &&
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
