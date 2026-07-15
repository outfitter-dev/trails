/**
 * Factory that wraps a WardenRule as a trail.
 *
 * Keeps each rule trail file minimal — just the import + examples.
 */

import { InternalError, trail, Result } from '@ontrails/core';
import type { Trail } from '@ontrails/core';

import type {
  ProjectAwareWardenRule,
  ProjectContext,
  TopoAwareWardenRule,
  WardenRule,
} from '../rules/types.js';
import { getWardenRuleMetadata } from '../rules/metadata.js';
import {
  projectAwareRuleInput,
  ruleInput,
  ruleOutput,
  topoAwareRuleInput,
} from './schema.js';
import type {
  ProjectAwareRuleInput,
  RuleInput,
  RuleOutput,
  TopoAwareRuleInput,
} from './schema.js';

interface WrapRuleOptions {
  /** The existing warden rule to wrap. */
  readonly rule: WardenRule;
  /** Trail examples for testing and documentation. */
  readonly examples: Trail<RuleInput, RuleOutput>['examples'];
}

interface WrapProjectAwareRuleOptions {
  /** The existing project-aware warden rule to wrap. */
  readonly rule: ProjectAwareWardenRule;
  /** Trail examples for testing and documentation. */
  readonly examples: Trail<ProjectAwareRuleInput, RuleOutput>['examples'];
}

const buildRuleMeta = (rule: WardenRule | TopoAwareWardenRule) => {
  const metadata = getWardenRuleMetadata(rule);
  return {
    category: 'governance',
    ...(metadata ? { warden: metadata } : {}),
    severity: rule.severity,
  };
};

const buildGovernedHistoryContext = (
  input: ProjectAwareRuleInput
): Pick<
  ProjectContext,
  | 'governedVocabularyHistoryByTransitionId'
  | 'governedVocabularyHistoryIssues'
  | 'governedVocabularyHistoryRequired'
> => ({
  ...(input.governedVocabularyHistories
    ? {
        governedVocabularyHistoryByTransitionId: new Map(
          input.governedVocabularyHistories.map((history) => [
            history.transitionId,
            history,
          ])
        ),
      }
    : {}),
  ...(input.governedVocabularyHistoryIssues
    ? {
        governedVocabularyHistoryIssues:
          input.governedVocabularyHistoryIssues.map((issue) => ({
            message: issue.message,
            path: issue.path,
            ...(issue.transitionId === undefined
              ? {}
              : { transitionId: issue.transitionId }),
          })),
      }
    : {}),
  ...(input.governedVocabularyHistoryRequired === undefined
    ? {}
    : {
        governedVocabularyHistoryRequired:
          input.governedVocabularyHistoryRequired,
      }),
});

export const buildProjectContext = (
  input: ProjectAwareRuleInput
): ProjectContext => ({
  ...(input.authoredMcpSurfaceBindingSets
    ? { authoredMcpSurfaceBindingSets: input.authoredMcpSurfaceBindingSets }
    : {}),
  ...(input.entityReferencesByName
    ? {
        entityReferencesByName: new Map(
          Object.entries(input.entityReferencesByName)
        ),
      }
    : {}),
  ...(input.crudTableIds ? { crudTableIds: new Set(input.crudTableIds) } : {}),
  ...(input.crudCoverageByEntity
    ? {
        crudCoverageByEntity: new Map(
          Object.entries(input.crudCoverageByEntity).map(
            ([entityId, operations]) => [
              entityId,
              new Set(operations) as ReadonlySet<string>,
            ]
          )
        ),
      }
    : {}),
  ...(input.knownEntityIds
    ? { knownEntityIds: new Set(input.knownEntityIds) }
    : {}),
  ...(input.importResolutionsByFile
    ? {
        importResolutionsByFile: new Map(
          Object.entries(input.importResolutionsByFile)
        ),
      }
    : {}),
  ...(input.documentedImportResolutionsByFile
    ? {
        documentedImportResolutionsByFile: new Map(
          Object.entries(input.documentedImportResolutionsByFile)
        ),
      }
    : {}),
  ...(input.exportedSymbolDefinitionsByName
    ? {
        exportedSymbolDefinitionsByName: new Map(
          Object.entries(input.exportedSymbolDefinitionsByName)
        ),
      }
    : {}),
  ...buildGovernedHistoryContext(input),
  ...(input.publicWorkspaces
    ? { publicWorkspaces: new Map(Object.entries(input.publicWorkspaces)) }
    : {}),
  knownTrailIds: input.knownTrailIds
    ? new Set(input.knownTrailIds)
    : new Set<string>(),
  ...(input.composeTargetTrailIds
    ? { composeTargetTrailIds: new Set(input.composeTargetTrailIds) }
    : {}),
  ...(input.knownResourceIds
    ? { knownResourceIds: new Set(input.knownResourceIds) }
    : {}),
  ...(input.knownSignalIds
    ? { knownSignalIds: new Set(input.knownSignalIds) }
    : {}),
  ...(input.onTargetSignalIds
    ? { onTargetSignalIds: new Set(input.onTargetSignalIds) }
    : {}),
  ...(input.reconcileTableIds
    ? { reconcileTableIds: new Set(input.reconcileTableIds) }
    : {}),
  ...(input.trailIntentsById
    ? { trailIntentsById: new Map(Object.entries(input.trailIntentsById)) }
    : {}),
  ...(input.topoTrailIds ? { topoTrailIds: new Set(input.topoTrailIds) } : {}),
});

