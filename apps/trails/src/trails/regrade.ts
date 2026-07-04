/**
 * `regrade` trail -- Run downstream migration checks and safe rewrites.
 */

import {
  InternalError,
  NotFoundError,
  Result,
  ValidationError,
  matchesAnyPathGlob,
  pathScopeSchema,
  trail,
  validateOutput,
} from '@ontrails/core';
import type { PathScope, Result as TrailsResult } from '@ontrails/core';
import {
  createGovernedAstIdentifierRenameClasses,
  listVocabularyRegradePlansFromRegistry,
  loadWardenTermRewriteClasses,
  readVocabularyTransitionRecord,
  regradeReportOutput,
  runRegrade,
  runVocabularyRegrade,
  transitionRecordReportWithSummary,
  vocabularyRegradeTransitionForInput,
  vocabularyDispositionValues,
  vocabularyRegradePlanSchema,
  writeVocabularyTransitionRecord,
} from '@ontrails/regrade';
import type {
  RegradeApplySummary,
  RegradeReport,
  RegradeReportEntry,
  RegradeScanDirectoryBucket,
  RegradeScanExtensionBucket,
  VocabularyPreserveRule,
  VocabularyRegradePlan,
  VocabularyPreserveInventoryEntry,
} from '@ontrails/regrade';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import type { Dirent } from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
} from 'node:path';
import { z } from 'zod';

import { loadRegradeConfig } from '../regrade/config.js';
import { deriveLiveApiPreserveInventory } from '../regrade/live-api-preserve.js';
import { resolveTrailRootDir } from './root-dir.js';

const regradePathScopeInputSchema = pathScopeSchema.extend({
  exclude: pathScopeSchema.shape.exclude.describe(
    'Root-relative path globs to exclude during Regrade collection'
  ),
  extensions: pathScopeSchema.shape.extensions.describe(
    'Source file extensions to scan during Regrade collection'
  ),
  include: pathScopeSchema.shape.include.describe(
    'Root-relative path patterns to include in vocabulary regrade mode'
  ),
});

const regradePreserveRuleInputSchema = z.object({
  disposition: z
    .enum(vocabularyDispositionValues)
    .optional()
    .describe('Classification to assign to occurrences this rule preserves'),
  forms: z
    .array(z.string().min(1))
    .optional()
    .describe('Matched forms this preserve rule applies to'),
  paths: z
    .array(z.string())
    .optional()
    .describe('Root-relative path globs where this preserve rule applies'),
  pattern: z.string().min(1).describe('Regex or literal pattern to preserve'),
  reason: z.string().optional().describe('Why this form is preserved'),
});

const regradePreserveInputSchema = z.union([
  z.string().min(1),
  regradePreserveRuleInputSchema,
]);

const regradeInputSchema = regradePathScopeInputSchema.extend({
  apply: z
    .boolean()
    .default(false)
    .describe('Write safe rewrites to disk; dry-run report only by default'),
  check: z
    .boolean()
    .default(false)
    .describe(
      'Legacy compatibility: check a saved transition record gate without applying rewrites; prefer `regrade check` for saved plans'
    ),
  classIds: z
    .array(z.string())
    .optional()
    .describe('Regrade class ids to run (defaults to all built-in classes)'),
  configPath: z
    .string()
    .optional()
    .describe('Path to a Trails config file with regrade defaults'),
  from: z
    .string()
    .min(1)
    .optional()
    .describe('Source vocabulary term for a vocabulary regrade'),
  includeEntries: z
    .enum(['actionable', 'all'])
    .default('actionable')
    .describe(
      'Report entry detail to include; counts always cover the full run'
    ),
  intent: z
    .string()
    .optional()
    .describe('Human-authored migration intent for a vocabulary regrade'),
  overrides: z
    .record(z.string().min(1), z.string().min(1))
    .optional()
    .describe('Explicit source-form to target-form mappings'),
  planRecord: z
    .string()
    .optional()
    .describe(
      'Legacy compatibility path to a confirmed transition record; prefer `regrade check`, `regrade preview`, and `regrade apply` with saved plans'
    ),
  preserve: z
    .array(regradePreserveInputSchema)
    .optional()
    .describe(
      'Regex or literal contexts, or structured preserve rules, for a vocabulary regrade'
    ),
  rootDir: z.string().optional().describe('Workspace root directory'),
  to: z
    .string()
    .min(1)
    .optional()
    .describe('Target vocabulary term for a vocabulary regrade'),
  writeRecord: z
    .boolean()
    .default(false)
    .describe(
      'Legacy compatibility: persist dry-run or apply evidence as a transition record; prefer `regrade plan` and plan history'
    ),
});

type RegradeInput = z.output<typeof regradeInputSchema>;

const REGRADE_PLAN_SCHEMA_VERSION = 1;

const regradePlanProvenanceValueSchema = z.enum(['authored', 'derived']);

const regradeExpansionCandidateSchema = z.union([
  z.object({
    evidence: z
      .array(
        z.object({
          column: z.number().optional(),
          detail: z.string().optional(),
          line: z.number().optional(),
          path: z.string(),
        })
      )
      .default([]),
    kind: z.enum(['file-rename', 'form', 'namespace', 'preserve']),
    reason: z.string().optional(),
    status: z.enum(['pending', 'rejected']).default('pending'),
    suggestedClassification: z.string(),
    value: z.string(),
  }),
  z
    .object({
      detail: z.string().optional(),
      path: z.string(),
      status: z.enum(['pending', 'rejected']).default('pending'),
    })
    .transform((candidate) => ({
      evidence: [
        {
          ...(candidate.detail === undefined
            ? {}
            : { detail: candidate.detail }),
          path: candidate.path,
        },
      ],
      kind: 'file-rename' as const,
      ...(candidate.detail === undefined ? {} : { reason: candidate.detail }),
      status: candidate.status,
      suggestedClassification: 'legacy-path-candidate',
      value: candidate.path,
    })),
]);

const regradePlanArtifactSchema = z
  .object({
    expansion: z
      .object({
        candidates: z.array(regradeExpansionCandidateSchema).default([]),
      })
      .optional(),
    kind: z.literal('regrade-plan'),
    path: z.string(),
    plan: vocabularyRegradePlanSchema,
    provenance: z.object({
      fields: z.record(z.string(), regradePlanProvenanceValueSchema),
    }),
    schemaVersion: z.literal(REGRADE_PLAN_SCHEMA_VERSION),
    sourceHash: z.string(),
  })
  .strict();

const regradePlanSummarySchema = z.object({
  expansionPending: z
    .number()
    .optional()
    .describe('Pending staged expansion candidates on this plan'),
  from: z.string(),
  path: z.string(),
  schemaVersion: z.number(),
  status: z.enum(['active', 'stale']),
  to: z.string(),
});

const regradePlansOutputSchema = z.object({
  plans: z.array(regradePlanSummarySchema),
});

const regradeCheckOutputSchema = regradeReportOutput.extend({
  check: z
    .object({
      plan: z.string().describe('Saved Regrade plan path that passed checks'),
      status: z.literal('passed').describe('Check result'),
    })
    .describe('Saved Regrade plan check result'),
});

const regradePlanInputSchema = regradePathScopeInputSchema.extend({
  configPath: z
    .string()
    .optional()
    .describe('Path to a Trails config file with regrade defaults'),
  expand: z
    .boolean()
    .default(false)
    .describe('Stage wide-net review candidates in the saved plan'),
  fresh: z
    .boolean()
    .default(false)
    .describe(
      'Replace an existing active plan instead of preserving authored fields'
    ),
  from: z.string().min(1).describe('Source vocabulary term or phrase'),
  includeEntries: z
    .enum(['actionable', 'all'])
    .default('actionable')
    .describe(
      'Report entry detail to inspect while deriving plan freshness and expansion'
    ),
  intent: z
    .string()
    .optional()
    .describe('Human-authored migration intent for a vocabulary regrade'),
  overrides: z
    .record(z.string().min(1), z.string().min(1))
    .optional()
    .describe('Explicit source-form to target-form mappings'),
  preserve: z
    .array(regradePreserveInputSchema)
    .optional()
    .describe(
      'Regex or literal contexts, or structured preserve rules, for a vocabulary regrade'
    ),
  rootDir: z.string().optional().describe('Workspace root directory'),
  to: z.string().min(1).describe('Target vocabulary term or phrase'),
  type: z
    .enum(['vocabulary'])
    .optional()
    .describe(
      'Optional plan type qualifier when a source/target pair is ambiguous'
    ),
});

const regradePlanReferenceInputSchema = z.object({
  includeEntries: z
    .enum(['actionable', 'all'])
    .default('actionable')
    .describe('Report entry detail to include while evaluating a saved plan'),
  plan: z
    .string()
    .optional()
    .describe('Plan name or path; omitted when exactly one active plan exists'),
  rootDir: z.string().optional().describe('Workspace root directory'),
});

const regradeApplyPlanInputSchema = regradePlanReferenceInputSchema;

type RegradePlanInput = z.output<typeof regradePlanInputSchema>;
type RegradePlanReferenceInput = z.output<
  typeof regradePlanReferenceInputSchema
>;
type RegradeApplyPlanInput = z.output<typeof regradeApplyPlanInputSchema>;

interface RegradePlanExpansion {
  readonly candidates: readonly {
    readonly evidence: readonly {
      readonly column?: number | undefined;
      readonly detail?: string | undefined;
      readonly line?: number | undefined;
      readonly path: string;
    }[];
    readonly kind: 'file-rename' | 'form' | 'namespace' | 'preserve';
    readonly reason?: string | undefined;
    readonly status: 'pending' | 'rejected';
    readonly suggestedClassification: string;
    readonly value: string;
  }[];
}

