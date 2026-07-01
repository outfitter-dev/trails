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
  listVocabularyRegradePlansFromRegistry,
  loadWardenTermRewriteClasses,
  regradeReportOutput,
  runRegrade,
  runVocabularyRegrade,
  vocabularyDispositionValues,
} from '@ontrails/regrade';
import type {
  RegradeReport,
  VocabularyPreserveRule,
  VocabularyRegradePlan,
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

const hasVocabularyInput = (input: z.output<typeof regradeInputSchema>) =>
  input.from !== undefined ||
  input.include !== undefined ||
  input.intent !== undefined ||
  input.overrides !== undefined ||
  input.preserve !== undefined ||
  input.to !== undefined;

const classModeCollection = (
  input: z.output<typeof regradeInputSchema>,
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
  preserve: z.output<typeof regradeInputSchema>['preserve']
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
  input: z.output<typeof regradeInputSchema>
): VocabularyRegradePlan | undefined =>
  listVocabularyRegradePlansFromRegistry().find(
    (plan) => plan.from === input.from && plan.to === input.to
  );

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
  input: z.output<typeof regradeInputSchema>,
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
          root: rootDirResult.value,
        });
      if (reportResult.isErr()) {
        return reportResult;
      }
      const report = reportResult.value;
      if (report === null) {
        return Result.err(
          new NotFoundError(
            `Regrade root "${rootDirResult.value}" could not be read as a directory.`
          )
        );
      }
      const validated: TrailsResult<
        z.output<typeof regradeReportOutput>,
        Error
      > = validateOutput(regradeReportOutput, report);
      if (validated.isErr()) {
        return validated;
      }
      return Result.ok(validated.value);
    }

    const classSet = await loadWardenTermRewriteClasses(rootDirResult.value);
    if (classSet.diagnostics.length > 0) {
      return Result.err(
        new InternalError('Failed to load Regrade project Warden rules.', {
          context: {
            diagnostics: classSet.diagnostics,
            rootDir: rootDirResult.value,
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
      root: rootDirResult.value,
      ...(input.classIds === undefined
        ? {}
        : { selection: { classIds: input.classIds } }),
    });
    if (reportResult.isErr()) {
      return reportResult;
    }

    const report = reportResult.value;
    if (report === null) {
      return Result.err(
        new NotFoundError(
          `Regrade root "${rootDirResult.value}" could not be read as a directory.`
        )
      );
    }

    const validated: TrailsResult<
      z.output<typeof regradeReportOutput>,
      Error
    > = validateOutput(regradeReportOutput, report);
    if (validated.isErr()) {
      return validated;
    }

    return Result.ok(validated.value);
  },
  description: 'Run downstream migration checks and safe rewrites',
  input: regradeInputSchema,
  intent: 'write',
  output: regradeReportOutput,
  permit: 'public',
});
