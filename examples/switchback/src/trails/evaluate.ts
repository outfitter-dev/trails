import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { evaluateFlag } from '../engine.js';
import {
  evalContextSchema,
  evaluationSchema,
  flagValueSchema,
} from '../model.js';
import type { Evaluation, FlagValue } from '../model.js';
import { auditResource } from '../resources/audit.js';
import { flagsResource } from '../resources/flags.js';
import { requireLiveFlag } from './shared.js';

/** Render an EvalTrace as human-readable lines for the `--explain` flag. */
const renderTrace = (evaluation: Evaluation): string[] => {
  const lines = evaluation.reason.steps.map((step) => {
    if (step.outcome === 'matched') {
      return `rule ${step.ruleId}: matched`;
    }
    if (step.outcome === 'skipped') {
      return `rule ${step.ruleId}: skipped (${step.detail})`;
    }
    return `rule ${step.ruleId}: bucket ${step.bucket} served ${JSON.stringify(step.served)}`;
  });
  lines.push(
    `result: ${JSON.stringify(evaluation.value)} (${evaluation.reason.reason})`
  );
  return lines;
};

/**
 * The hero trail: a pure, deterministic function of (flag definition,
 * evaluation context). No clock, no randomness, no I/O beyond reading the
 * flags resource — identical inputs produce identical results forever, and
 * every result carries the rule-by-rule EvalTrace explaining why.
 */
export const evaluate = trail('flag.evaluate', {
  description:
    'Evaluate one flag for a subject, returning the served value and a rule-by-rule trace of why',
  examples: [
    {
      description: 'A targeting rule matches on the plan attribute',
      expected: {
        key: 'checkout-v2',
        reason: {
          reason: 'rule-match',
          steps: [{ outcome: 'matched', ruleId: 'beta-users' }],
        },
        value: 'treatment',
        variant: 'treatment',
      },
      input: {
        context: { attributes: { plan: 'beta' }, subjectId: 'user-9' },
        key: 'checkout-v2',
      },
      name: 'Beta plan gets the treatment',
    },
    {
      description:
        'Percentage rollout is seeded-hash deterministic: user-1 buckets to 7 (< 20) forever',
      expected: {
        key: 'checkout-v2',
        reason: {
          reason: 'percentage-rollout',
          steps: [
            {
              detail: 'attribute "plan" is missing',
              outcome: 'skipped',
              ruleId: 'beta-users',
            },
            {
              bucket: 7,
              outcome: 'percentage',
              ruleId: 'gradual-rollout',
              served: 'treatment',
            },
          ],
        },
        value: 'treatment',
        variant: 'treatment',
      },
      input: {
        context: { attributes: {}, subjectId: 'user-1' },
        key: 'checkout-v2',
      },
      name: 'Fixed vector: user-1 buckets to 7 and gets the treatment',
    },
    {
      description:
        'The same rollout keeps user-3 on control: bucket 45 falls in the 80% arm',
      expected: {
        key: 'checkout-v2',
        reason: {
          reason: 'percentage-rollout',
          steps: [
            {
              detail: 'attribute "plan" is missing',
              outcome: 'skipped',
              ruleId: 'beta-users',
            },
            {
              bucket: 45,
              outcome: 'percentage',
              ruleId: 'gradual-rollout',
              served: 'control',
            },
          ],
        },
        value: 'control',
        variant: 'control',
      },
      input: {
        context: { attributes: {}, subjectId: 'user-3' },
        key: 'checkout-v2',
      },
      name: 'Fixed vector: user-3 buckets to 45 and stays on control',
    },
    {
      description:
        'Disabled flags serve their default without inspecting rules',
      expected: {
        key: 'new-onboarding',
        reason: { reason: 'disabled', steps: [] },
        value: false,
      },
      input: {
        context: { attributes: {}, subjectId: 'user-1' },
        key: 'new-onboarding',
      },
      name: 'Disabled flag serves its default',
    },
    {
      description: 'Archived flags are retired and cannot be evaluated',
      error: 'NotFoundError',
      input: {
        context: { attributes: {}, subjectId: 'user-1' },
        key: 'legacy-banner',
      },
      name: 'Archived flag is not found',
    },
    {
      description:
        'explain: true adds a human-readable rendering of the trace (the CLI --explain flag)',
      expected: {
        explanation: [
          'rule beta-users: skipped (attribute "plan" is missing)',
          'rule gradual-rollout: bucket 7 served "treatment"',
          'result: "treatment" (percentage-rollout)',
        ],
        key: 'checkout-v2',
        reason: {
          reason: 'percentage-rollout',
          steps: [
            {
              detail: 'attribute "plan" is missing',
              outcome: 'skipped',
              ruleId: 'beta-users',
            },
            {
              bucket: 7,
              outcome: 'percentage',
              ruleId: 'gradual-rollout',
              served: 'treatment',
            },
          ],
        },
        value: 'treatment',
        variant: 'treatment',
      },
      input: {
        context: { attributes: {}, subjectId: 'user-1' },
        explain: true,
        key: 'checkout-v2',
      },
      name: 'Explain the evaluation',
    },
  ],
  implementation: async (input, ctx) => {
    const store = flagsResource.from(ctx);
    const flag = await requireLiveFlag(store, input.key);
    if (flag.isErr()) {
      return flag;
    }
    const evaluation = evaluateFlag(flag.value, input.context);
    if (!input.explain) {
      return Result.ok(evaluation);
    }
    return Result.ok({ ...evaluation, explanation: renderTrace(evaluation) });
  },
  input: z.object({
    context: evalContextSchema.describe('Who the flag is evaluated for'),
    explain: z
      .boolean()
      .default(false)
      .describe('Include a human-readable rendering of the trace'),
    key: z.string().describe('Flag key to evaluate'),
  }),
  intent: 'read',
  output: evaluationSchema.extend({
    explanation: z
      .array(z.string())
      .optional()
      .describe('Human-readable trace lines, present when explain is true'),
  }),
  resources: [flagsResource],
});