interface RegradePlanArtifact {
  readonly expansion?: RegradePlanExpansion | undefined;
  readonly kind: 'regrade-plan';
  readonly path: string;
  readonly plan: VocabularyRegradePlan;
  readonly provenance: {
    readonly fields: Readonly<Record<string, 'authored' | 'derived'>>;
  };
  readonly schemaVersion: typeof REGRADE_PLAN_SCHEMA_VERSION;
  readonly sourceHash: string;
}

const hasVocabularyInput = (input: RegradeInput) =>
  input.from !== undefined ||
  input.check ||
  input.include !== undefined ||
  input.intent !== undefined ||
  input.overrides !== undefined ||
  input.planRecord !== undefined ||
  input.preserve !== undefined ||
  input.to !== undefined;

const classModeCollection = (
  input: RegradeInput,
  configScope?: RegradeConfigScope | undefined
):
  | {
      readonly exclude?: readonly string[];
      readonly extensions?: readonly string[];
    }
  | undefined => {
  if (
    configScope?.exclude === undefined &&
    configScope?.extensions === undefined &&
    input.exclude === undefined &&
    input.extensions === undefined
  ) {
    return undefined;
  }

  return {
    ...(configScope?.exclude === undefined
      ? {}
      : { exclude: configScope.exclude }),
    ...(configScope?.extensions === undefined
      ? {}
      : { extensions: configScope.extensions }),
    ...(input.exclude === undefined ? {} : { exclude: input.exclude }),
    ...(input.extensions === undefined ? {} : { extensions: input.extensions }),
  };
};

interface RegradeConfigScope {
  readonly exclude?: PathScope['exclude'] | undefined;
  readonly extensions?: PathScope['extensions'] | undefined;
  readonly include?: PathScope['include'] | undefined;
}

interface RegradeCollectionScope {
  readonly exclude?: readonly string[];
  readonly extensions?: readonly string[];
  readonly include?: readonly string[];
}

const symbolSourceExtensions: readonly string[] = [
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
] as const;

const vocabularyProseExtensions: readonly string[] = [
  '.md',
  '.mdx',
  '.txt',
] as const;

const normalizeExtension = (extension: string): string =>
  extension === '' || extension.startsWith('.') ? extension : `.${extension}`;

const compileVocabularyPreservePattern = (pattern: string): RegExp => {
  try {
    return new RegExp(pattern);
  } catch {
    return new RegExp(pattern.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  }
};

const globalVocabularyPreservePattern = (pattern: RegExp): RegExp => {
  const flags = pattern.flags.includes('g')
    ? pattern.flags
    : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
};

const preservePatternOverlapsSpan = (
  pattern: RegExp,
  source: string,
  start: number,
  end: number
): boolean => {
  for (const match of source.matchAll(
    globalVocabularyPreservePattern(pattern)
  )) {
    const matchStart = match.index ?? 0;
    const matchEnd = matchStart + match[0].length;
    if (matchStart !== matchEnd && start < matchEnd && matchStart < end) {
      return true;
    }
  }
  return false;
};

const preserveRuleMatchesSymbolOccurrence = (
  rule: VocabularyPreserveRule,
  occurrence: {
    readonly form: string;
    readonly path: string;
    readonly source: string;
    readonly start: number;
    readonly end: number;
  }
): boolean => {
  if (rule.forms !== undefined && !rule.forms.includes(occurrence.form)) {
    return false;
  }
  if (
    rule.paths !== undefined &&
    !matchesAnyPathGlob(occurrence.path, rule.paths)
  ) {
    return false;
  }
  const pattern = compileVocabularyPreservePattern(rule.pattern);
  return (
    pattern.test(occurrence.form) ||
    preservePatternOverlapsSpan(
      pattern,
      occurrence.source,
      occurrence.start,
      occurrence.end
    )
  );
};

const symbolOccurrenceIsPreserved = (
  rules: readonly VocabularyPreserveRule[] | undefined,
  occurrence: {
    readonly form: string;
    readonly path: string;
    readonly source: string;
    readonly start: number;
    readonly end: number;
  }
): boolean =>
  rules?.some((rule) =>
    preserveRuleMatchesSymbolOccurrence(rule, occurrence)
  ) ?? false;

const vocabularyScopeFromConfig = (
  scope: RegradeConfigScope | undefined
): VocabularyRegradePlan['scope'] | undefined =>
  scope === undefined
    ? undefined
    : {
        ...(scope.exclude === undefined ? {} : { exclude: scope.exclude }),
        ...(scope.extensions === undefined
          ? {}
          : { extensions: scope.extensions }),
        ...(scope.include === undefined ? {} : { include: scope.include }),
      };

const vocabularyPreserveFromInput = (
  preserve: RegradeInput['preserve']
): readonly VocabularyPreserveRule[] | undefined =>
  preserve?.map((rule) => {
    if (typeof rule === 'string') {
      return { pattern: rule, reason: 'preserved-by-operator-input' };
    }

    return {
      ...(rule.disposition === undefined
        ? {}
        : { disposition: rule.disposition }),
      ...(rule.forms === undefined ? {} : { forms: rule.forms }),
      ...(rule.paths === undefined ? {} : { paths: rule.paths }),
      pattern: rule.pattern,
      ...(rule.reason === undefined ? {} : { reason: rule.reason }),
    };
  });

const vocabularyRegistryPlanForInput = (
  input: RegradeInput
): VocabularyRegradePlan | undefined =>
  listVocabularyRegradePlansFromRegistry().find(
    (plan) => plan.from === input.from && plan.to === input.to
  );

const uniqueSorted = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].toSorted((left, right) => left.localeCompare(right));

const uniqueInOrder = (values: readonly string[]): readonly string[] => [
  ...new Set(values),
];

const mergeScopeList = (
  left: readonly string[] | undefined,
  right: readonly string[] | undefined
): readonly string[] | undefined => {
  const merged = uniqueInOrder([...(left ?? []), ...(right ?? [])]);
  return merged.length === 0 ? undefined : merged;
};

const mergeVocabularyScope = (
  registryScope: VocabularyRegradePlan['scope'] | undefined,
  configScope: VocabularyRegradePlan['scope'] | undefined,
  input: Pick<RegradeInput, 'exclude' | 'extensions' | 'include'>
): VocabularyRegradePlan['scope'] | undefined => {
  const callerExclude = input.exclude ?? configScope?.exclude;
  const callerInclude = input.include ?? configScope?.include;
  const extensions =
    input.extensions ?? configScope?.extensions ?? registryScope?.extensions;
  const exclude = mergeScopeList(registryScope?.exclude, callerExclude);
  const include = mergeScopeList(registryScope?.include, callerInclude);

  if (
    exclude === undefined &&
    extensions === undefined &&
    include === undefined
  ) {
    return undefined;
  }

  return {
    ...(exclude === undefined ? {} : { exclude }),
    ...(extensions === undefined ? {} : { extensions }),
    ...(include === undefined ? {} : { include }),
  };
};

const mergeNumericRecords = (
  left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>
): Readonly<Record<string, number>> => {
  const keys = uniqueSorted([...Object.keys(left), ...Object.keys(right)]);
  return Object.fromEntries(
    keys.map((key) => [key, Math.max(left[key] ?? 0, right[key] ?? 0)])
  );
};

const sumNumericRecords = (
  left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>
): Readonly<Record<string, number>> => {
  const keys = uniqueSorted([...Object.keys(left), ...Object.keys(right)]);
  return Object.fromEntries(
    keys.map((key) => [key, (left[key] ?? 0) + (right[key] ?? 0)])
  );
};

const extensionForPath = (path: string): string => {
  const name = path.split('/').at(-1) ?? path;
  const dot = name.lastIndexOf('.');
  return dot <= 0 || dot === name.length - 1 ? '<none>' : name.slice(dot);
};

const topLevelForPath = (path: string): string => {
  const [segment] = path.split('/');
  return segment === undefined || segment.length === 0 ? '.' : segment;
};

