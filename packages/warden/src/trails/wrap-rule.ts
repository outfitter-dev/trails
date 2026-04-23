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

const buildProjectContext = (input: ProjectAwareRuleInput): ProjectContext => ({
  ...(input.contourReferencesByName
    ? {
        contourReferencesByName: new Map(
          Object.entries(input.contourReferencesByName)
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
  ...(input.knownContourIds
    ? { knownContourIds: new Set(input.knownContourIds) }
    : {}),
  knownTrailIds: input.knownTrailIds
    ? new Set(input.knownTrailIds)
    : new Set<string>(),
  ...(input.crossTargetTrailIds
    ? { crossTargetTrailIds: new Set(input.crossTargetTrailIds) }
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
      blaze: (input: ProjectAwareRuleInput) => {
        const diagnostics = projectAwareRule.checkWithContext(
          input.sourceCode,
          input.filePath,
          buildProjectContext(input)
        );
        return Result.ok({ diagnostics: [...diagnostics] });
      },
      description: rule.description,
      examples: examples as Trail<
        ProjectAwareRuleInput,
        RuleOutput
      >['examples'],
      input: projectAwareRuleInput,
      intent: 'read',
      meta: { category: 'governance', severity: rule.severity },
      output: ruleOutput,
    });
  }

  return trail(`warden.rule.${rule.name}`, {
    blaze: (input: RuleInput) => {
      const diagnostics = rule.check(input.sourceCode, input.filePath);
      return Result.ok({ diagnostics: [...diagnostics] });
    },
    description: rule.description,
    examples: examples as Trail<RuleInput, RuleOutput>['examples'],
    input: ruleInput,
    intent: 'read',
    meta: { category: 'governance', severity: rule.severity },
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
    blaze: async (input: TopoAwareRuleInput) => {
      try {
        const diagnostics = await rule.checkTopo(input.topo);
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
    description: rule.description,
    examples,
    input: topoAwareRuleInput,
    intent: 'read',
    meta: { category: 'governance', severity: rule.severity },
    output: ruleOutput,
  });
};
