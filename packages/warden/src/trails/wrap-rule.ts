/**
 * Factory that wraps a WardenRule as a trail.
 *
 * Keeps each rule trail file minimal — just the import + examples.
 */

import { trail, Result } from '@ontrails/core';
import type { Trail } from '@ontrails/core';

import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenRule,
} from '../rules/types.js';
import { projectAwareRuleInput, ruleInput, ruleOutput } from './schema.js';
import type { ProjectAwareRuleInput, RuleInput, RuleOutput } from './schema.js';

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
      input: projectAwareRuleInput,
      intent: 'read',
      metadata: { category: 'governance', severity: rule.severity },
      output: ruleOutput,
      run: (input: ProjectAwareRuleInput) => {
        const context = {
          knownServiceIds: input.knownServiceIds
            ? new Set(input.knownServiceIds)
            : undefined,
          knownTrailIds: input.knownTrailIds
            ? new Set(input.knownTrailIds)
            : new Set<string>(),
        } as ProjectContext;
        const diagnostics = projectAwareRule.checkWithContext(
          input.sourceCode,
          input.filePath,
          context
        );
        return Result.ok({ diagnostics: [...diagnostics] });
      },
    });
  }

  return trail(`warden.rule.${rule.name}`, {
    description: rule.description,
    examples: examples as Trail<RuleInput, RuleOutput>['examples'],
    input: ruleInput,
    intent: 'read',
    metadata: { category: 'governance', severity: rule.severity },
    output: ruleOutput,
    run: (input: RuleInput) => {
      const diagnostics = rule.check(input.sourceCode, input.filePath);
      return Result.ok({ diagnostics: [...diagnostics] });
    },
  });
}