const countFilesBy = (
  paths: readonly string[],
  keyForPath: (path: string) => string
): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const path of new Set(paths)) {
    const key = keyForPath(path);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

const countOccurrencesBy = (
  paths: readonly string[],
  keyForPath: (path: string) => string
): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const key = keyForPath(path);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

const sortBuckets = <T extends { readonly files: number }>(
  left: T & { readonly key: string },
  right: T & { readonly key: string }
): number => right.files - left.files || left.key.localeCompare(right.key);

const mergedDirectoryBuckets = (
  matchedPaths: readonly string[],
  occurrencePaths: readonly string[]
): readonly RegradeScanDirectoryBucket[] => {
  const fileCounts = countFilesBy(matchedPaths, topLevelForPath);
  const occurrenceCounts = countOccurrencesBy(occurrencePaths, topLevelForPath);
  const buckets: (RegradeScanDirectoryBucket & { readonly key: string })[] = [];
  for (const [path, files] of fileCounts.entries()) {
    buckets.push(
      occurrencePaths.length === 0
        ? { files, key: path, path }
        : {
            files,
            key: path,
            occurrences: occurrenceCounts.get(path) ?? 0,
            path,
          }
    );
  }
  return buckets
    .toSorted(sortBuckets)
    .map(({ key: _key, ...bucket }) => bucket);
};

const mergedExtensionBuckets = (
  matchedPaths: readonly string[],
  occurrencePaths: readonly string[]
): readonly RegradeScanExtensionBucket[] => {
  const fileCounts = countFilesBy(matchedPaths, extensionForPath);
  const occurrenceCounts = countOccurrencesBy(
    occurrencePaths,
    extensionForPath
  );
  const buckets: (RegradeScanExtensionBucket & { readonly key: string })[] = [];
  for (const [extension, files] of fileCounts.entries()) {
    buckets.push(
      occurrencePaths.length === 0
        ? { extension, files, key: extension }
        : {
            extension,
            files,
            key: extension,
            occurrences: occurrenceCounts.get(extension) ?? 0,
          }
    );
  }
  return buckets
    .toSorted(sortBuckets)
    .map(({ key: _key, ...bucket }) => bucket);
};

const actionableEntryPaths = (
  entries: readonly RegradeReportEntry[]
): readonly string[] =>
  entries.flatMap((entry) =>
    entry.outcome === 'rewrite' || entry.outcome === 'needs-review'
      ? [entry.path]
      : []
  );

const mergeApplySummary = (
  left: RegradeApplySummary | undefined,
  right: RegradeApplySummary | undefined
): RegradeApplySummary | undefined => {
  if (left === undefined && right === undefined) {
    return undefined;
  }

  const leftValue = left ?? {
    applied: 0,
    filesChanged: 0,
    review: 0,
    skipped: 0,
    unknown: 0,
  };
  const rightValue = right ?? {
    applied: 0,
    filesChanged: 0,
    review: 0,
    skipped: 0,
    unknown: 0,
  };

  return {
    applied: leftValue.applied + rightValue.applied,
    filesChanged: leftValue.filesChanged + rightValue.filesChanged,
    review: leftValue.review + rightValue.review,
    skipped: Math.max(leftValue.skipped, rightValue.skipped),
    unknown: leftValue.unknown + rightValue.unknown,
  };
};

type VocabularyTransitionRunReport = NonNullable<
  RegradeReport['run']
>['report'];

const transitionRunReportForRegradeReport = (
  report: RegradeReport
): VocabularyTransitionRunReport => {
  const applied = report.apply?.applied ?? 0;
  const filesChanged = report.apply?.filesChanged ?? 0;
  const modified = report.apply === undefined ? report.rewritten : 0;
  const deferred = report.review;
  const open =
    report.apply === undefined
      ? report.rewritten + report.review
      : report.review;
  const remainingByDisposition =
    open === 0 ? {} : { 'code-context-out-of-engine': open };
  const reasons = [
    ...(report.apply === undefined && report.rewritten > 0
      ? ['safe-modifications-not-yet-applied']
      : []),
    ...(report.review > 0 ? ['deferred-forms-or-occurrences'] : []),
  ];

  return {
    applied,
    deferred,
    dispositions: remainingByDisposition,
    filesChanged,
    gate: {
      reasons,
      remaining: open,
      remainingByDisposition,
      status: open === 0 ? 'green' : 'open',
    },
    modified,
    open,
    skipped: report.skipped,
  };
};

const mergeTransitionRunReportWithSymbol = (
  vocabularyReport: VocabularyTransitionRunReport,
  symbolReport: RegradeReport
): VocabularyTransitionRunReport => {
  const symbolRunReport = transitionRunReportForRegradeReport(symbolReport);
  const modified = vocabularyReport.modified + symbolRunReport.modified;
  const open = vocabularyReport.open + symbolRunReport.open;
  const dispositions = sumNumericRecords(
    vocabularyReport.dispositions,
    symbolRunReport.dispositions
  );
  const remainingByDisposition = sumNumericRecords(
    vocabularyReport.gate.remainingByDisposition,
    symbolRunReport.gate.remainingByDisposition
  );
  const reasons = uniqueSorted([
    ...vocabularyReport.gate.reasons,
    ...symbolRunReport.gate.reasons,
  ]);

  return {
    applied: vocabularyReport.applied + symbolRunReport.applied,
    deferred: vocabularyReport.deferred + symbolRunReport.deferred,
    dispositions,
    filesChanged: vocabularyReport.filesChanged + symbolRunReport.filesChanged,
    gate: {
      reasons,
      remaining: open,
      remainingByDisposition,
      status: open === 0 ? 'green' : 'open',
    },
    modified,
    open,
    skipped: vocabularyReport.skipped + symbolRunReport.skipped,
  };
};

const mergeRegradeReports = (
  vocabularyReport: RegradeReport,
  symbolReport: RegradeReport
): RegradeReport => {
  const entries = [
    ...vocabularyReport.entries,
    ...symbolReport.entries,
  ].toSorted(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      (left.classId ?? '').localeCompare(right.classId ?? '')
  );
  const matchedPaths = actionableEntryPaths(entries);
  const rewritten = new Set(
    entries
      .filter((entry) => entry.outcome === 'rewrite')
      .map((entry) => entry.path)
  ).size;
  const review = new Set(
    entries
      .filter((entry) => entry.outcome === 'needs-review')
      .map((entry) => entry.path)
  ).size;
  const matched = new Set(matchedPaths).size;
  const occurrencePaths =
    vocabularyReport.run?.ledger.occurrences.map(
      (occurrence) => occurrence.path
    ) ?? [];
  const skippedByReason = mergeNumericRecords(
    vocabularyReport.skipsByReason,
    symbolReport.skipsByReason
  );
  const apply = mergeApplySummary(vocabularyReport.apply, symbolReport.apply);
  const scanned = vocabularyReport.scanned + symbolReport.scanned;
  const run =
    vocabularyReport.run === undefined
      ? undefined
      : {
          ...vocabularyReport.run,
          report: mergeTransitionRunReportWithSymbol(
            vocabularyReport.run.report,
            symbolReport
          ),
        };

  return {
    ...vocabularyReport,
    ...(apply === undefined ? {} : { apply }),
    entries,
    matched,
    review,
    rewritten,
    scan: {
      byDirectory: mergedDirectoryBuckets(matchedPaths, occurrencePaths),
      byExtension: mergedExtensionBuckets(matchedPaths, occurrencePaths),
      files: {
        matched: new Set(matchedPaths).size,
        scanned,
        skipped: Math.max(vocabularyReport.skipped, symbolReport.skipped),
      },
      skippedByReason,
    },
    ...(run === undefined ? {} : { run }),
    scanned,
    selectedClassIds: uniqueSorted([
      ...vocabularyReport.selectedClassIds,
      ...symbolReport.selectedClassIds,
    ]),
    skipped: Math.max(vocabularyReport.skipped, symbolReport.skipped),
    skipsByReason: skippedByReason,
    unknownClassIds: uniqueSorted([
      ...vocabularyReport.unknownClassIds,
      ...symbolReport.unknownClassIds,
    ]),
  };
};

const vocabularySymbolCollection = (
  scope: VocabularyRegradePlan['scope'] | undefined
): RegradeCollectionScope | null | undefined => {
  const exclude = scope?.exclude;
  const extensions = scope?.extensions;
  const include = scope?.include;
  const explicitExtensions = extensions !== undefined;
  const codeExtensions =
    extensions === undefined
      ? symbolSourceExtensions
      : uniqueSorted(
          extensions
            .map(normalizeExtension)
            .filter((extension) => symbolSourceExtensions.includes(extension))
        );
  if (explicitExtensions && codeExtensions.length === 0) {
    return null;
  }
  if (
    exclude === undefined &&
    codeExtensions.length === 0 &&
    include === undefined
  ) {
    return undefined;
  }
  return {
    ...(exclude === undefined ? {} : { exclude }),
    ...(codeExtensions.length === 0 ? {} : { extensions: codeExtensions }),
    ...(include === undefined ? {} : { include }),
  };
};

const vocabularyProseScope = (
  scope: VocabularyRegradePlan['scope'] | undefined
): NonNullable<VocabularyRegradePlan['scope']> | null => {
  const explicitExtensions = scope?.extensions !== undefined;
  const extensions =
    scope?.extensions === undefined
      ? vocabularyProseExtensions
      : uniqueSorted(
          scope.extensions
            .map(normalizeExtension)
            .filter((extension) =>
              vocabularyProseExtensions.includes(extension)
            )
        );

  if (explicitExtensions && extensions.length === 0) {
    return null;
  }

  return {
    ...(scope?.exclude === undefined ? {} : { exclude: scope.exclude }),
    extensions,
    ...(scope?.ignoredDirectories === undefined
      ? {}
      : { ignoredDirectories: scope.ignoredDirectories }),
    ...(scope?.include === undefined ? {} : { include: scope.include }),
  };
};

const vocabularyProsePlan = (
  plan: VocabularyRegradePlan
): VocabularyRegradePlan | null => {
  const scope = vocabularyProseScope(plan.scope);
  if (scope === null) {
    return null;
  }

  return { ...plan, scope };
};

const mergeVocabularyOverrides = (
  registryPlan: VocabularyRegradePlan | undefined,
  input: z.output<typeof regradeInputSchema>
): VocabularyRegradePlan['overrides'] | undefined => {
  const overrides = {
    ...registryPlan?.overrides,
    ...input.overrides,
  };
  return Object.keys(overrides).length === 0 ? undefined : overrides;
};

const mergeVocabularyPreserveRules = (
  registryPlan: VocabularyRegradePlan | undefined,
  preserve: readonly VocabularyPreserveRule[] | undefined
): readonly VocabularyPreserveRule[] | undefined => {
  const rules = [...(registryPlan?.preserve ?? []), ...(preserve ?? [])];
  return rules.length === 0 ? undefined : rules;
};

const vocabularyIntentForInput = (
  input: z.output<typeof regradeInputSchema>,
  registryPlan: VocabularyRegradePlan | undefined
): string | undefined => {
  if (input.intent !== undefined) {
    return input.intent;
  }
  return registryPlan?.intent;
};

const buildVocabularyPlan = (
  input: RegradeInput,
  configScope?: VocabularyRegradePlan['scope']
): TrailsResult<VocabularyRegradePlan, ValidationError> => {
  if (input.from === undefined || input.to === undefined) {
    return Result.err(
      new ValidationError('A vocabulary regrade requires both `from` and `to`.')
    );
  }
  if (input.classIds !== undefined) {
    return Result.err(
      new ValidationError(
        '`classIds` selects class-mode Regrade and cannot be combined with vocabulary-regrade `from`/`to`.'
      )
    );
  }

  const preserve = vocabularyPreserveFromInput(input.preserve);
  const registryPlan = vocabularyRegistryPlanForInput(input);
  const intent = vocabularyIntentForInput(input, registryPlan);
  const overrides = mergeVocabularyOverrides(registryPlan, input);
  const preserveRules = mergeVocabularyPreserveRules(registryPlan, preserve);
  const scope = mergeVocabularyScope(registryPlan?.scope, configScope, input);

  return Result.ok({
    ...(registryPlan?.caseSensitive === undefined
      ? {}
      : { caseSensitive: registryPlan.caseSensitive }),
    ...(registryPlan?.deferForms === undefined
      ? {}
      : { deferForms: registryPlan.deferForms }),
    from: input.from,
    id: registryPlan?.id ?? `vocabulary:${input.from}->${input.to}`,
    kind: 'vocabulary',
    ...(intent === undefined ? {} : { intent }),
    ...(overrides === undefined ? {} : { overrides }),
    ...(preserveRules === undefined ? {} : { preserve: preserveRules }),
    ...(scope === undefined ? {} : { scope }),
    to: input.to,
  });
};

const regradeRootNotFound = (rootDir: string) =>
  Result.err(
    new NotFoundError(
      `Regrade root "${rootDir}" could not be read as a directory.`
    )
  );

const regradeNoEngineForScope = () =>
  Result.err(
    new ValidationError(
      'Vocabulary regrade has no prose or governed symbol engine for the selected extension scope.'
    )
  );

const regradeRootIsReadable = (rootDir: string): boolean => {
  try {
    readdirSync(rootDir, { withFileTypes: true });
    return true;
  } catch {
    return false;
  }
};

const validateRegradeReport = (
  report: RegradeReport
): TrailsResult<RegradeReport, Error> => {
  const validated = validateOutput(regradeReportOutput, report);
  if (validated.isErr()) {
    return validated;
  }
  return Result.ok(report);
};

const reportWithVocabularyTransitionRun = (params: {
  readonly plan: VocabularyRegradePlan;
  readonly preserveInventory: readonly VocabularyPreserveInventoryEntry[];
  readonly report: RegradeReport;
}): RegradeReport => {
  const preserveInventory =
    params.preserveInventory.length === 0
      ? params.report.run?.preserveInventory
      : params.preserveInventory;
  const run = params.report.run ?? {
    ledger: { cycle: 1, forms: {}, occurrences: [] },
    plan: params.plan,
    report: transitionRunReportForRegradeReport(params.report),
  };

  return {
    ...params.report,
    run: {
      ...run,
      plan: params.plan,
      ...(preserveInventory === undefined ? {} : { preserveInventory }),
      report:
        params.report.run === undefined
          ? transitionRunReportForRegradeReport(params.report)
          : params.report.run.report,
    },
  };
};

const runGovernedSymbolRegrade = (params: {
  readonly apply: boolean;
  readonly includeEntries: RegradeInput['includeEntries'];
  readonly plan: VocabularyRegradePlan;
  readonly preserveInventory: readonly VocabularyPreserveInventoryEntry[];
  readonly rootDir: string;
}): TrailsResult<RegradeReport | null, Error> => {
  const transition = vocabularyRegradeTransitionForInput(
    params.plan.from,
    params.plan.to
  );
  if (transition === undefined) {
    return Result.ok(null);
  }

  const symbolCollection = vocabularySymbolCollection(params.plan.scope);
  if (symbolCollection === null) {
    return Result.ok(null);
  }
  return runRegrade({
    apply: params.apply,
    classes: createGovernedAstIdentifierRenameClasses(
      {
        ...transition,
        symbolRenames: transition.symbolRenames,
      },
      {
        shouldPreserve: (occurrence) =>
          symbolOccurrenceIsPreserved(params.plan.preserve, {
            end: occurrence.end,
            form: occurrence.from,
            path: occurrence.path,
            source: occurrence.source,
            start: occurrence.start,
          }) ||
          symbolOccurrenceIsPreserved(params.preserveInventory, {
            end: occurrence.end,
            form: occurrence.from,
            path: occurrence.path,
            source: occurrence.source,
            start: occurrence.start,
          }),
      }
    ),
    ...(symbolCollection === undefined ? {} : { collection: symbolCollection }),
    includeEntries: params.includeEntries,
    root: params.rootDir,
  });
};

const vocabularyRecordPathForInput = (
  rootDir: string,
  recordPath: string
): string => (isAbsolute(recordPath) ? recordPath : join(rootDir, recordPath));

const currentCommitSha = (rootDir: string): string | undefined => {
  try {
    return execFileSync(
      'git',
      ['-C', rootDir, 'rev-parse', '--short=7', 'HEAD'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    ).trim();
  } catch {
    return undefined;
  }
};

const vocabularyRecordEnvironment = (
  rootDir: string
): { readonly commitSha?: string; readonly root: string } => {
  const commitSha = currentCommitSha(rootDir);
  return {
    ...(commitSha === undefined ? {} : { commitSha }),
    root: rootDir,
  };
};

const regradePlanSlug = (plan: Pick<VocabularyRegradePlan, 'from' | 'to'>) =>
  `${plan.from}-to-${plan.to}`
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');

const normalizeRelativePath = (path: string): string =>
  normalize(path).replaceAll('\\', '/');

const rootRelativePath = (rootDir: string, absolutePath: string): string =>
  normalizeRelativePath(relative(rootDir, absolutePath));

const regradePlanDirectory = (rootDir: string): string =>
  join(rootDir, '.trails', 'regrade');

const regradePlanPathForPlan = (
  rootDir: string,
  plan: Pick<VocabularyRegradePlan, 'from' | 'to'>
): string =>
  join(regradePlanDirectory(rootDir), `${regradePlanSlug(plan)}.json`);

const sourceHashEntryFacts = (
  entries: readonly RegradeReportEntry[]
): readonly Pick<
  RegradeReportEntry,
  'classId' | 'notes' | 'outcome' | 'path' | 'reason' | 'reviewDetails'
>[] =>
  entries
    .filter(
      (entry) => entry.outcome === 'rewrite' || entry.outcome === 'needs-review'
    )
    .map(({ classId, notes, outcome, path, reason, reviewDetails }) => ({
      ...(classId === undefined ? {} : { classId }),
      ...(notes === undefined ? {} : { notes }),
      outcome,
      path,
      ...(reason === undefined ? {} : { reason }),
      ...(reviewDetails === undefined ? {} : { reviewDetails }),
    }));

const regradeSourceHash = (report: RegradeReport): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        entries: sourceHashEntryFacts(report.entries),
        ledger: report.run?.ledger,
        selectedClassIds: report.selectedClassIds,
      })
    )
    .digest('hex');