/**
 * Bulk bootstrap: evaluate every live flag for one context. Each served
 * payload is recorded in the in-memory demo audit log.
 */
export const evaluateAll = trail('flag.evaluate-all', {
  description:
    'Evaluate every live flag for one subject — the bootstrap payload pattern',
  examples: [
    {
      description:
        'A beta-plan subject gets the treatment via targeting; dark-mode misses its 50% rollout (bucket 58)',
      expected: {
        evaluated: 3,
        values: {
          'checkout-v2': 'treatment',
          'dark-mode': false,
          'new-onboarding': false,
        },
      },
      input: {
        context: { attributes: { plan: 'beta' }, subjectId: 'user-1' },
      },
      name: 'Bootstrap payload for a beta subject',
    },
    {
      description:
        'Fixed vector: user-42 buckets to 10 (< 20) on checkout-v2; the pro plan turns dark-mode on',
      expected: {
        evaluated: 3,
        values: {
          'checkout-v2': 'treatment',
          'dark-mode': true,
          'new-onboarding': false,
        },
      },
      input: {
        context: { attributes: { plan: 'pro' }, subjectId: 'user-42' },
      },
      name: 'Bootstrap payload for a pro subject',
    },
  ],
  implementation: async (input, ctx) => {
    const store = flagsResource.from(ctx);
    const audit = auditResource.from(ctx);
    const flags = await store.list();
    const live = flags.filter((flag) => !flag.archived);
    const values: Record<string, FlagValue> = {};
    for (const flag of live) {
      values[flag.key] = evaluateFlag(flag, input.context).value;
    }
    audit.record({ subjectId: input.context.subjectId, values });
    return Result.ok({ evaluated: live.length, values });
  },
  input: z.object({
    context: evalContextSchema.describe('Who the flags are evaluated for'),
  }),
  intent: 'read',
  output: z.object({
    evaluated: z.number().int().describe('Number of live flags evaluated'),
    values: z
      .record(z.string(), flagValueSchema)
      .describe('Flag key to served value — the bootstrap payload'),
  }),
  resources: [flagsResource, auditResource],
});
