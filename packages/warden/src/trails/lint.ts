/**
 * Lint hike — follows all warden rule trails for a single file.
 */

import { hike, Result } from '@ontrails/core';

import { projectAwareRuleInputSchema, ruleOutputSchema } from './schemas.js';
import type { RuleOutput } from './schemas.js';

/**
 * All warden rule trail IDs, in alphabetical order.
 */
const RULE_TRAIL_IDS = [
  'warden.rule.context-no-surface-types',
  'warden.rule.event-origins-exist',
  'warden.rule.examples-match-schema',
  'warden.rule.follows-matches-calls',
  'warden.rule.follows-trails-exist',
  'warden.rule.implementation-returns-result',
  'warden.rule.no-direct-impl-in-route',
  'warden.rule.no-direct-implementation-call',
  'warden.rule.no-recursive-follows',
  'warden.rule.no-sync-result-assumption',
  'warden.rule.no-throw-in-detour-target',
  'warden.rule.no-throw-in-implementation',
  'warden.rule.prefer-schema-inference',
  'warden.rule.require-output-schema',
  'warden.rule.valid-describe-refs',
  'warden.rule.valid-detour-refs',
] as const;

/**
 * A hike that follows every warden rule trail for a single file and
 * aggregates all diagnostics into a single output.
 */
export const lintFile = hike('warden.lint-file', {
  description: 'Run all warden lint rules against a single source file.',
  follows: [...RULE_TRAIL_IDS],
  implementation: async (input, ctx) => {
    const allDiagnostics: RuleOutput['diagnostics'] = [];

    for (const ruleId of RULE_TRAIL_IDS) {
      if (!ctx.follow) {
        continue;
      }
      const result = await ctx.follow<RuleOutput>(ruleId, input);
      if (result.isOk()) {
        allDiagnostics.push(...result.value.diagnostics);
      }
    }

    return Result.ok({ diagnostics: allDiagnostics });
  },
  input: projectAwareRuleInputSchema,
  output: ruleOutputSchema,
});