const regradeHistoryPathForReport = (
  rootDir: string,
  report: RegradeReport
): string => {
  const { run } = report;
  const slug =
    run === undefined
      ? 'unknown-regrade'
      : regradePlanSlug({ from: run.plan.from, to: run.plan.to });
  const hash = createHash('sha256')
    .update(regradeSourceHash(report))
    .digest('hex')
    .slice(0, 7);
  return join(regradePlanDirectory(rootDir), 'history', `${slug}-${hash}.json`);
};

const pendingExpansionCandidateCount = (plan: RegradePlanArtifact): number =>
  plan.expansion?.candidates.filter(
    (candidate) => candidate.status === 'pending'
  ).length ?? 0;

const reportWithPlanSummary = (
  report: RegradeReport,
  plan: RegradePlanArtifact,
  status: 'active' | 'stale'
): RegradeReport => ({
  ...report,
  plan: {
    ...(pendingExpansionCandidateCount(plan) === 0
      ? {}
      : { expansionPending: pendingExpansionCandidateCount(plan) }),
    path: plan.path,
    schemaVersion: plan.schemaVersion,
    status,
  },
});

const reportWithHistorySummary = (
  report: RegradeReport,
  params: { readonly path: string; readonly schemaVersion: number }
): RegradeReport => ({
  ...report,
  history: {
    path: params.path,
    schemaVersion: params.schemaVersion,
    status: 'applied',
  },
});

const authoredPlanFieldKeys = [
  'caseSensitive',
  'deferForms',
  'id',
  'intent',
  'overrides',
  'preserve',
  'scope',
] as const;

const isAuthoredPlanField = (
  input: RegradePlanInput,
  key: (typeof authoredPlanFieldKeys)[number]
): boolean => {
  switch (key) {
    case 'intent':
    case 'overrides':
    case 'preserve': {
      return input[key] !== undefined;
    }
    case 'scope': {
      return (
        input.exclude !== undefined ||
        input.extensions !== undefined ||
        input.include !== undefined
      );
    }
    default: {
      return false;
    }
  }
};

