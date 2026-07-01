/**
 * `regrade` trail -- Run downstream migration checks and safe rewrites.
 */

import {
  InternalError,
  NotFoundError,
  Result,
  ValidationError,
  pathScopeSchema,
  trail,
  validateOutput,
} from '@ontrails/core';
import type { PathScope, Result as TrailsResult } from '@ontrails/core';
import {
  createGovernedAstIdentifierRenameClasses,
  listVocabularyRegradePlansFromRegistry,
  loadWardenTermRewriteClasses,
  regradeReportOutput,
  runRegrade,
  runVocabularyRegrade,
  vocabularyRegradeTransitionForInput,
  vocabularyDispositionValues,
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
});

type RegradeInput = z.output<typeof regradeInputSchema>;

const hasVocabularyInput = (input: RegradeInput) =>
  input.from !== undefined ||
  input.include !== undefined ||
  input.intent !== undefined ||
  input.overrides !== undefined ||
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

const normalizeExtension = (extension: string): string =>
  extension === '' || extension.startsWith('.') ? extension : `.${extension}`;

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

const mergeNumericRecords = (
  left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>
): Readonly<Record<string, number>> => {
  const keys = uniqueSorted([...Object.keys(left), ...Object.keys(right)]);
  return Object.fromEntries(
    keys.map((key) => [key, Math.max(left[key] ?? 0, right[key] ?? 0)])
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
        scanned: Math.max(vocabularyReport.scanned, symbolReport.scanned),
        skipped: Math.max(vocabularyReport.skipped, symbolReport.skipped),
      },
      skippedByReason,
    },
    scanned: Math.max(vocabularyReport.scanned, symbolReport.scanned),
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

const preservedFormsFromRules = (
  rules: readonly VocabularyPreserveRule[] | undefined
): ReadonlySet<string> => new Set(rules?.flatMap((rule) => rule.forms ?? []));

const preservedFormsFromInventory = (
  inventory: readonly VocabularyPreserveInventoryEntry[]
): ReadonlySet<string> =>
  new Set(inventory.flatMap((rule) => rule.forms ?? []));

const combinePreservedForms = (
  left: ReadonlySet<string>,
  right: ReadonlySet<string>
): ReadonlySet<string> => new Set([...left, ...right]);

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
    scope: {
      ...configScope,
      ...(input.exclude === undefined ? {} : { exclude: input.exclude }),
      ...(input.extensions === undefined
        ? {}
        : { extensions: input.extensions }),
      ...(input.include === undefined ? {} : { include: input.include }),
    },
    to: input.to,
  });
};

const regradeRootNotFound = (rootDir: string) =>
  Result.err(
    new NotFoundError(
      `Regrade root "${rootDir}" could not be read as a directory.`
    )
  );

const validateRegradeReport = (
  report: RegradeReport
): TrailsResult<z.output<typeof regradeReportOutput>, Error> =>
  validateOutput(regradeReportOutput, report);

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
  const preservedForms = combinePreservedForms(
    preservedFormsFromRules(params.plan.preserve),
    preservedFormsFromInventory(params.preserveInventory)
  );
  const symbolRenames =
    transition?.symbolRenames.filter(
      (rename) => !preservedForms.has(rename.from)
    ) ?? [];
  if (transition === undefined || symbolRenames.length === 0) {
    return Result.ok(null);
  }

  const symbolCollection = vocabularySymbolCollection(params.plan.scope);
  if (symbolCollection === null) {
    return Result.ok(null);
  }
  return runRegrade({
    apply: params.apply,
    classes: createGovernedAstIdentifierRenameClasses({
      ...transition,
      symbolRenames,
    }),
    ...(symbolCollection === undefined ? {} : { collection: symbolCollection }),
    includeEntries: params.includeEntries,
    root: params.rootDir,
  });
};

const runVocabularyCommandRegrade = async (
  input: RegradeInput,
  rootDir: string,
  configScope?: RegradeConfigScope | undefined
): Promise<TrailsResult<z.output<typeof regradeReportOutput>, Error>> => {
  const planResult = buildVocabularyPlan(
    input,
    vocabularyScopeFromConfig(configScope)
  );
  if (planResult.isErr()) {
    return planResult;
  }

  const preserveInventory = await deriveLiveApiPreserveInventory(
    planResult.value
  );
  const reportResult: TrailsResult<RegradeReport | null, Error> =
    runVocabularyRegrade({
      apply: input.apply,
      includeEntries: input.includeEntries,
      plan: planResult.value,
      ...(preserveInventory.length === 0 ? {} : { preserveInventory }),
      root: rootDir,
    });
  if (reportResult.isErr()) {
    return reportResult;
  }

  const report = reportResult.value;
  if (report === null) {
    return regradeRootNotFound(rootDir);
  }
  const validated = validateRegradeReport(report);
  if (validated.isErr()) {
    return validated;
  }

  const symbolReportResult = runGovernedSymbolRegrade({
    apply: input.apply,
    includeEntries: input.includeEntries,
    plan: planResult.value,
    preserveInventory,
    rootDir,
  });
  if (symbolReportResult.isErr()) {
    return symbolReportResult;
  }
  if (symbolReportResult.value === null) {
    return Result.ok(validated.value);
  }

  const mergedValidated = validateRegradeReport(
    mergeRegradeReports(report, symbolReportResult.value)
  );
  return mergedValidated;
};

const runClassModeRegrade = async (
  input: RegradeInput,
  rootDir: string,
  configScope?: RegradeConfigScope | undefined
): Promise<TrailsResult<z.output<typeof regradeReportOutput>, Error>> => {
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

    if (hasVocabularyInput(input)) {
      return runVocabularyCommandRegrade(
        input,
        rootDirResult.value,
        configScope
      );
    }

    return runClassModeRegrade(input, rootDirResult.value, configScope);
  },
  description: 'Run downstream migration checks and safe rewrites',
  input: regradeInputSchema,
  intent: 'write',
  output: regradeReportOutput,
  permit: 'public',
});