/**
 * Wrap an existing `WardenRule` as a trail with typed input/output.
 *
 * The trail ID follows the pattern `warden.rule.<rule-name>`.
 */
export function wrapRule(
  options: WrapProjectAwareRuleOptions
): Trail<ProjectAwareRuleInput, RuleOutput>;
export function wrapRule(
  options: WrapRuleOptions
): Trail<RuleInput, RuleOutput>;
export function wrapRule(
  options: WrapRuleOptions | WrapProjectAwareRuleOptions
): Trail<RuleInput, RuleOutput> | Trail<ProjectAwareRuleInput, RuleOutput> {
  const { rule, examples } = options;
  const isProjectAware = 'checkWithContext' in rule;

  if (isProjectAware) {
    const projectAwareRule = rule as ProjectAwareWardenRule;
    return trail(`warden.rule.${rule.name}`, {
      description: rule.description,
      examples: examples as Trail<
        ProjectAwareRuleInput,
        RuleOutput
      >['examples'],
      implementation: (input: ProjectAwareRuleInput) => {
        const context = buildProjectContext(input);
        const diagnostics = projectAwareRule.checkWithContext(
          input.sourceCode,
          input.filePath,
          context
        );
        return Result.ok({ diagnostics: [...diagnostics] });
      },
      input: projectAwareRuleInput,
      intent: 'read',
      meta: buildRuleMeta(rule),
      output: ruleOutput,
    });
  }

  return trail(`warden.rule.${rule.name}`, {
    description: rule.description,
    examples: examples as Trail<RuleInput, RuleOutput>['examples'],
    implementation: (input: RuleInput) => {
      const diagnostics = rule.check(input.sourceCode, input.filePath);
      return Result.ok({ diagnostics: [...diagnostics] });
    },
    input: ruleInput,
    intent: 'read',
    meta: buildRuleMeta(rule),
    output: ruleOutput,
  });
}

interface WrapTopoRuleOptions {
  /** The existing topo-aware warden rule to wrap. */
  readonly rule: TopoAwareWardenRule;
  /** Trail examples for testing and documentation. */
  readonly examples: Trail<TopoAwareRuleInput, RuleOutput>['examples'];
}

/**
 * Wrap an existing `TopoAwareWardenRule` as a trail.
 *
 * Mirrors `wrapRule` for the per-topo dispatch path. Topo-aware rules run
 * once per topo against the compiled runtime graph rather than per file,
 * so the trail accepts the live `Topo` as input.
 */
export const wrapTopoRule = (
  options: WrapTopoRuleOptions
): Trail<TopoAwareRuleInput, RuleOutput> => {
  const { rule, examples } = options;
  return trail(`warden.rule.${rule.name}`, {
    description: rule.description,
    examples,
    implementation: async (input: TopoAwareRuleInput) => {
      try {
        const diagnostics = await rule.checkTopo(input.topo, {
          graph: input.graph,
        });
        return Result.ok({ diagnostics: [...diagnostics] });
      } catch (error) {
        const cause = error instanceof Error ? error : new Error(String(error));
        return Result.err(
          new InternalError(
            `Topo-aware rule "${rule.name}" threw while inspecting topo: ${cause.message}`,
            { cause }
          )
        );
      }
    },
    input: topoAwareRuleInput,
    intent: 'read',
    meta: buildRuleMeta(rule),
    output: ruleOutput,
  });
};