const regradePlanProvenanceForInput = (
  input: RegradePlanInput,
  plan: VocabularyRegradePlan
): RegradePlanArtifact['provenance'] => {
  const fields: Record<string, 'authored' | 'derived'> = {
    from: 'authored',
    kind: 'derived',
    to: 'authored',
  };

  for (const key of [
    'caseSensitive',
    'deferForms',
    'id',
    'intent',
    'overrides',
    'preserve',
    'scope',
  ] as const) {
    if (plan[key] !== undefined) {
      fields[key] = isAuthoredPlanField(input, key) ? 'authored' : 'derived';
    }
  }

  return { fields };
};

const mergeAuthoredPlanFields = (
  current: RegradePlanArtifact,
  plan: VocabularyRegradePlan
): VocabularyRegradePlan => {
  const merged: Record<string, unknown> = { ...plan };
  for (const key of authoredPlanFieldKeys) {
    if (
      current.provenance.fields[key] === 'authored' &&
      current.plan[key] !== undefined
    ) {
      Object.assign(merged, { [key]: current.plan[key] });
    }
  }
  return vocabularyRegradePlanSchema.parse(merged) as VocabularyRegradePlan;
};

const preserveAuthoredPlanProvenance = (
  current: RegradePlanArtifact,
  provenance: RegradePlanArtifact['provenance']
): RegradePlanArtifact['provenance'] => {
  const fields = { ...provenance.fields };
  for (const key of authoredPlanFieldKeys) {
    if (
      current.provenance.fields[key] === 'authored' &&
      current.plan[key] !== undefined
    ) {
      fields[key] = 'authored';
    }
  }
  return { fields };
};

const buildRegradePlanArtifact = (params: {
  readonly expansion?: RegradePlanArtifact['expansion'];
  readonly input: RegradePlanInput;
  readonly plan: VocabularyRegradePlan;
  readonly report: RegradeReport;
  readonly rootDir: string;
}): RegradePlanArtifact => {
  const absolutePath = regradePlanPathForPlan(params.rootDir, params.plan);
  return {
    ...(params.expansion === undefined ? {} : { expansion: params.expansion }),
    kind: 'regrade-plan',
    path: rootRelativePath(params.rootDir, absolutePath),
    plan: params.plan,
    provenance: regradePlanProvenanceForInput(params.input, params.plan),
    schemaVersion: REGRADE_PLAN_SCHEMA_VERSION,
    sourceHash: regradeSourceHash(params.report),
  };
};

const writeRegradePlanArtifact = (
  rootDir: string,
  artifact: RegradePlanArtifact
): TrailsResult<RegradePlanArtifact, InternalError | ValidationError> => {
  const parsed = regradePlanArtifactSchema.safeParse(artifact);
  if (!parsed.success) {
    return Result.err(
      new ValidationError('Invalid Regrade plan artifact.', {
        context: { issues: parsed.error.issues },
      })
    );
  }
  const absolutePath = join(rootDir, artifact.path);
  try {
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, `${JSON.stringify(parsed.data, null, 2)}\n`);
  } catch (error) {
    return Result.err(
      new InternalError('Failed to write Regrade plan artifact.', {
        ...(error instanceof Error ? { cause: error } : {}),
        context: { path: artifact.path },
      })
    );
  }
  return Result.ok(parsed.data as unknown as RegradePlanArtifact);
};

const validateRegradePlanArtifact = (
  artifact: RegradePlanArtifact
): TrailsResult<RegradePlanArtifact, ValidationError> => {
  const parsed = regradePlanArtifactSchema.safeParse(artifact);
  if (!parsed.success) {
    return Result.err(
      new ValidationError('Invalid Regrade plan artifact.', {
        context: { issues: parsed.error.issues },
      })
    );
  }
  return Result.ok(parsed.data as unknown as RegradePlanArtifact);
};

const readRegradePlanArtifact = (
  path: string
): TrailsResult<RegradePlanArtifact, InternalError | ValidationError> => {
  if (!existsSync(path)) {
    return Result.err(new ValidationError(`Regrade plan "${path}" not found.`));
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return Result.err(
      new InternalError('Failed to read Regrade plan artifact.', {
        ...(error instanceof Error ? { cause: error } : {}),
        context: { path },
      })
    );
  }
  const parsed = regradePlanArtifactSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return Result.err(
      new ValidationError('Invalid Regrade plan artifact.', {
        context: { issues: parsed.error.issues, path },
      })
    );
  }
  return Result.ok(parsed.data as unknown as RegradePlanArtifact);
};

const hasPathSeparator = (value: string): boolean =>
  value.includes('/') || value.includes('\\');

const isPlanPathReference = (value: string): boolean =>
  hasPathSeparator(value) ||
  value.startsWith('.') ||
  value.startsWith('~') ||
  isAbsolute(value);

const collectActiveRegradePlanPaths = (rootDir: string): string[] => {
  const results: string[] = [];
  const skipDirectories = new Set([
    '.git',
    '.next',
    '.turbo',
    'dist',
    'node_modules',
  ]);

  const visit = (dir: string): void => {
    let entries: Dirent[] | undefined;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries === undefined) {
      return;
    }

    if (
      entries.some((entry) => entry.isDirectory() && entry.name === '.trails')
    ) {
      const regradeDir = join(dir, '.trails', 'regrade');
      try {
        for (const entry of readdirSync(regradeDir, { withFileTypes: true })) {
          if (entry.isFile() && entry.name.endsWith('.json')) {
            results.push(join(regradeDir, entry.name));
          }
        }
      } catch {
        // Not every `.trails` directory has Regrade plans.
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || skipDirectories.has(entry.name)) {
        continue;
      }
      visit(join(dir, entry.name));
    }
  };

  visit(rootDir);
  return results.toSorted((left, right) => left.localeCompare(right));
};

const resolveRegradePlanPath = (
  rootDir: string,
  planRef?: string | undefined
): TrailsResult<string, ValidationError> => {
  if (planRef !== undefined) {
    if (isPlanPathReference(planRef)) {
      const normalized = planRef.startsWith('~/')
        ? join(process.env['HOME'] ?? '', planRef.slice(2))
        : planRef;
      return Result.ok(
        isAbsolute(normalized) ? normalized : join(rootDir, normalized)
      );
    }
    const normalizedRef = planRef.endsWith('.json')
      ? planRef.slice(0, -'.json'.length)
      : planRef;
    const matches = collectActiveRegradePlanPaths(rootDir).filter(
      (candidate) => basename(candidate, '.json') === normalizedRef
    );
    if (matches.length === 1) {
      return Result.ok(matches[0] as string);
    }
    if (matches.length === 0) {
      return Result.err(
        new ValidationError(`No active Regrade plan named "${planRef}" found.`)
      );
    }
    return Result.err(
      new ValidationError(
        `Multiple active Regrade plans named "${planRef}" found.`,
        {
          context: {
            matches: matches.map((match) => rootRelativePath(rootDir, match)),
          },
        }
      )
    );
  }

  const plans = collectActiveRegradePlanPaths(rootDir);
  if (plans.length === 1) {
    return Result.ok(plans[0] as string);
  }
  if (plans.length === 0) {
    return Result.err(new ValidationError('No active Regrade plans found.'));
  }
  return Result.err(
    new ValidationError('Multiple active Regrade plans found; pass `--plan`.', {
      context: { plans: plans.map((plan) => rootRelativePath(rootDir, plan)) },
    })
  );
};

const planStatusForReport = (
  artifact: RegradePlanArtifact,
  report: RegradeReport
): 'active' | 'stale' =>
  artifact.sourceHash === regradeSourceHash(report) ? 'active' : 'stale';

const regradePlanGateContext = (
  report: RegradeReport
):
  | {
      readonly gate?: unknown;
      readonly modified?: number;
      readonly review?: number;
    }
  | undefined => {
  const { apply, review, rewritten } = report;
  const modified = apply === undefined ? rewritten : 0;
  const counts = {
    ...(modified === 0 ? {} : { modified }),
    ...(review === 0 ? {} : { review }),
  };
  if (report.run?.report.gate.status !== 'green') {
    return { gate: report.run?.report.gate, ...counts };
  }
  if (modified > 0 || review > 0) {
    return { gate: report.run?.report.gate, ...counts };
  }
  return undefined;
};

const persistVocabularyRecord = (params: {
  readonly report: RegradeReport;
  readonly rootDir: string;
  readonly status: 'applied' | 'candidate' | 'checked';
}): TrailsResult<RegradeReport, Error> => {
  const recordResult = writeVocabularyTransitionRecord({
    environment: vocabularyRecordEnvironment(params.rootDir),
    report: params.report,
    root: params.rootDir,
    status: params.status,
  });
  if (recordResult.isErr()) {
    return recordResult;
  }
  return validateRegradeReport(
    transitionRecordReportWithSummary(params.report, recordResult.value.summary)
  );
};

