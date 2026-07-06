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
  loadWardenRegradeClasses,
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
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import type { Dirent } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { z } from 'zod';

import { loadRegradeConfig } from '../regrade/config.js';
import {
  REGRADE_HISTORY_SCHEMA_VERSION,
  appendRegradeHistoryRun,
  readRegradeHistoryArtifact,
  regradeHistoryPathForPlan,
  resolveRegradeHistoryPath,
  verifyRegradeHistoryRuns,
} from '../regrade/history.js';
import type { RegradeHistorySummary } from '../regrade/history.js';
import { deriveLiveApiPreserveInventory } from '../regrade/live-api-preserve.js';
import {
  REGRADE_PLAN_SCHEMA_VERSION,
  regradePlanArtifactSchema,
  regradePlanPathForPlan,
  regradeSourceHash,
  rootRelativePath,
} from '../regrade/plan-artifact.js';
import type {
  ClassRegradePlan,
  RegradePlanArtifact,
  RegradePlanBody,
  RegradePlanExpansion,
  VocabularyRegradePlanArtifact,
} from '../regrade/plan-artifact.js';
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

const regradePlanSummarySchema = z.object({
  classIds: z
    .array(z.string())
    .optional()
    .describe('Class ids for a class-mode plan'),
  expansionPending: z
    .number()
    .optional()
    .describe('Pending staged expansion candidates on this plan'),
  from: z.string().optional().describe('Source term for a vocabulary plan'),
  kind: z.enum(['class', 'vocabulary']).describe('Regrade plan kind'),
  path: z.string(),
  schemaVersion: z.number(),
  status: z.enum(['active', 'stale']),
  to: z.string().optional().describe('Target term for a vocabulary plan'),
});

const regradePlansOutputSchema = z.object({
  plans: z.array(regradePlanSummarySchema),
});

const regradeCheckOutputSchema = regradeReportOutput.extend({
  check: z
    .object({
      plan: z
        .string()
        .describe(
          'Saved Regrade plan or graduated history path that passed checks'
        ),
      status: z.literal('passed').describe('Check result'),
    })
    .describe('Saved Regrade plan check result'),
});