const runResolvedVocabularyPlan = (params: {
  readonly apply: boolean;
  readonly includeEntries: RegradeInput['includeEntries'];
  readonly plan: VocabularyRegradePlan;
  readonly preserveInventory: readonly VocabularyPreserveInventoryEntry[];
  readonly rootDir: string;
}): TrailsResult<RegradeReport, Error> => {
  const prosePlan = vocabularyProsePlan(params.plan);
  const reportResult: TrailsResult<RegradeReport | null, Error> =
    prosePlan === null
      ? Result.ok(null)
      : runVocabularyRegrade({
          apply: params.apply,
          includeEntries: params.includeEntries,
          plan: prosePlan,
          ...(params.preserveInventory.length === 0
            ? {}
            : { preserveInventory: params.preserveInventory }),
          root: params.rootDir,
        });
  if (reportResult.isErr()) {
    return reportResult;
  }

  const symbolReportResult = runGovernedSymbolRegrade({
    apply: params.apply,
    includeEntries: params.includeEntries,
    plan: params.plan,
    preserveInventory: params.preserveInventory,
    rootDir: params.rootDir,
  });
  if (symbolReportResult.isErr()) {
    return symbolReportResult;
  }

  const report = reportResult.value;
  const symbolReport = symbolReportResult.value;
  if (report === null) {
    if (symbolReport === null) {
      return regradeNoEngineForScope();
    }
    return validateRegradeReport(
      reportWithVocabularyTransitionRun({
        plan: params.plan,
        preserveInventory: params.preserveInventory,
        report: symbolReport,
      })
    );
  }

  const validated = validateRegradeReport(
    reportWithVocabularyTransitionRun({
      plan: params.plan,
      preserveInventory: params.preserveInventory,
      report,
    })
  );
  if (validated.isErr()) {
    return validated;
  }
  if (symbolReport === null) {
    return Result.ok(validated.value);
  }

  return validateRegradeReport(
    reportWithVocabularyTransitionRun({
      plan: params.plan,
      preserveInventory: params.preserveInventory,
      report: mergeRegradeReports(report, symbolReport),
    })
  );
};

const runPlanArtifactDryRun = async (params: {
  readonly artifact: RegradePlanArtifact;
  readonly includeEntries: RegradePlanReferenceInput['includeEntries'];
  readonly rootDir: string;
}): Promise<TrailsResult<RegradeReport, Error>> => {
  const preserveInventory = await deriveLiveApiPreserveInventory(
    params.artifact.plan
  );
  return runResolvedVocabularyPlan({
    apply: false,
    includeEntries: params.includeEntries,
    plan: params.artifact.plan,
    preserveInventory,
    rootDir: params.rootDir,
  });
};

const runLegacyVocabularyRecordRegrade = (
  input: RegradeInput,
  rootDir: string,
  absoluteRecordPath: string
): TrailsResult<RegradeReport, Error> => {
  const recordResult = readVocabularyTransitionRecord(absoluteRecordPath);
  if (recordResult.isErr()) {
    return recordResult;
  }
  const record = recordResult.value;
  if (record.report.run === undefined) {
    return Result.err(
      new ValidationError(
        'Transition record does not contain a vocabulary run.'
      )
    );
  }
  const dryRun = runResolvedVocabularyPlan({
    apply: false,
    includeEntries: input.includeEntries,
    plan: record.report.run.plan,
    preserveInventory: record.report.run.preserveInventory ?? [],
    rootDir,
  });
  if (dryRun.isErr()) {
    return dryRun;
  }
  if (regradeSourceHash(dryRun.value) !== regradeSourceHash(record.report)) {
    return Result.err(
      new ValidationError(
        'Vocabulary transition record is stale for the current source tree. Re-run discovery and review the new record before applying.',
        { context: { recordPath: record.recordPath } }
      )
    );
  }
  if (input.check) {
    const checked = transitionRecordReportWithSummary(record.report, {
      path: record.recordPath,
      schemaVersion: record.schemaVersion,
      status: 'checked',
    });
    if (record.report.run.report.gate.status !== 'green') {
      return Result.err(
        new ValidationError('Vocabulary transition record gate is open.', {
          context: {
            gate: record.report.run.report.gate,
            recordPath: record.recordPath,
          },
        })
      );
    }
    return validateRegradeReport(checked);
  }

  if (!input.apply) {
    return Result.err(
      new ValidationError(
        'Applying a legacy vocabulary transition record requires `apply: true` or `--apply`. Use `--check` to verify the record without mutating source.',
        { context: { recordPath: record.recordPath } }
      )
    );
  }

  const applied = runResolvedVocabularyPlan({
    apply: true,
    includeEntries: input.includeEntries,
    plan: record.report.run.plan,
    preserveInventory: record.report.run.preserveInventory ?? [],
    rootDir,
  });
  if (applied.isErr()) {
    return applied;
  }
  return persistVocabularyRecord({
    report: applied.value,
    rootDir,
    status: 'applied',
  });
};

const runVocabularyCommandRegrade = async (
  input: RegradeInput,
  rootDir: string,
  configScope?: RegradeConfigScope | undefined
): Promise<TrailsResult<RegradeReport, Error>> => {
  if (input.apply && input.planRecord === undefined) {
    return Result.err(
      new ValidationError(
        'Vocabulary regrade apply requires `planRecord`. Run discovery with `writeRecord` first, review the record, then apply the confirmed record.'
      )
    );
  }
  if (input.check && input.planRecord === undefined) {
    return Result.err(
      new ValidationError(
        'Vocabulary regrade check requires `planRecord` so the gate is computed from persisted evidence.'
      )
    );
  }
  if (input.planRecord !== undefined) {
    const absoluteRecordPath = vocabularyRecordPathForInput(
      rootDir,
      input.planRecord
    );
    return runLegacyVocabularyRecordRegrade(input, rootDir, absoluteRecordPath);
  }

  const planResult = buildVocabularyPlan(
    input,
    vocabularyScopeFromConfig(configScope)
  );
  if (planResult.isErr()) {
    return planResult;
  }
  if (!regradeRootIsReadable(rootDir)) {
    return regradeRootNotFound(rootDir);
  }

  const preserveInventory = await deriveLiveApiPreserveInventory(
    planResult.value
  );
  const report = runResolvedVocabularyPlan({
    apply: input.apply,
    includeEntries: input.includeEntries,
    plan: planResult.value,
    preserveInventory,
    rootDir,
  });
  if (report.isErr() || !input.writeRecord) {
    return report;
  }
  return persistVocabularyRecord({
    report: report.value,
    rootDir,
    status: input.apply ? 'applied' : 'candidate',
  });
};

const expansionCandidateKey = (
  candidate: RegradePlanExpansion['candidates'][number]
): string =>
  [candidate.kind, candidate.value, candidate.suggestedClassification].join(
    '\0'
  );

const expansionEvidenceKey = (
  evidence: RegradePlanExpansion['candidates'][number]['evidence'][number]
): string =>
  [
    evidence.path,
    evidence.line ?? '',
    evidence.column ?? '',
    evidence.detail ?? '',
  ].join('\0');

const mergeExpansionEvidence = (
  left: RegradePlanExpansion['candidates'][number]['evidence'],
  right: RegradePlanExpansion['candidates'][number]['evidence']
): RegradePlanExpansion['candidates'][number]['evidence'] => {
  const merged = new Map<
    string,
    RegradePlanExpansion['candidates'][number]['evidence'][number]
  >();
  for (const evidence of [...left, ...right]) {
    merged.set(expansionEvidenceKey(evidence), evidence);
  }
  return [...merged.values()].toSorted((a, b) =>
    a.path === b.path
      ? (a.line ?? 0) - (b.line ?? 0) ||
        (a.column ?? 0) - (b.column ?? 0) ||
        (a.detail ?? '').localeCompare(b.detail ?? '')
      : a.path.localeCompare(b.path)
  );
};

const compareCandidates = (
  left: RegradePlanExpansion['candidates'][number],
  right: RegradePlanExpansion['candidates'][number]
): number => {
  if (left.kind !== right.kind) {
    return left.kind.localeCompare(right.kind);
  }
  if (left.value !== right.value) {
    return left.value.localeCompare(right.value);
  }
  return left.suggestedClassification.localeCompare(
    right.suggestedClassification
  );
};

const expansionForReport = (
  report: RegradeReport
): RegradePlanArtifact['expansion'] => {
  const candidates = new Map<
    string,
    RegradePlanExpansion['candidates'][number]
  >();
  const candidateValues = new Set<string>();
  const addCandidate = (
    candidate: RegradePlanExpansion['candidates'][number]
  ): void => {
    const key = expansionCandidateKey(candidate);
    candidateValues.add(`${candidate.kind}\0${candidate.value}`);
    const current = candidates.get(key);
    if (current === undefined) {
      candidates.set(key, candidate);
      return;
    }
    candidates.set(key, {
      ...current,
      evidence: mergeExpansionEvidence(current.evidence, candidate.evidence),
    });
  };

  for (const occurrence of report.run?.ledger.occurrences ?? []) {
    if (occurrence.verdict !== 'deferred') {
      continue;
    }
    addCandidate({
      evidence: [
        {
          column: occurrence.column,
          detail: occurrence.reason,
          line: occurrence.line,
          path: occurrence.path,
        },
      ],
      kind: 'form',
      status: 'pending',
      suggestedClassification: occurrence.disposition,
      value: occurrence.form,
    });
  }

  for (const entry of report.entries) {
    if (entry.outcome !== 'needs-review' || entry.reviewDetails === undefined) {
      continue;
    }
    for (const detail of entry.reviewDetails) {
      if (detail.symbol === undefined) {
        continue;
      }
      if (candidateValues.has(`form\0${detail.symbol}`)) {
        continue;
      }
      addCandidate({
        evidence: [
          {
            ...(detail.span === undefined
              ? {}
              : {
                  column: detail.span.column,
                  line: detail.span.line,
                }),
            detail: detail.reason,
            path: entry.path,
          },
        ],
        kind: 'form',
        status: 'pending',
        suggestedClassification: entry.reason ?? detail.reason,
        value: detail.symbol,
      });
    }
  }

  return { candidates: [...candidates.values()].toSorted(compareCandidates) };
};

const preserveRuleCoversForm = (
  rule: VocabularyPreserveRule,
  form: string
): boolean =>
  (rule.forms === undefined || rule.forms.includes(form)) &&
  compileVocabularyPreservePattern(rule.pattern).test(form);

const preserveRuleCoversCandidateEvidence = (
  rule: VocabularyPreserveRule,
  form: string,
  evidence: RegradePlanExpansion['candidates'][number]['evidence'][number]
): boolean =>
  preserveRuleCoversForm(rule, form) &&
  (rule.paths === undefined || matchesAnyPathGlob(evidence.path, rule.paths));

const preserveRulesCoverFormCandidate = (
  preserve: readonly VocabularyPreserveRule[] | undefined,
  candidate: RegradePlanExpansion['candidates'][number]
): boolean => {
  if (preserve === undefined) {
    return false;
  }
  if (candidate.kind !== 'form') {
    return false;
  }

  if (candidate.evidence.length === 0) {
    return preserve.some(
      (rule) =>
        rule.paths === undefined &&
        preserveRuleCoversForm(rule, candidate.value)
    );
  }

  return candidate.evidence.every((evidence) =>
    preserve.some((rule) =>
      preserveRuleCoversCandidateEvidence(rule, candidate.value, evidence)
    )
  );
};

const primaryPlanCoversExpansionCandidate = (
  plan: VocabularyRegradePlan,
  candidate: RegradePlanExpansion['candidates'][number]
): boolean => {
  if (candidate.kind !== 'form') {
    return false;
  }
  return (
    plan.deferForms?.includes(candidate.value) === true ||
    plan.overrides?.[candidate.value] !== undefined ||
    preserveRulesCoverFormCandidate(plan.preserve, candidate)
  );
};

const mergeRegradePlanExpansion = (
  current: RegradePlanExpansion | undefined,
  next: RegradePlanExpansion | undefined,
  plan: VocabularyRegradePlan
): RegradePlanExpansion | undefined => {
  const candidates = new Map<
    string,
    RegradePlanExpansion['candidates'][number]
  >();

  for (const candidate of current?.candidates ?? []) {
    if (primaryPlanCoversExpansionCandidate(plan, candidate)) {
      continue;
    }
    candidates.set(expansionCandidateKey(candidate), candidate);
  }

  for (const candidate of next?.candidates ?? []) {
    if (primaryPlanCoversExpansionCandidate(plan, candidate)) {
      continue;
    }
    const key = expansionCandidateKey(candidate);
    const existing = candidates.get(key);
    if (existing?.status === 'rejected') {
      candidates.set(key, existing);
      continue;
    }
    candidates.set(key, {
      ...candidate,
      ...(existing === undefined
        ? {}
        : {
            evidence: mergeExpansionEvidence(
              existing.evidence,
              candidate.evidence
            ),
            status: existing.status,
          }),
    });
  }

  const merged = [...candidates.values()]
    .filter(
      (candidate) => !primaryPlanCoversExpansionCandidate(plan, candidate)
    )
    .toSorted(compareCandidates);
  return merged.length === 0 ? undefined : { candidates: merged };
};

const runPlanRegrade = async (
  input: RegradePlanInput,
  rootDir: string,
  configScope?: RegradeConfigScope | undefined,
  shouldDryRun = false
): Promise<TrailsResult<RegradePlanArtifact, Error>> => {
  if (input.type !== undefined && input.type !== 'vocabulary') {
    return Result.err(
      new ValidationError(`Unsupported Regrade plan type "${input.type}".`)
    );
  }
  const planInput: RegradeInput = {
    ...input,
    apply: false,
    check: false,
    writeRecord: false,
  };
  const planResult = buildVocabularyPlan(
    planInput,
    vocabularyScopeFromConfig(configScope)
  );
  if (planResult.isErr()) {
    return planResult;
  }
  if (!regradeRootIsReadable(rootDir)) {
    return regradeRootNotFound(rootDir);
  }
  const currentPath = regradePlanPathForPlan(rootDir, planResult.value);
  let current: RegradePlanArtifact | undefined;
  if (!input.fresh && existsSync(currentPath)) {
    const currentResult = readRegradePlanArtifact(currentPath);
    if (currentResult.isErr()) {
      return currentResult;
    }
    current = currentResult.value;
  }
  const plan =
    current === undefined
      ? planResult.value
      : mergeAuthoredPlanFields(current, planResult.value);
  const preserveInventory = await deriveLiveApiPreserveInventory(plan);
  const report = runResolvedVocabularyPlan({
    apply: false,
    includeEntries: input.includeEntries,
    plan,
    preserveInventory,
    rootDir,
  });
  if (report.isErr()) {
    return report;
  }
  const expansion = mergeRegradePlanExpansion(
    current?.expansion,
    input.expand ? expansionForReport(report.value) : undefined,
    plan
  );
  const artifact = buildRegradePlanArtifact({
    ...(expansion === undefined ? {} : { expansion }),
    input,
    plan,
    report: report.value,
    rootDir,
  });
  const mergedArtifact =
    current === undefined
      ? artifact
      : {
          ...artifact,
          provenance: preserveAuthoredPlanProvenance(
            current,
            artifact.provenance
          ),
        };
  if (shouldDryRun) {
    return validateRegradePlanArtifact(mergedArtifact);
  }
  return writeRegradePlanArtifact(rootDir, mergedArtifact);
};

const loadPlanForInput = async (
  input: RegradePlanReferenceInput,
  rootDir: string
): Promise<
  TrailsResult<
    { readonly artifact: RegradePlanArtifact; readonly path: string },
    Error
  >
> => {
  const path = resolveRegradePlanPath(rootDir, input.plan);
  if (path.isErr()) {
    return path;
  }
  const artifact = readRegradePlanArtifact(path.value);
  if (artifact.isErr()) {
    return artifact;
  }
  return Result.ok({ artifact: artifact.value, path: path.value });
};

const runCheckRegradePlan = async (
  input: RegradePlanReferenceInput,
  rootDir: string
): Promise<TrailsResult<RegradeReport, Error>> => {
  const loaded = await loadPlanForInput(input, rootDir);
  if (loaded.isErr()) {
    return loaded;
  }
  const report = await runPlanArtifactDryRun({
    artifact: loaded.value.artifact,
    includeEntries: input.includeEntries,
    rootDir,
  });
  if (report.isErr()) {
    return report;
  }
  const status = planStatusForReport(loaded.value.artifact, report.value);
  const checked = reportWithPlanSummary(
    report.value,
    loaded.value.artifact,
    status
  );
  if (status === 'stale') {
    return Result.err(
      new ValidationError(
        'Regrade plan is stale for the current source tree.',
        {
          context: { plan: loaded.value.artifact.path },
        }
      )
    );
  }
  const gateContext = regradePlanGateContext(checked);
  if (gateContext !== undefined) {
    return Result.err(
      new ValidationError('Regrade plan gate is open.', {
        context: {
          ...gateContext,
          plan: loaded.value.artifact.path,
        },
      })
    );
  }
  return validateRegradeReport(checked);
};

const runPreviewRegradePlan = async (
  input: RegradePlanReferenceInput,
  rootDir: string
): Promise<TrailsResult<RegradeReport, Error>> => {
  const loaded = await loadPlanForInput(input, rootDir);
  if (loaded.isErr()) {
    return loaded;
  }
  const report = await runPlanArtifactDryRun({
    artifact: loaded.value.artifact,
    includeEntries: input.includeEntries,
    rootDir,
  });
  if (report.isErr()) {
    return report;
  }
  return validateRegradeReport(
    reportWithPlanSummary(
      report.value,
      loaded.value.artifact,
      planStatusForReport(loaded.value.artifact, report.value)
    )
  );
};

const writeRegradeHistory = (params: {
  readonly artifact: RegradePlanArtifact;
  readonly planPath: string;
  readonly report: RegradeReport;
  readonly rootDir: string;
}): TrailsResult<
  { readonly path: string; readonly schemaVersion: number },
  Error
> => {
  const absolutePath = regradeHistoryPathForReport(
    params.rootDir,
    params.report
  );
  const relativePath = rootRelativePath(params.rootDir, absolutePath);
  const history = {
    kind: 'regrade-history',
    path: relativePath,
    plan: params.artifact,
    report: params.report,
    schemaVersion: REGRADE_PLAN_SCHEMA_VERSION,
  };
  try {
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, `${JSON.stringify(history, null, 2)}\n`);
  } catch (error) {
    return Result.err(
      new InternalError('Failed to write Regrade history entry.', {
        ...(error instanceof Error ? { cause: error } : {}),
        context: { path: relativePath },
      })
    );
  }
  try {
    rmSync(params.planPath, { force: true });
  } catch (error) {
    try {
      rmSync(absolutePath, { force: true });
    } catch {
      // Best-effort rollback; the surfaced error below preserves the primary failure.
    }
    return Result.err(
      new InternalError('Failed to remove active Regrade plan.', {
        ...(error instanceof Error ? { cause: error } : {}),
        context: {
          history: relativePath,
          plan: rootRelativePath(params.rootDir, params.planPath),
        },
      })
    );
  }
  return Result.ok({
    path: relativePath,
    schemaVersion: REGRADE_PLAN_SCHEMA_VERSION,
  });
};