const regradePlanInputSchema = regradePathScopeInputSchema.extend({
  classIds: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Regrade class ids for a class-mode plan; pair with `type: class` on the CLI so the plan subcommand wins over `regrade` positionals'
    ),
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
  from: z
    .string()
    .min(1)
    .optional()
    .describe('Source vocabulary term or phrase'),
  includeEntries: z
    .enum(['actionable', 'all'])
    .default('actionable')
    .describe(
      'Report entry detail to inspect while deriving plan freshness and expansion'
    ),
  intent: z
    .string()
    .optional()
    .describe('Human-authored migration intent for the plan'),
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
  to: z.string().min(1).optional().describe('Target vocabulary term or phrase'),
  type: z
    .enum(['class', 'vocabulary'])
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

const regradeAdjustInputSchema = z.object({
  rootDir: z.string().optional().describe('Workspace root directory'),
  transition: z
    .string()
    .min(1)
    .describe('Graduated transition name, e.g. facet-to-trailhead'),
});

type RegradePlanInput = z.output<typeof regradePlanInputSchema>;
type RegradePlanReferenceInput = z.output<
  typeof regradePlanReferenceInputSchema
>;
type RegradeApplyPlanInput = z.output<typeof regradeApplyPlanInputSchema>;
type RegradeAdjustInput = z.output<typeof regradeAdjustInputSchema>;

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
  params: RegradeHistorySummary
): RegradeReport => ({
  ...report,
  history: {
    path: params.path,
    schemaVersion: params.schemaVersion,
    status: params.status,
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
  current: VocabularyRegradePlanArtifact,
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
  current: VocabularyRegradePlanArtifact,
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
  readonly transitionId?: string | undefined;
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
    ...(params.transitionId === undefined
      ? {}
      : { transitionId: params.transitionId }),
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

/**
 * Transition identity is not an authored plan field — it follows the
 * transition. Plan re-derivation (including `--fresh`) carries it forward
 * from the existing active plan of the same kind so a subsequent apply
 * appends to the same consolidated history spine instead of forking it.
 */
const priorTransitionId = (
  currentPath: string,
  kind: RegradePlanBody['kind']
): string | undefined => {
  if (!existsSync(currentPath)) {
    return undefined;
  }
  const existing = readRegradePlanArtifact(currentPath);
  if (existing.isErr() || existing.value.plan.kind !== kind) {
    return undefined;
  }
  return existing.value.transitionId;
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
  // Class-mode reports carry no vocabulary run: the gate is derived from the
  // outstanding rewrite and review counts alone.
  const gateStatus = report.run?.report.gate.status;
  if (gateStatus !== undefined && gateStatus !== 'green') {
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

interface ClassRegradeCoreParams {
  readonly apply: boolean;
  readonly classIds?: readonly string[] | undefined;
  readonly collection?:
    | {
        readonly exclude?: readonly string[] | undefined;
        readonly extensions?: readonly string[] | undefined;
      }
    | undefined;
  readonly includeEntries: RegradeInput['includeEntries'];
  readonly rootDir: string;
}

const runClassRegradeCore = async (
  params: ClassRegradeCoreParams
): Promise<TrailsResult<RegradeReport, Error>> => {
  const classSet = await loadWardenRegradeClasses(params.rootDir);
  if (classSet.diagnostics.length > 0) {
    return Result.err(
      new InternalError('Failed to load Regrade project Warden rules.', {
        context: {
          diagnostics: classSet.diagnostics,
          rootDir: params.rootDir,
        },
      })
    );
  }

  const collection =
    params.collection === undefined
      ? undefined
      : {
          ...(params.collection.exclude === undefined
            ? {}
            : { exclude: params.collection.exclude }),
          ...(params.collection.extensions === undefined
            ? {}
            : { extensions: params.collection.extensions }),
        };
  const reportResult: TrailsResult<RegradeReport | null, Error> = runRegrade({
    apply: params.apply,
    classes: classSet.classes,
    ...(collection === undefined ? {} : { collection }),
    includeEntries: params.includeEntries,
    root: params.rootDir,
    ...(params.classIds === undefined
      ? {}
      : { selection: { classIds: params.classIds } }),
  });
  if (reportResult.isErr()) {
    return reportResult;
  }

  const report = reportResult.value;
  if (report === null) {
    return regradeRootNotFound(params.rootDir);
  }

  return validateRegradeReport(report);
};

const runClassPlanRegradeRun = (params: {
  readonly apply: boolean;
  readonly includeEntries: RegradePlanReferenceInput['includeEntries'];
  readonly plan: ClassRegradePlan;
  readonly rootDir: string;
}): Promise<TrailsResult<RegradeReport, Error>> =>
  runClassRegradeCore({
    apply: params.apply,
    classIds: params.plan.classIds,
    ...(params.plan.scope === undefined
      ? {}
      : { collection: params.plan.scope }),
    includeEntries: params.includeEntries,
    rootDir: params.rootDir,
  });

const runPlanArtifactDryRun = async (params: {
  readonly artifact: RegradePlanArtifact;
  readonly includeEntries: RegradePlanReferenceInput['includeEntries'];
  readonly rootDir: string;
}): Promise<TrailsResult<RegradeReport, Error>> => {
  const planBody = params.artifact.plan;
  if (planBody.kind === 'class') {
    return runClassPlanRegradeRun({
      apply: false,
      includeEntries: params.includeEntries,
      plan: planBody,
      rootDir: params.rootDir,
    });
  }
  const preserveInventory = await deriveLiveApiPreserveInventory(planBody);
  return runResolvedVocabularyPlan({
    apply: false,
    includeEntries: params.includeEntries,
    plan: planBody,
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

const classPlanScopeForInput = (
  input: RegradePlanInput,
  configScope: RegradeConfigScope | undefined
): ClassRegradePlan['scope'] => {
  const exclude = input.exclude ?? configScope?.exclude;
  const extensions = input.extensions ?? configScope?.extensions;
  if (exclude === undefined && extensions === undefined) {
    return undefined;
  }
  return {
    ...(exclude === undefined ? {} : { exclude: [...exclude] }),
    ...(extensions === undefined ? {} : { extensions: [...extensions] }),
  };
};

const validateClassPlanInput = (
  input: RegradePlanInput
): ValidationError | null => {
  if (input.classIds === undefined || input.classIds.length === 0) {
    return new ValidationError(
      'A class-mode Regrade plan requires at least one class id.'
    );
  }
  if (input.from !== undefined || input.to !== undefined) {
    return new ValidationError(
      '`classIds` selects a class-mode plan and cannot be combined with vocabulary `from`/`to`.'
    );
  }
  if (input.type === 'vocabulary') {
    return new ValidationError(
      '`type: vocabulary` cannot be combined with `classIds`.'
    );
  }
  if (input.expand) {
    return new ValidationError(
      '`expand` stages vocabulary review candidates and is not supported for class-mode plans.'
    );
  }
  if (input.include !== undefined) {
    return new ValidationError(
      'Class-mode Regrade plans do not support `include`; scope the run with `exclude` and `extensions`.'
    );
  }
  return null;
};

type ClassPlanArtifact = RegradePlanArtifact & {
  readonly plan: ClassRegradePlan;
};

const readCurrentClassPlanArtifact = (
  input: RegradePlanInput,
  currentPath: string
): TrailsResult<ClassPlanArtifact | null, Error> => {
  if (input.fresh || !existsSync(currentPath)) {
    return Result.ok(null);
  }
  const currentResult = readRegradePlanArtifact(currentPath);
  if (currentResult.isErr()) {
    return currentResult;
  }
  const candidate = currentResult.value;
  if (candidate.plan.kind !== 'class') {
    return Result.ok(null);
  }
  return Result.ok({ ...candidate, plan: candidate.plan });
};

/** Carry authored intent and scope forward from the existing plan artifact. */
const mergeAuthoredClassPlanFields = (
  plan: ClassRegradePlan,
  input: RegradePlanInput,
  authoredScope: boolean,
  current: ClassPlanArtifact | null
): ClassRegradePlan => {
  if (current === null) {
    return plan;
  }
  let merged = plan;
  if (
    input.intent === undefined &&
    current.provenance.fields['intent'] === 'authored' &&
    current.plan.intent !== undefined
  ) {
    merged = { ...merged, intent: current.plan.intent };
  }
  if (
    !authoredScope &&
    current.provenance.fields['scope'] === 'authored' &&
    current.plan.scope !== undefined
  ) {
    merged = { ...merged, scope: current.plan.scope };
  }
  return merged;
};

const classPlanProvenance = (
  plan: ClassRegradePlan,
  authoredScope: boolean,
  current: ClassPlanArtifact | null
): RegradePlanArtifact['provenance'] => ({
  fields: {
    classIds: 'authored',
    id: 'derived',
    kind: 'derived',
    ...(plan.intent === undefined ? {} : { intent: 'authored' }),
    ...(plan.scope === undefined
      ? {}
      : {
          scope:
            authoredScope || current?.provenance.fields['scope'] === 'authored'
              ? 'authored'
              : 'derived',
        }),
  },
});

const runClassPlanRegrade = async (
  input: RegradePlanInput,
  rootDir: string,
  configScope: RegradeConfigScope | undefined,
  shouldDryRun: boolean
): Promise<TrailsResult<RegradePlanArtifact, Error>> => {
  const invalid = validateClassPlanInput(input);
  if (invalid !== null) {
    return Result.err(invalid);
  }
  const classIds = input.classIds ?? [];
  if (!regradeRootIsReadable(rootDir)) {
    return regradeRootNotFound(rootDir);
  }

  const inputScope = classPlanScopeForInput(input, configScope);
  const basePlan: ClassRegradePlan = {
    classIds: [...classIds],
    id: `class:${classIds.join('+')}`,
    ...(input.intent === undefined ? {} : { intent: input.intent }),
    kind: 'class',
    ...(inputScope === undefined ? {} : { scope: inputScope }),
  };
  const currentPath = regradePlanPathForPlan(rootDir, basePlan);
  const currentResult = readCurrentClassPlanArtifact(input, currentPath);
  if (currentResult.isErr()) {
    return currentResult;
  }
  const current = currentResult.value;
  const authoredScope =
    input.exclude !== undefined || input.extensions !== undefined;
  const plan = mergeAuthoredClassPlanFields(
    basePlan,
    input,
    authoredScope,
    current
  );

  const report = await runClassPlanRegradeRun({
    apply: false,
    includeEntries: input.includeEntries,
    plan,
    rootDir,
  });
  if (report.isErr()) {
    return report;
  }
  if (report.value.unknownClassIds.length > 0) {
    return Result.err(
      new ValidationError('Unknown Regrade class ids.', {
        context: { unknownClassIds: report.value.unknownClassIds },
      })
    );
  }

  const transitionId = priorTransitionId(currentPath, 'class');
  const artifact: RegradePlanArtifact = {
    kind: 'regrade-plan',
    path: rootRelativePath(rootDir, currentPath),
    plan,
    provenance: classPlanProvenance(plan, authoredScope, current),
    schemaVersion: REGRADE_PLAN_SCHEMA_VERSION,
    sourceHash: regradeSourceHash(report.value),
    ...(transitionId === undefined ? {} : { transitionId }),
  };
  if (shouldDryRun) {
    return validateRegradePlanArtifact(artifact);
  }
  return writeRegradePlanArtifact(rootDir, artifact);
};

const runPlanRegrade = async (
  input: RegradePlanInput,
  rootDir: string,
  configScope?: RegradeConfigScope | undefined,
  shouldDryRun = false
): Promise<TrailsResult<RegradePlanArtifact, Error>> => {
  if (input.classIds !== undefined || input.type === 'class') {
    return runClassPlanRegrade(input, rootDir, configScope, shouldDryRun);
  }
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
  let current: VocabularyRegradePlanArtifact | undefined;
  if (!input.fresh && existsSync(currentPath)) {
    const currentResult = readRegradePlanArtifact(currentPath);
    if (currentResult.isErr()) {
      return currentResult;
    }
    const candidate = currentResult.value;
    if (candidate.plan.kind === 'vocabulary') {
      current = { ...candidate, plan: candidate.plan };
    }
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
  const transitionId = priorTransitionId(currentPath, 'vocabulary');
  const artifact = buildRegradePlanArtifact({
    ...(expansion === undefined ? {} : { expansion }),
    input,
    plan,
    report: report.value,
    rootDir,
    ...(transitionId === undefined ? {} : { transitionId }),
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

const reportWithCheckedHistorySummary = (
  report: RegradeReport,
  historyPath: string
): RegradeReport => ({
  ...report,
  history: {
    path: historyPath,
    schemaVersion: REGRADE_HISTORY_SCHEMA_VERSION,
    status: 'checked',
  },
});

/**
 * Check a graduated transition: verify every recorded run in the
 * consolidated history at its own stamped lock. Historical runs are not
 * re-executed — per-run stamp verification is the machine acceptance.
 */
const checkGraduatedRegradeHistory = (
  historyPath: string
): TrailsResult<RegradeReport, Error> => {
  const artifact = readRegradeHistoryArtifact(historyPath);
  if (artifact.isErr()) {
    return artifact;
  }
  const verified = verifyRegradeHistoryRuns(artifact.value);
  if (verified.isErr()) {
    return verified;
  }
  const lastRun = artifact.value.runs.at(-1);
  if (lastRun === undefined) {
    return Result.err(
      new ValidationError('Regrade history has no recorded runs.', {
        context: { path: artifact.value.path },
      })
    );
  }
  return validateRegradeReport(
    reportWithCheckedHistorySummary(lastRun.report, artifact.value.path)
  );
};

const runCheckRegradePlan = async (
  input: RegradePlanReferenceInput,
  rootDir: string
): Promise<TrailsResult<RegradeReport, Error>> => {
  const planPath = resolveRegradePlanPath(rootDir, input.plan);
  if (planPath.isErr()) {
    if (input.plan !== undefined && !isPlanPathReference(input.plan)) {
      const historyPath = resolveRegradeHistoryPath(rootDir, input.plan);
      if (historyPath.isOk()) {
        return checkGraduatedRegradeHistory(historyPath.value);
      }
    }
    return planPath;
  }
  const artifact = readRegradePlanArtifact(planPath.value);
  if (artifact.isErr()) {
    return artifact;
  }
  const loaded = {
    value: { artifact: artifact.value, path: planPath.value },
  };
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
}): TrailsResult<RegradeHistorySummary, Error> => {
  const absolutePath = regradeHistoryPathForPlan(
    params.rootDir,
    params.artifact.plan
  );
  let priorHistoryBytes: string | undefined;
  if (existsSync(absolutePath)) {
    try {
      priorHistoryBytes = readFileSync(absolutePath, 'utf8');
    } catch (error) {
      return Result.err(
        new InternalError('Failed to read Regrade history entry.', {
          ...(error instanceof Error ? { cause: error } : {}),
          context: { path: rootRelativePath(params.rootDir, absolutePath) },
        })
      );
    }
  }
  const appended = appendRegradeHistoryRun({
    artifact: params.artifact,
    report: params.report,
    rootDir: params.rootDir,
  });
  if (appended.isErr()) {
    return appended;
  }
  try {
    // Apply always consumes the active plan, replay included: the plan is a
    // single-use apply intent, and the consolidated history already records
    // the run the replay repeats.
    rmSync(params.planPath, { force: true });
  } catch (error) {
    try {
      if (priorHistoryBytes === undefined) {
        rmSync(absolutePath, { force: true });
      } else {
        writeFileSync(absolutePath, priorHistoryBytes);
      }
    } catch {
      // Best-effort rollback; the surfaced error below preserves the primary failure.
    }
    return Result.err(
      new InternalError('Failed to remove active Regrade plan.', {
        ...(error instanceof Error ? { cause: error } : {}),
        context: {
          history: appended.value.path,
          plan: rootRelativePath(params.rootDir, params.planPath),
        },
      })
    );
  }
  return appended;
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

  const planBody = loaded.value.artifact.plan;
  let applied: TrailsResult<RegradeReport, Error>;
  if (planBody.kind === 'class') {
    applied = await runClassPlanRegradeRun({
      apply: true,
      includeEntries: input.includeEntries,
      plan: planBody,
      rootDir,
    });
  } else {
    const preserveInventory = await deriveLiveApiPreserveInventory(planBody);
    applied = runResolvedVocabularyPlan({
      apply: true,
      includeEntries: input.includeEntries,
      plan: planBody,
      preserveInventory,
      rootDir,
    });
  }
  if (applied.isErr()) {
    return applied;
  }
  // The recorded run evidence is the freshness-gated dry-run report: its
  // source hash is the lock state this run ran against (the staleness gate
  // holds it equal to the plan's own sourceHash), and unlike the post-apply
  // rescan it preserves the rewrite entries the run graduated.
  const history = writeRegradeHistory({
    artifact: loaded.value.artifact,
    planPath: loaded.value.path,
    report: dryRunReport.value,
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

/**
 * Pull a graduated transition back from consolidated history into an active
 * plan for adjustment. The pulled-back artifact is authored intent only —
 * plan body, provenance, and any staged expansion; the run ledger stays
 * behind in the graduated history file, which adjust never touches. The
 * transition's stable id is preserved so the re-run's apply appends to the
 * same consolidated history spine instead of forking it.
 */
const runAdjustRegrade = async (
  input: RegradeAdjustInput,
  rootDir: string,
  shouldDryRun: boolean
): Promise<TrailsResult<RegradePlanArtifact, Error>> => {
  const historyPath = resolveRegradeHistoryPath(rootDir, input.transition);
  if (historyPath.isErr()) {
    return historyPath;
  }
  const history = readRegradeHistoryArtifact(historyPath.value);
  if (history.isErr()) {
    return history;
  }
  const lastRun = history.value.runs.at(-1);
  if (lastRun === undefined) {
    return Result.err(
      new ValidationError('Regrade history has no recorded runs.', {
        context: { path: history.value.path },
      })
    );
  }
  const lastPlan = lastRun.plan;
  const activePath = regradePlanPathForPlan(rootDir, lastPlan.plan);
  if (existsSync(activePath)) {
    return Result.err(
      new ValidationError(
        'An active Regrade plan for this transition already exists; edit or apply it instead of adjusting again.',
        { context: { plan: rootRelativePath(rootDir, activePath) } }
      )
    );
  }
  const draft: RegradePlanArtifact = {
    ...(lastPlan.expansion === undefined
      ? {}
      : { expansion: lastPlan.expansion }),
    kind: 'regrade-plan',
    path: rootRelativePath(rootDir, activePath),
    plan: lastPlan.plan,
    provenance: lastPlan.provenance,
    schemaVersion: REGRADE_PLAN_SCHEMA_VERSION,
    sourceHash: lastPlan.sourceHash,
    transitionId: history.value.id,
  };
  // Re-derive the source hash against the current tree so the later apply's
  // staleness gate compares with today's occurrences, not the graduated
  // run's.
  const report = await runPlanArtifactDryRun({
    artifact: draft,
    includeEntries: 'actionable',
    rootDir,
  });
  if (report.isErr()) {
    return report;
  }
  const artifact: RegradePlanArtifact = {
    ...draft,
    sourceHash: regradeSourceHash(report.value),
  };
  if (shouldDryRun) {
    return validateRegradePlanArtifact(artifact);
  }
  return writeRegradePlanArtifact(rootDir, artifact);
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
    const body = artifact.value.plan;
    plans.push({
      ...(body.kind === 'class' ? { classIds: [...body.classIds] } : {}),
      ...(expansionPending === 0 ? {} : { expansionPending }),
      ...(body.kind === 'vocabulary' ? { from: body.from, to: body.to } : {}),
      kind: body.kind,
      path: artifact.value.path,
      schemaVersion: artifact.value.schemaVersion,
      status: planStatusForReport(artifact.value, report.value),
    });
  }
  return Result.ok({ plans });
};

const runClassModeRegrade = (
  input: RegradeInput,
  rootDir: string,
  configScope?: RegradeConfigScope | undefined
): Promise<TrailsResult<RegradeReport, Error>> => {
  const collection = classModeCollection(input, configScope);
  return runClassRegradeCore({
    apply: input.apply,
    ...(input.classIds === undefined ? {} : { classIds: input.classIds }),
    ...(collection === undefined ? {} : { collection }),
    includeEntries: input.includeEntries,
    rootDir,
  });
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
        plan:
          result.value.plan?.path ??
          result.value.history?.path ??
          input.plan ??
          '',
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

export const adjustRegradeTrail = trail('adjust.regrade', {
  args: ['transition'],
  blaze: async (input, ctx) => {
    const rootDirResult = resolveTrailRootDir(input.rootDir, ctx.cwd);
    if (rootDirResult.isErr()) {
      return rootDirResult;
    }
    const result = await runAdjustRegrade(
      input,
      rootDirResult.value,
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
  cli: { path: ['regrade', 'adjust'] },
  description:
    'Pull a graduated Regrade transition back to an active plan for adjustment',
  input: regradeAdjustInputSchema,
  intent: 'write',
  output: regradePlanArtifactSchema,
  permit: 'public',
});