const runApplyRegradePlan = async (
  input: RegradeApplyPlanInput,
  rootDir: string,
  shouldDryRun: boolean
): Promise<TrailsResult<RegradeReport, Error>> => {
  const loaded = await loadPlanForInput(input, rootDir);
  if (loaded.isErr()) {
    return loaded;
  }
  const dryRunReport = await runPlanArtifactDryRun({
    artifact: loaded.value.artifact,
    includeEntries: input.includeEntries,
    rootDir,
  });
  if (dryRunReport.isErr()) {
    return dryRunReport;
  }
  const status = planStatusForReport(loaded.value.artifact, dryRunReport.value);
  if (status === 'stale') {
    return Result.err(
      new ValidationError(
        'Regrade plan is stale for the current source tree.',
        {
          context: { plan: loaded.value.artifact.path },
        }
      )
    );
  }
  if (shouldDryRun) {
    return validateRegradeReport(
      reportWithPlanSummary(dryRunReport.value, loaded.value.artifact, status)
    );
  }

  const preserveInventory = await deriveLiveApiPreserveInventory(
    loaded.value.artifact.plan
  );
  const applied = runResolvedVocabularyPlan({
    apply: true,
    includeEntries: input.includeEntries,
    plan: loaded.value.artifact.plan,
    preserveInventory,
    rootDir,
  });
  if (applied.isErr()) {
    return applied;
  }
  const history = writeRegradeHistory({
    artifact: loaded.value.artifact,
    planPath: loaded.value.path,
    report: applied.value,
    rootDir,
  });
  if (history.isErr()) {
    return history;
  }
  return validateRegradeReport(
    reportWithHistorySummary(
      reportWithPlanSummary(applied.value, loaded.value.artifact, status),
      history.value
    )
  );
};

const listRegradePlans = async (
  rootDir: string
): Promise<TrailsResult<z.output<typeof regradePlansOutputSchema>, Error>> => {
  const plans: z.output<typeof regradePlanSummarySchema>[] = [];
  for (const path of collectActiveRegradePlanPaths(rootDir)) {
    const artifact = readRegradePlanArtifact(path);
    if (artifact.isErr()) {
      return artifact;
    }
    const report = await runPlanArtifactDryRun({
      artifact: artifact.value,
      includeEntries: 'actionable',
      rootDir,
    });
    if (report.isErr()) {
      return report;
    }
    const expansionPending = pendingExpansionCandidateCount(artifact.value);
    plans.push({
      ...(expansionPending === 0 ? {} : { expansionPending }),
      from: artifact.value.plan.from,
      path: artifact.value.path,
      schemaVersion: artifact.value.schemaVersion,
      status: planStatusForReport(artifact.value, report.value),
      to: artifact.value.plan.to,
    });
  }
  return Result.ok({ plans });
};

const runClassModeRegrade = async (
  input: RegradeInput,
  rootDir: string,
  configScope?: RegradeConfigScope | undefined
): Promise<TrailsResult<RegradeReport, Error>> => {
  const classSet = await loadWardenTermRewriteClasses(rootDir);
  if (classSet.diagnostics.length > 0) {
    return Result.err(
      new InternalError('Failed to load Regrade project Warden rules.', {
        context: {
          diagnostics: classSet.diagnostics,
          rootDir,
        },
      })
    );
  }

  const collection = classModeCollection(input, configScope);
  const reportResult: TrailsResult<RegradeReport | null, Error> = runRegrade({
    apply: input.apply,
    classes: classSet.classes,
    ...(collection === undefined ? {} : { collection }),
    includeEntries: input.includeEntries,
    root: rootDir,
    ...(input.classIds === undefined
      ? {}
      : { selection: { classIds: input.classIds } }),
  });
  if (reportResult.isErr()) {
    return reportResult;
  }

  const report = reportResult.value;
  if (report === null) {
    return regradeRootNotFound(rootDir);
  }

  return validateRegradeReport(report);
};

export const regradeTrail = trail('regrade', {
  args: ['from', 'to'],
  blaze: async (input, ctx) => {
    const rootDirResult = resolveTrailRootDir(input.rootDir, ctx.cwd);
    if (rootDirResult.isErr()) {
      return rootDirResult;
    }

    const configResult = await loadRegradeConfig({
      ...(input.configPath === undefined
        ? {}
        : { configPath: input.configPath }),
      env: ctx.env,
      rootDir: rootDirResult.value,
    });
    if (configResult.isErr()) {
      return configResult;
    }
    const configScope = configResult.value.config?.scope;

    const reportResult = hasVocabularyInput(input)
      ? await runVocabularyCommandRegrade(
          input,
          rootDirResult.value,
          configScope
        )
      : await runClassModeRegrade(input, rootDirResult.value, configScope);
    if (reportResult.isErr()) {
      return Result.err(reportResult.error);
    }
    const outputResult = validateOutput(
      regradeReportOutput,
      reportResult.value
    );
    if (outputResult.isErr()) {
      return Result.err(outputResult.error);
    }
    return Result.ok(outputResult.value);
  },
  description: 'Run downstream migration checks and safe rewrites',
  input: regradeInputSchema,
  intent: 'write',
  output: regradeReportOutput,
  permit: 'public',
});

export const planRegradeTrail = trail('plan.regrade', {
  args: ['from', 'to'],
  blaze: async (input, ctx) => {
    const rootDirResult = resolveTrailRootDir(input.rootDir, ctx.cwd);
    if (rootDirResult.isErr()) {
      return rootDirResult;
    }

    const configResult = await loadRegradeConfig({
      ...(input.configPath === undefined
        ? {}
        : { configPath: input.configPath }),
      env: ctx.env,
      rootDir: rootDirResult.value,
    });
    if (configResult.isErr()) {
      return configResult;
    }

    const result = await runPlanRegrade(
      input,
      rootDirResult.value,
      configResult.value.config?.scope,
      ctx.dryRun === true
    );
    if (result.isErr()) {
      return result;
    }
    const output = regradePlanArtifactSchema.safeParse(result.value);
    if (!output.success) {
      return Result.err(
        new ValidationError('Invalid Regrade plan output.', {
          context: { issues: output.error.issues },
        })
      );
    }
    return Result.ok(output.data);
  },
  cli: { path: ['regrade', 'plan'] },
  description: 'Write or update a reviewed Regrade plan',
  input: regradePlanInputSchema,
  intent: 'write',
  output: regradePlanArtifactSchema,
  permit: 'public',
});

export const listRegradesTrail = trail('list.regrades', {
  blaze: async (input, ctx) => {
    const rootDirResult = resolveTrailRootDir(input.rootDir, ctx.cwd);
    if (rootDirResult.isErr()) {
      return rootDirResult;
    }
    const result = await listRegradePlans(rootDirResult.value);
    if (result.isErr()) {
      return result;
    }
    return Result.ok(result.value);
  },
  cli: { path: ['regrade', 'plans'] },
  description: 'List active Regrade plans and freshness status',
  input: z.object({
    rootDir: z.string().optional().describe('Workspace root directory'),
  }),
  intent: 'read',
  output: regradePlansOutputSchema,
  permit: 'public',
});

export const checkRegradeTrail = trail('check.regrade', {
  blaze: async (input, ctx) => {
    const rootDirResult = resolveTrailRootDir(input.rootDir, ctx.cwd);
    if (rootDirResult.isErr()) {
      return rootDirResult;
    }
    const result = await runCheckRegradePlan(input, rootDirResult.value);
    if (result.isErr()) {
      return result;
    }
    const checked = {
      ...result.value,
      check: {
        plan: result.value.plan?.path ?? input.plan ?? '',
        status: 'passed' as const,
      },
    };
    const output = validateOutput(regradeCheckOutputSchema, checked);
    if (output.isErr()) {
      return Result.err(output.error);
    }
    return Result.ok(output.value);
  },
  cli: { path: ['regrade', 'check'] },
  description: 'Check a saved Regrade plan gate without writing source',
  input: regradePlanReferenceInputSchema,
  intent: 'read',
  output: regradeCheckOutputSchema,
  permit: 'public',
});

export const previewRegradeTrail = trail('preview.regrade', {
  blaze: async (input, ctx) => {
    const rootDirResult = resolveTrailRootDir(input.rootDir, ctx.cwd);
    if (rootDirResult.isErr()) {
      return rootDirResult;
    }
    const result = await runPreviewRegradePlan(input, rootDirResult.value);
    if (result.isErr()) {
      return result;
    }
    const output = validateOutput(regradeReportOutput, result.value);
    if (output.isErr()) {
      return Result.err(output.error);
    }
    return Result.ok(output.value);
  },
  cli: { path: ['regrade', 'preview'] },
  description: 'Preview a saved Regrade plan without writing source',
  input: regradePlanReferenceInputSchema,
  intent: 'read',
  output: regradeReportOutput,
  permit: 'public',
});

export const applyRegradeTrail = trail('apply.regrade', {
  blaze: async (input, ctx) => {
    const rootDirResult = resolveTrailRootDir(input.rootDir, ctx.cwd);
    if (rootDirResult.isErr()) {
      return rootDirResult;
    }
    const result = await runApplyRegradePlan(
      input,
      rootDirResult.value,
      ctx.dryRun === true
    );
    if (result.isErr()) {
      return result;
    }
    const output = validateOutput(regradeReportOutput, result.value);
    if (output.isErr()) {
      return Result.err(output.error);
    }
    return Result.ok(output.value);
  },
  cli: { path: ['regrade', 'apply'] },
  description: 'Apply a saved Regrade plan and move it to history',
  input: regradeApplyPlanInputSchema,
  intent: 'write',
  output: regradeReportOutput,
  permit: 'public',
});
